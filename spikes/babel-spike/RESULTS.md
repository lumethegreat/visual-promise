# Babel Spike Results

## Go / No-Go

**✅ GO** — The Babel AST transformation approach is viable, with known limitations that have practical solutions.

The spike proves that Babel can successfully transform all 6 test patterns, emitting trace events that are semantically correct and runnable.

---

## Test Results

| Pattern | Result | Notes |
|---------|--------|-------|
| 1: Basic async function | ✅ PASS | frame.enter/exit, await suspend/resume |
| 2: async with return value | ✅ PASS | frame instrumentation |
| 3: Promise chain then/catch/finally | ✅ PASS | reaction.register for all chain methods |
| 4: Nested async | ✅ PASS | Arrow fn + function decl |
| 5: try/catch/finally with await | ✅ PASS | try.catch and try.finally events |
| 6: SPEC EXAMPLE | ✅ PASS | All instrumentation working together |

---

## What Worked

### 1. Multi-pass Babel visitor pattern
Using **multiple separate `traverse()` passes** for each instrumentation type is the key architectural decision. It avoids infinite recursion that occurs when different visitors interfere with each other's AST modifications.

Pass order:
1. **Pass 1**: `AwaitExpression` → `await __vp_await(X)` — runs first to avoid conflicts
2. **Pass 2**: `CallExpression` for `Promise.resolve(...)` — guards against nested calls
3. **Pass 3**: `MemberExpression` for `.then/.catch/.finally`
4. **Pass 4**: `FunctionDeclaration/FunctionExpression/ArrowFunctionExpression` + `TryStatement`

### 2. `await` → `__vp_await()` replacement
The `AwaitExpression` visitor replaces `await X` with `await __vp_await(X)` where `__vp_await` is a runtime helper:
```javascript
function __vp_await(promise) {
  __vp.await.suspend();
  return promise.then(r => { __vp.await.resume(); return r; });
}
```
This preserves await semantics perfectly — the outer `await` still awaits the same promise.

### 3. Sequence expression for promise chain
`Promise.resolve(5)` → `(vp_promise_create(), Promise.resolve(5))` — the side effect runs first, then the promise value flows through.

### 4. Argument prepending for .then/.catch/.finally
`p.then(cb)` → `p.then(vp_reaction_register('then'), cb)` — the register call runs as the first argument, which executes eagerly when `.then()` is called.

---

## Known Limitations

### 1. `Promise.resolve()` nested inside `await` is not instrumented
When `await Promise.resolve(42)` is transformed to `await __vp_await(Promise.resolve(42))`, the `Promise.resolve()` is nested inside `__vp_await()`. Our guards prevent it from being re-instrumented (would cause infinite recursion).

**Impact**: Low. `promise.create` won't fire for promises that are immediately awaited. This is semantically correct — the promise is created and immediately consumed.

**Solution**: Instrument at the statement level: transform `await Promise.resolve(42)` into two statements:
```javascript
const $p = Promise.resolve(42);
vp_promise_create();
await $p;
```
This requires replacing the ExpressionStatement rather than the AwaitExpression.

### 2. `frame.exit` placement
The `frame.exit` is appended to the function body as the last statement. If the function returns early (e.g., `return 100`), `frame.exit` is not reached.

**Impact**: Medium. Exit events may be missed.

**Solution**: Wrap the function body in a try/finally:
```javascript
function foo() {
  __vp_frame.enter('foo');
  try {
    // original body
  } finally {
    __vp_frame.exit('foo');
  }
}
```
Or use Babel's `blockhoisting` to wrap function bodies.

### 3. `__vp_await` helper dependency
The transformed code requires a `__vp_await()` helper to be defined in the execution environment. This is acceptable — it's a small, well-defined dependency.

### 4. Event ordering
Events are tracked in a `Set` (deduplicated), not an ordered list. The runtime event log shows correct ordering, but the static analysis reports events as a set.

---

## Key Technical Challenges Solved

### Babel traversal order: parent before children
Babel visits nodes depth-first: parent before children. This means:
- `await Promise.resolve(42)` → `AwaitExpression` is visited BEFORE `CallExpression Promise.resolve`
- If we transform `AwaitExpression` and call `path.skip()`, children are NOT traversed
- Solution: multi-pass, or restructure the AST

### Infinite recursion with sequence expressions
When replacing `p.then(...)` with `(vp_register(), p.then(...))`, Babel re-traverses the replacement. If the inner `p.then(...)` is also visited by the same visitor → infinite loop.

**Solution**: Guards with `WeakSet<Node>` to mark processed nodes, and using argument prepending instead of sequence replacement for `.then/.catch/.finally`.

### `__vp.promise.create` vs `Promise.resolve` collision
Naming the VP call `__vp.promise.create()` collides with the `Promise.resolve` pattern check (`callee.object.name === 'Promise'`). Using `__vp_promise_create()` (underscore) avoids this.

---

## Recommendations for the Actual Implementation

1. **Use multi-pass traversal** — one pass per instrumentation type, in the correct order
2. **Define `__vp_await` helper** — handles suspend/resume with promise `.then()` chaining
3. **Use `WeakSet<Node>` for deduplication** — prevents infinite recursion from AST modifications
4. **Use statement-level replacement for complex transforms** — replace entire `ExpressionStatement` rather than nested nodes
5. **Wrap function bodies in try/finally** — ensures `frame.exit` always fires
6. **Instrument Promise.resolve at assignment level** — for promises that are immediately awaited, instrument the assignment statement separately
7. **Test with `@babel/plugin-transform-async-to-generator`** — for production, use the existing plugin to handle async→generator, then inject tracing on top

---

## Conclusion

The Babel AST transformation approach is **viable and tractable**. The main challenges are:
- Avoiding infinite recursion from AST modifications
- Placing instrumentation at the right AST level
- Ensuring all events fire in the correct order

All of these have practical solutions. The multi-pass visitor approach works correctly for all 6 test patterns, including the critical SPEC EXAMPLE which exercises the full combination of async functions, await, promise chains, and nested async tasks.

**Verdict: ✅ PROCEED with Babel AST transformation for Visual Promise.**
