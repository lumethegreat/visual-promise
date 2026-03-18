# Capability Matrix — Visual Promise M1

> **Classification levels:** `full` | `partial` | `unsupported`
>
> The **validator** is the gate. It runs before execution and classifies every submitted snippet.
> The **event emitter** is the in-worker instrumentation that produces the replay log.
> The **UI** decides how to render each classification.

---

## Legend

| Symbol | Meaning |
|--------|---------|
| ✅ | Emitted / shown / supported |
| ❌ | Not emitted / rejected / blocked |
| ⚠️ | Partial / degraded / flagged |
| — | Not applicable |

---

## 1. Promise Static Factories

### `Promise.resolve(value)`

| Dimension | Decision |
|-----------|----------|
| **Capability** | `full` |
| **Validator** | Pass — no unsupported constructs detected |
| **Events emitted** | `promise.created`, `promise.fulfilled` (microtask-queued) |
| **UI behavior** | Show promise block, animate fulfillment arrow, display resolved value |
| **Example** | `Promise.resolve(42)` |

### `Promise.reject(error)`

| Dimension | Decision |
|-----------|----------|
| **Capability** | `full` |
| **Validator** | Pass — no unsupported constructs detected |
| **Events emitted** | `promise.created`, `promise.rejected` (microtask-queued) |
| **UI behavior** | Show promise block, animate rejection arrow, display error value |
| **Example** | `Promise.reject(new Error("boom"))` |

---

## 2. `new Promise((resolve, reject) => {...})`

### Sync resolve / reject

| Dimension | Decision |
|-----------|----------|
| **Capability** | `full` |
| **Validator** | Pass — synchronous executor detected, no async timer APIs |
| **Events emitted** | `promise.created`, `executor.started`, `promise.fulfilled` or `promise.rejected` |
| **UI behavior** | Full step-through: executor → resolve/reject call → outcome |
| **Example** | `new Promise((resolve) => resolve(5))` |

### Sync throw inside executor

| Dimension | Decision |
|-----------|----------|
| **Capability** | `full` |
| **Validator** | Pass — throw is synchronous, trivially detectable |
| **Events emitted** | `promise.created`, `executor.started`, `error.throw` (synchronous) |
| **UI behavior** | Executor frame highlighted red, error bubble shown, rejection path follows |
| **Example** | `new Promise((resolve, reject) => { throw new Error("oops"); })` |

### Async resolve (setTimeout / setInterval / rAF inside executor)

| Dimension | Decision |
|-----------|----------|
| **Capability** | `unsupported` |
| **Validator** | **Hard reject** — `setTimeout`, `setInterval`, `requestAnimationFrame` detected inside executor body |
| **Events emitted** | None (execution never starts) |
| **UI behavior** | Error card: *"Detected `setTimeout` inside Promise executor. Timer-based async is not supported. Suggestion: restructure using `await` or remove the timer."* |
| **Example** | `new Promise((resolve) => { setTimeout(() => resolve(1), 0); })` |

### Async resolve via non-timer foreign callback

| Dimension | Decision |
|-----------|----------|
| **Capability** | `unsupported` |
| **Validator** | **Hard reject** — any callback invocation (`cb(...)`, `callback(...)`) inside executor is blocked. Rationale: the callback is opaque, the worker cannot instrument its execution, so visualization would be incomplete and misleading. |
| **Events emitted** | None |
| **UI behavior** | Error card: *"Detected a foreign callback call (`cb(...)`) inside the Promise executor. The app cannot trace execution inside external callbacks. Use a direct `resolve()` call or wrap in an async function with `await`."* |
| **Example** | `new Promise((resolve) => { someLib(resolve); })` |

### Self-referential / cyclically dependent promise

| Dimension | Decision |
|-----------|----------|
| **Capability** | `unsupported` |
| **Validator** | **Hard reject** — a promise that resolves (or rejects) with itself creates an infinite chain and would hang the replay engine. Detectable via static analysis of resolve/reject argument references. |
| **Events emitted** | None |
| **UI behavior** | Error card: *"Self-referential Promise detected (a promise that resolves with itself). This would cause an infinite chain and is not supported."* |
| **Example** | `new Promise(async (resolve) => { const p = new Promise(r => resolve(r)); await p; })` |
| **Alternative** | Show as `partial` — emit the outer promise creation and the `resolve` call, then show a warning that the inner resolution is pending and may not resolve. **DECISION: `unsupported` for M1.** Rationale: a self-referential promise that never settles is a pedagogical edge case; false-positive "full" visualization is worse than a clean rejection. |

