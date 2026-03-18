# Web Worker Feasibility Spike — Results

**Date:** 2026-03-18
**Runtime:** Node.js v24.14.0 + tsx v4.21.0
**Approach:** Node.js `worker_threads` (mirrors browser `postMessage`/`onmessage` model)

---

## Test Summary

| # | Test | Result | Detail |
|---|------|--------|--------|
| 1 | Worker communication basics | ✅ PASS | 3 events received in order |
| 2 | Sequence number assignment | ✅ PASS | 501 events (1 ready + 500 burst), seq 1→501, no gaps |
| 3 | Error serialisation | ✅ PASS | name + message + stack all preserved as strings |
| 4 | Async execution tracing | ✅ PASS | events in expected order: start → end → output |
| 5 | Worker termination | ✅ PASS | terminated in <1ms (event-loop yield) |
| 6 | postMessage performance | ℹ️ INFO | 1000 events in 3ms (~333k events/s) |

**Summary: 5 passed, 0 warnings, 0 failed out of 6 tests.**

---

## Key Findings

### ✅ Test 1 — Worker Communication
`postMessage` ordering is fully preserved. Messages arrive at the main thread in the exact order they were posted. No buffering or reordering observed across all tested scenarios.

### ✅ Test 2 — Sequence Numbers
Monotonically increasing sequence numbers work correctly even under load. With 500 burst events sent in rapid succession, every sequence number was assigned exactly once with no gaps and no out-of-order delivery. This is a critical requirement for Visual Promise's event stream — the approach is sound.

### ✅ Test 3 — Error Serialisation
Errors serialise cleanly via `postMessage`'s structured clone algorithm. The `Error` object's `name`, `message`, and `stack` are all preserved as plain strings. **The prototype chain is lost** (as expected — structured cloning doesn't preserve prototypes), but this is not a problem for Visual Promise since errors are re-thrown on the main thread as plain `Error` objects. The loss of the original constructor (`Error` → plain object) is acceptable because the error *data* (name, message, stack) is preserved.

### ✅ Test 4 — Async Execution Tracing
The `__vp` runtime correctly intercepts async execution. Events arrive in the expected order: `execution.start` → `execution.end` → `console.output`. The `Promise.then()` callback is correctly deferred until after `execution.end` fires, which matches the expected JavaScript event loop behavior. This validates the core instrumented-execution concept.

### ✅ Test 5 — Worker Termination
`worker.terminate()` kills the worker thread immediately with no graceful shutdown needed. In Node.js, termination takes <1ms because the event loop simply stops scheduling the worker. In browsers, `terminate()` also immediately kills the worker context. This is sufficient for Visual Promise's use case — no graceful shutdown protocol needed.

### ℹ️ Test 6 — postMessage Performance
Throughput is excellent: **~333,000 events/second** in Node.js. This is a Node.js-specific figure (the event loop handles IPC very efficiently). In browsers, `postMessage` to a Web Worker is also fast but varies by browser and payload size. With typical Visual Promise event payloads (~100–500 bytes), the bottleneck will be the main thread's event handler, not the IPC channel. At 333k events/s, the practical limit is well above what any real instrumented snippet would produce.

---

## Go/No-Go Recommendation

### ✅ **GO — Web Worker approach is viable**

All critical requirements are met:
1. ✅ Ordered event emission via `postMessage`
2. ✅ Sequence number assignment is reliable under load
3. ✅ Error serialisation preserves the data that matters (name, message, stack)
4. ✅ Async tracing works correctly with the event loop
5. ✅ Worker termination is fast and reliable
6. ✅ Performance is well beyond practical requirements

### Specific Mitigations (non-blocking)

| Finding | Mitigation |
|---------|-----------|
| Error prototype chain is lost in transfer | Re-hydrate errors on main thread: `const err = new Error(data.message); err.name = data.name; err.stack = data.stack;` |
| `worker_threads` (Node.js) ≠ Browser `Worker` API | In browser environments, use native `Worker` with `Blob URL` for inline workers. The `__vp` runtime uses the same `postMessage` interface in both environments. |
| No `importScripts` in Node.js | Browser instrumentation must not rely on `importScripts`. Bundle instrumented snippets or use a module-worker approach. |

---

## Architecture Validation

The spike confirms the core Visual Promise worker design is sound:

```
Main Thread                    Worker Thread
────────────                   ─────────────
__vp.post(event)    ──────►    postMessage(event)
postMessage(data)  ◄──────     __vp.post() + structured clone
terminate()        ──────►     immediate kill (no graceful needed)
```

The `__vp` runtime pattern (pre-incrementing seq before postMessage, wrapping every event) ensures the event stream is always ordered and deterministic.

---

## Files

- `spike-runner.ts` — main test runner (TypeScript, runs with `npx tsx`)
- `vp-worker.ts` — worker source (compile to `vp-worker.js` before running)
- `tsconfig.spike.json` — TypeScript config for worker compilation
- `build.mjs` — worker build script
