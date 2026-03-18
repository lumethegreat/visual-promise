# Operational Limits & Configuration — Visual Promise M1

> This document defines hard and soft limits for the Visual Promise execution engine, plus the full configuration surface area.
>
> **Principle:** Limits exist to prevent resource exhaustion in the Web Worker and to keep replay performance predictable. Soft limits produce warnings; hard limits abort execution.

---

## 1. Limits

### 1.1 Max Snippet Size — `maxSnippetChars`

| Property | Value |
|----------|-------|
| **Default** | `5_000` characters |
| **Type** | Hard limit |
| **Enforcement point** | Validator (before execution begins) |
| **What counts** | Raw source text, excluding whitespace normalization differences. Comments and string content count toward the limit. |

**Justification:** 5 KB is sufficient for meaningful pedagogical snippets (typically 20–100 lines). It prevents accidentally pasting entire files and protects the worker heap.

**When exceeded:** Hard error. The snippet is rejected before execution. UI shows: *"Snippet exceeds the maximum size of 5,000 characters. Please reduce the code and try again."*

**Configurable:** Yes — `maxSnippetChars: number` in the app config. Should be settable via a config panel or environment variable. Raising above `20_000` is not recommended without additional sandboxing.

---

### 1.2 Max Event Count Per Replay Run — `maxEventsPerRun`

| Property | Value |
|----------|-------|
| **Default** | `1_000` events |
| **Type** | Hard limit |
| **Enforcement point** | Worker event buffer (checked on each event emission) |
| **What counts as an event** | Every entry in the replay log: `promise.created`, `promise.fulfilled`, `promise.rejected`, `executor.started`, `error.throw`, `error.caught`, `async.function.created`, `async.call`, `async.await`, `async.return`, `function.call`, `function.return`, `promise.method.called` (then/catch/finally), `console.output`, `finally.executed`. Each occurrence = 1 event. |
| **What does NOT count** | Internal buffer bookkeeping, network round-trips (none in worker), metadata headers. |

**Justification:** 1,000 events is enough for chains of ~500 `.then()` calls or ~100 deeply nested async frames — far beyond what a pedagogical example requires. It also caps the replay JSON payload to a manageable size (~100–200 KB).

**When exceeded:** Execution is terminated. The replay log up to that point is returned with a `truncated: true` flag. UI shows: *"Execution generated too many events (limit: 1,000). The replay has been truncated. Try simplifying your code."* A soft warning in the replay timeline marks where truncation occurred.

**Configurable:** Yes — `maxEventsPerRun: number`. Not exposed in the UI config by default; only via code config / env var.

---

### 1.3 Max Nested Async Depth — `maxNestedAsyncDepth`

| Property | Value |
|----------|-------|
| **Default** | `10` |
| **Type** | Soft limit (becomes hard at the boundary) |
| **Enforcement point** | Worker call stack depth tracker |
| **What counts** | Each `async function` call that has not yet returned. `await` expressions do not add to this count — they represent the *waiting* state, not a new async frame. Only function calls do. |
| **Formula** | `depth = number of async function calls currently on the call stack that have not yet returned` |

**Justification:** 10 levels covers:
- Normal async wrapper patterns (1–3 levels)
- Nested async helper functions (4–6 levels)
- Pedagogical recursion examples (up to ~8 levels)
- Defensive buffer (2 levels)

At 10 levels, we have a hard stop. This prevents stack overflow in the worker and keeps the visualizer's tree manageable.

**When exceeded:** `error.throw` emitted with message: *"Maximum async nesting depth (10) exceeded. This may indicate an infinite or very deep async recursion."* Execution stops. The chain/replay ends with an error state.

**Configurable:** Yes — `maxNestedAsyncDepth: number`. Not exposed in UI by default. Raising above `50` requires additional sandboxing review.

---

### 1.4 Max Promise Chain Length — `maxPromiseChainLength`

| Property | Value |
|----------|-------|
| **Default** | `200` |
| **Type** | Soft limit |
| **Enforcement point** | Worker — tracked on each `.then()` / `.catch()` / `.finally()` call |
| **What counts** | Each `promise.method.called` event for `.then`, `.catch`, or `.finally`. A `Promise.all` with 2 items counts as 2 toward this limit (one event per promise in the array is NOT emitted; the `Promise.all` itself is `unsupported`, so this limit is primarily for sequential chains). |

**Justification:** 200 chained promises is extreme for a teaching tool. Most real snippets chain 3–10. 200 is a generous ceiling that covers complex educational examples while preventing runaway microtask queue filling.

**When exceeded:** Soft warning emitted as a `system.warning` event: *"Promise chain is very long (N / 200). Replay may be hard to follow."* Execution continues. No hard stop.

**Configurable:** Yes — `maxPromiseChainLength: number`.

---

### 1.5 Worker Execution Timeout — `workerTimeoutMs`