---

## 3. Promise Instance Methods

### `p.then(fn)`

| Dimension | Decision |
|-----------|----------|
| **Capability** | `full` |
| **Validator** | Pass — `.then` is on the allow-list |
| **Events emitted** | `promise.method.called` (method: `then`), `promise.created` (the returned promise), `promise.fulfilled` of handler (if called) |
| **UI behavior** | Show method call on promise block, new child promise, handler outcome |
| **Example** | `Promise.resolve(1).then(x => x + 1)` |

### `p.then(fn).then(fn)` — chained

| Dimension | Decision |
|-----------|----------|
| **Capability** | `full` |
| **Validator** | Pass — chain of allowed methods |
| **Events emitted** | Full chain: each `.then` call, each returned promise, each handler execution |
| **UI behavior** | Linear vertical chain, each step animates in sequence |
| **Example** | `Promise.resolve(1).then(x => x + 1).then(x => x * 2)` |

### `p.then(fn)` where `fn` itself is async

| Dimension | Decision |
|-----------|----------|
| **Capability** | `partial` |
| **Validator** | **Soft pass with warning flag** — an async function IS a function and returns a promise. We can execute it, but we must decide: does the step-through pause at `await` points inside the async handler? |
| **Events emitted** | `promise.method.called`, `promise.created`, `async.call`, `async.await` (nested), `promise.fulfilled` |
| **UI behavior** | Step-through descends into the async handler. Each `await` inside the handler is shown as a sub-step. If the async handler has further awaits, they are traced recursively up to the **maxNestedAsyncDepth** limit. |
| **Edge case** | If the async handler calls an unknown function (not declared in the snippet), it is treated as a foreign function → `unsupported`. |
| **Example** | `Promise.resolve(1).then(async (x) => { const r = await fetchData(x); return r + 1; })` → **partial** (the `fetchData` call may be unsupported). `Promise.resolve(1).then(async (x) => { await delay(x); return x + 1; })` → **full** if `delay` is defined in snippet as `const delay = ms => new Promise(r => setTimeout(r, ms));` → **unsupported** (setTimeout). **Needs validator to track which functions are async and which are in-scope.** |

> **⚠️ Needs decision (M1 scope):** Should the validator flag every async handler that calls an unsupported construct, even deep inside? This requires full function-body analysis. **Recommendation: flag the top-level call and document the limitation; full recursive analysis is M2.**

### `p.catch(fn)`

| Dimension | Decision |
|-----------|----------|
| **Capability** | `full` |
| **Validator** | Pass |
| **Events emitted** | `promise.method.called` (method: `catch`), `promise.created`, error handler result (`promise.fulfilled` or `promise.rejected`) |
| **UI behavior** | Caught error shown with recovery arrow to next step |
| **Example** | `Promise.reject(1).catch(e => e + 1)` |

### `p.finally(fn)`

| Dimension | Decision |
|-----------|----------|
| **Capability** | `full` |
| **Validator** | Pass |
| **Events emitted** | `promise.method.called` (method: `finally`), `promise.created`, handler execution, **flag event: `finally.executed`** (distinguishes from `.then`/`.catch`) |
| **UI behavior** | Step shown, but UI annotates with "finally" badge. Note: `.finally()` does not change the settlement value — the result passes through unchanged. Visualizer must show the pass-through correctly. |
| **Example** | `Promise.resolve(1).finally(() => console.log("done"))` |

---

## 4. Async Functions

### `async function f() { await p }` — basic

| Dimension | Decision |
|-----------|----------|
| **Capability** | `full` |
| **Validator** | Pass — async function declaration with in-scope `await` |
| **Events emitted** | `async.function.created`, `async.call`, `async.await` (promise argument), `promise.fulfilled` / `promise.rejected` of awaited promise, `async.return` |
| **UI behavior** | Async function frame, await pause indicator, resume on settlement |
| **Example** | `async function f() { const x = await Promise.resolve(1); return x; }` |

### `async function f() { await p; await q }` — multiple awaits

| Dimension | Decision |
|-----------|----------|
| **Capability** | `full` |
| **Validator** | Pass — sequential awaits are fully sequentializable |
| **Events emitted** | One full async call/await/return cycle per `await`, in order |
| **UI behavior** | Sequential step-through, each await is a distinct pause+resume step |
| **Example** | `async function f() { const a = await p; const b = await q; return a + b; }` |

### `async function f() { return await p }` — early return with await

| Dimension | Decision |
|-----------|----------|
| **Capability** | `full` |
| **Validator** | Pass |
| **Events emitted** | `async.call`, `async.await`, `promise.fulfilled`/`rejected`, `async.return` (with awaited value unwrapped) |
| **UI behavior** | Return value shown is the unwrapped value. Note: `return await` is functionally identical to `return` in async functions (no retry semantics), but the step-through shows the await explicitly for pedagogical clarity. |
| **Example** | `async function f() { return await Promise.resolve(42); }` |

### `async function f() { try { await p } catch(e) {} }`

| Dimension | Decision |
|-----------|----------|
| **Capability** | `full` |
| **Validator** | Pass — try/catch around await is fully supported |
| **Events emitted** | `async.call`, `async.await`, `error.throw` (if rejected), `error.caught` (within function scope) |
| **UI behavior** | If rejection: error bubble appears, catch block highlighted, error swallowed |
| **Example** | `async function f() { try { await Promise.reject(1); } catch(e) { return -1; } }` |

### `async function f() { try { await p } finally {} }`

| Dimension | Decision |
|-----------|----------|
| **Capability** | `full` |
| **Validator** | Pass |
| **Events emitted** | `async.call`, `async.await`, `error.throw` (if any), `finally.executed` (within function frame), `async.return` |
| **UI behavior** | Finally block annotated with "finally" badge. Pass-through semantics preserved. |
| **Example** | `async function f() { try { await Promise.resolve(1); } finally { cleanup(); } }` |

### `async function f() { await f2() }` — nested async calls

| Dimension | Decision |
|-----------|----------|
| **Capability** | `full` — for "simple supported patterns" |
| **Validator** | **Soft pass** — verify `f2` is declared in the snippet and is an async function. If `f2` is a foreign function (imported, DOM API, unknown), → `unsupported`. |
| **Events emitted** | Outer call → inner call → inner await → inner return → outer continue, all traced |
| **UI behavior** | Nested stack shown: outer async frame → inner async frame. Up to `maxNestedAsyncDepth` levels. |
| **Limitation** | Recursive async functions (f calls f) — handled up to depth limit, then `error.throw` for exceeding depth. See `limits-and-config.md`. |
| **Example** | `async function f() { return await inner(); } async function inner() { return 1; }` |

### `const f = async () => {}` — arrow async

| Dimension | Decision |
|-----------|----------|
| **Capability** | `full` |
| **Validator** | Pass — `async () =>` is equivalent to async function expression |
| **Events emitted** | Same as async function declaration |
| **UI behavior** | Same as async function declaration, shown with arrow notation label |
| **Example** | `const f = async (x) => x + 1;` |

---

## 5. Top-level await

### `await expression` (outside any async function)

| Dimension | Decision |
|-----------|----------|
| **Capability** | `unsupported` |
| **Validator** | **Hard reject** — top-level `await` detected outside async function body |
| **Events emitted** | None |
| **UI behavior** | Error card: *"Top-level `await` is not supported. Wrap your code in an `async function` and call it, e.g.: `(async () => { await ... })()`."* |
| **Example** | `const x = await Promise.resolve(1);` at module/file top level |

---

## 6. Timer APIs

### `setTimeout(fn, delay)` / `setInterval(fn, delay)`

| Dimension | Decision |
|-----------|----------|
| **Capability** | `unsupported` |
| **Validator** | **Hard reject** — `setTimeout` / `setInterval` / `setImmediate` / `requestAnimationFrame` are all blocked at detection level |
| **Events emitted** | None |
| **UI behavior** | Error card: *"`setTimeout`/`setInterval` are not supported. Visual Promise uses synchronous, step-by-step replay. Use `await` to express asynchrony instead."* |
| **Example** | `setTimeout(() => console.log("later"), 100)` |

---

## 7. Concurrency Primitives

### `Promise.all([p, q])`

| Dimension | Decision |
|-----------|----------|
| **Capability** | `unsupported` |
| **Validator** | **Hard reject** — `Promise.all` is on the blocklist |
| **Events emitted** | None |
| **UI behavior** | Error card: *"Parallel promise execution (`Promise.all`, `Promise.race`, etc.) is not supported in M1. Rewrite sequentially: `const a = await p; const b = await q;`"* |
| **Example** | `Promise.all([fetchA(), fetchB()])` |

### `Promise.race([p, q])`

| Dimension | Decision |
|-----------|----------|
| **Capability** | `unsupported` |
| **Validator** | **Hard reject** |
| **Events emitted** | None |
| **UI behavior** | Same as `Promise.all` |
| **Example** | `Promise.race([p, q])` |