| Property | Value |
|----------|-------|
| **Default** | `5_000` ms (5 seconds) |
| **Type** | Hard limit |
| **Enforcement point** | Main thread — `setTimeout` around the `worker.postMessage` call, or a heartbeat check inside the worker |
| **What causes timeout** | The worker's `postMessage` to main thread is delayed. This can happen if: (a) the worker script itself has an infinite loop (synchronous), (b) the microtask queue has a pathological queue of settled promises. Note: `setTimeout`-based async is `unsupported`, so genuine wall-clock timeouts from timers won't occur during normal execution. |
| **What does NOT cause timeout** | Normal async execution (microtasks settle in microseconds). Normal promise chains (settle instantly in a microtask). |

**Justification:** 5 seconds is generous for synchronous code that is allowed. Any synchronous infinite loop is a bug in the snippet, not the system. 5 seconds is also well within a user's attention span for "this is stuck" feedback.

**When exceeded:** Main thread aborts the worker. Replay log is discarded. UI shows: *"Execution timed out after 5 seconds. Check for infinite loops or synchronous blocking code."* The snippet is NOT re-classified; it is treated as a runtime error.

**Configurable:** Yes — `workerTimeoutMs: number`. Exposed in a "Settings" panel as "Execution timeout (ms)".

---

### 1.6 Max `then`/`catch`/`finally` Handlers Per Promise — `maxHandlersPerPromise`

| Property | Value |
|----------|-------|
| **Default** | `5` |
| **Type** | Hard limit |
| **Enforcement point** | Worker — before attaching a new handler, check existing handler count on the target promise |
| **What counts** | Each call to `.then()`, `.catch()`, or `.finally()` on the same promise object (not the chain — each individual promise instance) |
| **Special case** | Calling `.then(fn1).then(fn2)` on the same promise instance counts as 1 `.then` call on the original promise, then 1 `.then` on the new promise. The limit applies per-promise-instance. |

**Justification:** More than 5 handlers on a single promise is pathological and usually indicates a bug or over-engineering. It also creates a large number of event entries. 5 is a safe, readable ceiling.

**When exceeded:** `error.throw` with message: *"Too many handlers attached to a single Promise (max 5)."* Execution stops.

**Configurable:** Yes — `maxHandlersPerPromise: number`.

---

### 1.7 Max Console Entries — `maxConsoleEntries`

| Property | Value |
|----------|-------|
| **Default** | `200` |
| **Type** | Soft limit |
| **Enforcement point** | Worker — checked on each `console.output` event |
| **What counts** | Each individual `console.log` / `console.error` / `console.warn` / `console.info` call. Multiple arguments to a single call count as 1 entry. |
| **What does NOT count** | Internal worker logs (none in production build). |

**Justification:** 200 console entries is enough for any realistic debug session. It prevents a `while(true) console.log("x")` loop from flooding the replay.

**When exceeded:** Soft warning. The latest entries beyond 200 are discarded. UI shows a muted indicator: *"+N more console entries (not shown)."* The `console.output` events for discarded entries are NOT emitted.

**Configurable:** Yes — `maxConsoleEntries: number`.

---

### 1.8 Max Sync Steps Per Function — `maxSyncStepsPerFunction`

| Property | Value |
|----------|-------|
| **Default** | `500` |
| **Type** | Soft limit |
| **Enforcement point** | Worker — step counter incremented on each synchronous statement/expression executed |
| **What counts** | Each synchronous statement executed inside a function body (assignments, expressions, returns, if/else/for/while/switch bodies). Declarations (const, let, function) are free — they don't execute. |

**Justification:** 500 synchronous steps is enough for a complex algorithm or a large function body. Beyond this, it's likely an infinite loop in a synchronous context.

**When exceeded:** Soft warning event: `system.warning` with message: *"Large number of synchronous steps detected (N / 500). If this is not an infinite loop, consider increasing the limit."* Execution continues. **Note:** This limit interacts with `workerTimeoutMs` — a true infinite loop will also hit the timeout.

**Configurable:** Yes — `maxSyncStepsPerFunction: number`.

---

## 2. Limit Summary Table

| Limit | Default | Hard/Soft | Enforcement Point | Configurable |
|-------|---------|-----------|-------------------|-------------|
| `maxSnippetChars` | 5,000 | Hard | Validator | ✅ |
| `maxEventsPerRun` | 1,000 | Hard | Worker event buffer | ✅ |
| `maxNestedAsyncDepth` | 10 | Soft→Hard | Worker call stack | ✅ |
| `maxPromiseChainLength` | 200 | Soft | Worker handler tracker | ✅ |
| `workerTimeoutMs` | 5,000 ms | Hard | Main thread timer | ✅ |
| `maxHandlersPerPromise` | 5 | Hard | Worker handler counter | ✅ |
| `maxConsoleEntries` | 200 | Soft | Worker console interceptor | ✅ |
| `maxSyncStepsPerFunction` | 500 | Soft | Worker step counter | ✅ |

---