### `Promise.allSettled([p, q])`

| Dimension | Decision |
|-----------|----------|
| **Capability** | `unsupported` |
| **Validator** | **Hard reject** |
| **Events emitted** | None |

### `Promise.any([p, q])`

| Dimension | Decision |
|-----------|----------|
| **Capability** | `unsupported` |
| **Validator** | **Hard reject** |
| **Events emitted** | None |

---

## 8. Network / DOM / Platform APIs

### `fetch(url)` / `XMLHttpRequest` / `WebSocket`

| Dimension | Decision |
|-----------|----------|
| **Capability** | `unsupported` |
| **Validator** | **Hard reject** — `fetch`, `XMLHttpRequest`, `WebSocket`, `EventSource` all blocked |
| **Events emitted** | None |
| **UI behavior** | Error card: *"Network APIs (`fetch`, `XMLHttpRequest`, etc.) are not supported. Use `Promise.resolve(...)` to simulate responses."* |
| **Example** | `fetch("https://example.com").then(r => r.json())` |

### `document.getElementById(...)` / other DOM APIs

| Dimension | Decision |
|-----------|----------|
| **Capability** | `unsupported` |
| **Validator** | **Hard reject** — `document`, `window`, `navigator`, DOM element constructors |
| **Events emitted** | None |
| **UI behavior** | Error card: *"DOM APIs are not supported in this environment. This tool runs in a sandboxed Web Worker without DOM access."* |

---

## 9. Modules / Imports

### `import x from 'y'` / `import()`

| Dimension | Decision |
|-----------|----------|
| **Capability** | `unsupported` |
| **Validator** | **Hard reject** — any `import` statement or dynamic `import()` call |
| **Events emitted** | None |
| **UI behavior** | Error card: *"ES module imports are not supported. All code must be self-contained in the snippet."* |
| **Example** | `import { readFile } from "fs/promises";` |

---

## 10. Arbitrary Thenables & Metaprogramming

### Arbitrary thenable (object with `.then`)

| Dimension | Decision |
|-----------|----------|
| **Capability** | `unsupported` |
| **Validator** | **Hard reject** — any expression whose runtime value has a `.then` method but is not a native Promise is blocked. Reason: thenables have arbitrary control flow; we cannot reliably instrument them without executing them, which is unsafe. |
| **Events emitted** | None |
| **UI behavior** | Error card: *"Arbitrary thenables (objects with a `.then` method that are not native Promises) are not supported. Use `new Promise(...)` or `Promise.resolve(...)` instead."* |
| **Example** | `{ then: (res) => res(1) }` passed to a `.then` call |

### Promise subclass / extended promise

| Dimension | Decision |
|-----------|----------|
| **Capability** | `unsupported` |
| **Validator** | **Hard reject** — `class MyPromise extends Promise` or `Object.setPrototypeOf` patterns |
| **Events emitted** | None |
| **UI behavior** | Error card: *"Promise subclasses are not supported."* |

### `eval()` / `Function()` / `new Function()`

| Dimension | Decision |
|-----------|----------|
| **Capability** | `unsupported` |
| **Validator** | **Hard reject** — code-generating functions are blocked |
| **Events emitted** | None |

### `Symbol` key access on promise internals

| Dimension | Decision |
|-----------|----------|
| **Capability** | `unsupported` |
| **Validator** | **Hard reject** — reflective access to Promise internal slots |
| **Events emitted** | None |

---

## 11. Console

### `console.log(...)` / `console.error(...)` / `console.warn(...)`

| Dimension | Decision |
|-----------|----------|
| **Capability** | `full` |
| **Validator** | Pass — console is on the allow-list |
| **Events emitted** | `console.output` (with level: `log` | `error` | `warn` | `info`, and the serialized arguments) |
| **UI behavior** | Console output panel shows entries with appropriate styling. Capped at `maxConsoleEntries`. |
| **Example** | `console.log("hello", { a: 1 })` |

---

## 12. Sync Function Calls

### Regular synchronous function call

| Dimension | Decision |
|-----------|----------|
| **Capability** | `full` |
| **Validator** | Pass — any call to a function defined within the snippet that does not use blocked constructs |
| **Events emitted** | `function.call` (optional for simple inline expressions), `function.return` |
| **UI behavior** | Inline step-through for simple expressions. For multi-statement functions: step through each statement. |
| **Example** | `function add(a, b) { return a + b; } add(1, 2)` |

---

## 13. Callback passed to executor (foreign callback pattern)

| Dimension | Decision |
|-----------|----------|
| **Capability** | `partial` |
| **Validator** | **Soft pass with warning** — the validator cannot determine whether the called function is safe. The executor body may be allowed to call a user-defined helper. But if the call target is not declared in the snippet (i.e., it's an imported/global function), it is `unsupported`. |
| **Events emitted** | `promise.created`, `executor.started`, `function.call` (to the callback wrapper), then **gap** — the actual resolution is opaque |
| **UI behavior** | Show: promise created → executor started → foreign callback invoked → then a warning node: *"Resolution of this callback is outside the traceable scope."* |
| **Edge case** | `const delay = (fn) => new Promise(r => setTimeout(r, 100)); new Promise(resolve => delay(resolve))` — the `delay` call is in-scope if `delay` is defined in the snippet, but it uses `setTimeout` internally → validator must **reject** `delay` itself. So the whole pattern becomes `unsupported`. |
| **Example** | `new Promise(resolve => process.nextTick(resolve))` → `unsupported` (global `process` is not declared in snippet) |
| **Safe example** | `function wrap(resolve) { resolve(1); } new Promise(wrap)` → **full** — the wrapper is a named function declared in snippet, executor calls it synchronously, `resolve` is called, promise settles. All traceable. |

---

## 14. Summary Table

| Construct | Capability | Validator | Notes |
|-----------|-----------|-----------|-------|
| `Promise.resolve(x)` | `full` | Pass | — |
| `Promise.reject(x)` | `full` | Pass | — |
| `new Promise((res) => { res(x); })` | `full` | Pass | Sync executor only |
| `new Promise(...` + throw) | `full` | Pass | Sync throw |
| `new Promise(...` + setTimeout) | `unsupported` | Hard reject | — |
| `new Promise(...` + foreign callback) | `unsupported` | Hard reject | — |
| Self-referential promise | `unsupported` | Hard reject | M1 decision |
| `p.then(fn)` | `full` | Pass | — |
| `p.then(fn).then(fn)` | `full` | Pass | — |
| `p.then(async fn)` | `partial` | Soft pass | Nested await traced |
| `p.catch(fn)` | `full` | Pass | — |
| `p.finally(fn)` | `full` | Pass | Flag `finally` events |
| `async function f() { await p }` | `full` | Pass | — |
| `async f() { await p; await q }` | `full` | Pass | — |
| `async f() { return await p }` | `full` | Pass | — |
| `async f() { try { await p } catch(e){} }` | `full` | Pass | — |
| `async f() { try { await p } finally {} }` | `full` | Pass | — |
| `async f() { await f2() }` | `full` | Soft pass | f2 must be in-scope async |
| `const f = async () => {}` | `full` | Pass | — |
| Top-level `await` | `unsupported` | Hard reject | — |
| `setTimeout(...)` / timers | `unsupported` | Hard reject | — |
| `Promise.all` / race / settled / any | `unsupported` | Hard reject | — |
| `fetch(...)` / network | `unsupported` | Hard reject | — |
| DOM APIs | `unsupported` | Hard reject | — |
| `import` / `import()` | `unsupported` | Hard reject | — |
| Arbitrary thenable | `unsupported` | Hard reject | — |
| Promise subclass | `unsupported` | Hard reject | — |
| `eval` / `Function` | `unsupported` | Hard reject | — |
| `console.log(...)` | `full` | Pass | — |
| Sync function call | `full` | Pass | — |
| Foreign callback in executor | `unsupported` | Hard reject | — |
| In-scope sync wrapper in executor | `full` | Pass | — |

---

## 15. Open Questions / Future (M2+)

1. **Async handler deep tracing:** Should the validator recursively inspect async function bodies to flag unsupported constructs inside handlers? Currently: flag the call site. M2: full body analysis.

2. **Recursive async functions:** Currently handled by `maxNestedAsyncDepth` (hard error at limit). M2: a "max recursion" UI treatment instead of hard error.

3. **Async iterators / generators:** Not considered for M1. M2+.

4. **Custom thenables with safe semantics:** If a thenable is *known* to follow Promise/A+ (i.e., calls `resolve` or `reject` exactly once, asynchronously), could we support it as `partial`? Requires runtime detection. M2.

5. **`Promise.try(fn)`:** Not in spec. M2 candidate.

6. **Structured clone failures:** If a serialized value cannot be cloned back to the main thread, what is the behavior? (Console entries, error values). **Needs decision.**