## 3. Configuration Surface Area

### 3.1 Config Object Shape

```typescript
interface VPConfig {
  // Execution limits
  workerTimeoutMs: number;           // Default: 5000
  maxSnippetChars: number;          // Default: 5000
  maxEventsPerRun: number;          // Default: 1000
  maxNestedAsyncDepth: number;      // Default: 10
  maxPromiseChainLength: number;     // Default: 200
  maxHandlersPerPromise: number;     // Default: 5
  maxConsoleEntries: number;        // Default: 200
  maxSyncStepsPerFunction: number;  // Default: 500

  // Behavior flags
  enableStepMode: boolean;          // Default: true (step-by-step replay)
  autoPlaySpeedMs: number;          // Default: 800 (ms between steps in auto-play)
  enableSoftWarnings: boolean;      // Default: true (show warnings in replay timeline)
  enableCodeHighlight: boolean;     // Default: true (highlight current line during replay)
  enableMinimap: boolean;          // Default: false (M2 feature)

  // Replay options
  defaultReplayMode: 'auto' | 'manual';  // Default: 'manual'
  maxReplayHistory: number;        // Default: 10 (last N snippets kept in history)
}
```

### 3.2 Config Sources (in priority order, highest last)

1. **Default values** — hardcoded in `src/config/defaults.ts`. These are the values in the table above.
2. **URL params** — `?workerTimeoutMs=10000` etc. For shareable links with custom settings. Parsed at app init.
3. **Session storage** — last-used config persisted in `sessionStorage` so settings survive a page refresh within the session.
4. **Settings panel** — user-editable via the in-app Settings UI (renders the config fields from §3.1).

### 3.3 Per-Snippet Config Overrides

Each snippet submission may carry an optional `overrides` object:

```typescript
interface SnippetSubmission {
  code: string;
  configOverrides?: Partial<VPConfig>;
}
```

Use case: a test suite may want to increase `workerTimeoutMs` for a known-heavy snippet. The overrides are merged on top of the active config, capped at hard limits.

### 3.4 Environment Variables

For build-time / deployment config (not user-facing):

```bash
VP_WORKER_TIMEOUT_MS=5000
VP_MAX_SNIPPET_CHARS=5000
VP_MAX_EVENTS_PER_RUN=1000
VP_MAX_NESTED_ASYNC_DEPTH=10
VP_MAX_CONSOLE_ENTRIES=200
```

These map to the same `VPConfig` fields. URL params and the settings panel take precedence at runtime.

---

## 4. Error Classification

When a limit is hit, the system emits one of two event types:

### `error.limit.hard`
Execution is aborted. No further events will be emitted. The replay log ends here.
```typescript
{ type: 'error.limit.hard', limit: string, value: number, threshold: number, message: string }
```

### `system.warning`
Execution continues but the user is informed. The warning appears in the replay timeline.
```typescript
{ type: 'system.warning', code: string, value: number, threshold: number, message: string }
```

Limits mapped to error types:

| Limit | Hit → Hard or Soft? |
|-------|---------------------|
| `maxSnippetChars` | Hard (rejected before execution) |
| `maxEventsPerRun` | Hard (execution stops) |
| `maxNestedAsyncDepth` | Soft → Hard (soft warning at 8, hard error at 10) |
| `maxPromiseChainLength` | Soft (warning only) |
| `workerTimeoutMs` | Hard (worker terminated) |
| `maxHandlersPerPromise` | Hard |
| `maxConsoleEntries` | Soft (excess entries dropped silently with indicator) |
| `maxSyncStepsPerFunction` | Soft (warning at 400, continues to 500 hard stop) |

---

## 5. Replay Log Format

Each event in the replay log:

```typescript
interface ReplayEvent {
  id: number;           // Monotonically increasing, starts at 1
  type: ReplayEventType;
  timestamp: number;    // Worker-side `Date.now()` at emission (relative to worker start)
  data: Record<string, unknown>;
  warning?: boolean;    // True if this event was emitted despite a soft limit warning
}

type ReplayEventType =
  | 'promise.created'
  | 'promise.fulfilled'
  | 'promise.rejected'
  | 'executor.started'
  | 'error.throw'
  | 'error.caught'
  | 'async.function.created'
  | 'async.call'
  | 'async.await'
  | 'async.return'
  | 'function.call'
  | 'function.return'
  | 'promise.method.called'
  | 'finally.executed'
  | 'console.output'
  | 'system.warning'
  | 'error.limit.hard';
```

Replay log envelope:

```typescript
interface ReplayLog {
  events: ReplayEvent[];
  truncated: boolean;          // True if maxEventsPerRun was exceeded
  truncatedAt?: number;        // Event ID at which truncation occurred
  softWarningsCount: number;
  classification: 'full' | 'partial' | 'unsupported';
  executionTimeMs: number;     // Total worker execution time (excludes transfer time)
  config: VPConfig;            // Config snapshot used for this run
}
```
