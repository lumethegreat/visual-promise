# ✨ Visual Promise

> A pedagogical tool to visualise how JavaScript Promise and async/await execution really works.

[![CI](https://github.com/lumethegreat/visual-promise/actions/workflows/ci.yml/badge.svg)](https://github.com/lumethegreat/visual-promise/actions)
[![npm version](https://img.shields.io/npm/v/visual-promise)](https://www.npmjs.com/package/visual-promise)
[![License: MIT](https://img.shields.io/github/license/lumethegreat/visual-promise)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.8-blue)](https://www.typescriptlang.org/)

## 🎯 Why?

JavaScript's Promise and `async/await` execution model is notoriously hard to visualise.
Callbacks, microtask queues, event loop scheduling — most developers learn these
concepts the hard way, through bugs and confusion.

**Visual Promise** shows you exactly what happens, step by step:

- ✨ Watch Promise creation and settlement
- 🔍 See the microtask queue in real time
- 📚 Understand why `await` suspends and resumes your code
- ⚡ Step through async execution frame by frame
- 📝 Clear visual feedback for partially supported patterns

## 🚀 Quick Start

```bash
git clone https://github.com/lumethegreat/visual-promise.git
cd visual-promise
npm install
npm run dev
```

Then open [http://localhost:5173](http://localhost:5173) in your browser.

## ✏️ Example

Type or paste this snippet into the editor:

```javascript
async function fetchUser(id) {
  console.log("Fetching user...");
  const user = await Promise.resolve({ id, name: "Alice" });
  console.log("User:", user.name);
  return user;
}

fetchUser(1);
```

Here's what you'll see as you step through it:

| Step | Event | What happens |
|------|-------|--------------|
| 1 | `execution.start` | The worker receives your code |
| 2 | `frame.enter` | `fetchUser` enters the call stack |
| 3 | `console.output` | `"Fetching user..."` appears in the console |
| 4 | `promise.create` | `Promise.resolve(...)` creates a Promise |
| 5 | `await.suspend` | `fetchUser` parks — it can't continue until the Promise settles |
| 6 | `promise.settle` | The Promise resolves to `{ id: 1, name: "Alice" }` |
| 7 | `reaction.enqueue` | The `await` continuation is added to the microtask queue |
| 8 | `reaction.run` | The microtask drains and the continuation starts |
| 9 | `await.resume` | `fetchUser` wakes up with the resolved value |
| 10 | `console.output` | `"User: Alice"` appears in the console |
| 11 | `frame.exit` | `fetchUser` returns the user object |
| 12 | `execution.end` | All done |

## 🧠 How It Works

The architecture is built around a strict **event-driven contract** between the
instrumented worker and the React UI. The UI never pokes at AST internals or
execution state — it only consumes a stream of typed events.

```
┌──────────────┐     ┌──────────────┐     ┌──────────────────────┐
│    Editor    │────▶│   Validator  │────▶│  Babel Transformer    │
│ (CodeMirror) │     │ (capability  │     │  (injects __vp.*     │
└──────────────┘     │   checks)    │     │   trace helpers)     │
                     └──────────────┘     └──────────┬───────────┘
                                                      │
                                          ┌───────────▼───────────┐
                                          │  Web Worker Execution  │
                                          │  (isolated, sandboxed) │
                                          └───────────┬───────────┘
                                                      │
                                          ┌───────────▼───────────┐
                                          │   Ordered Event Log    │
                                          │   (23 event types)     │
                                          └───────────┬───────────┘
                                                      │
                                          ┌───────────▼───────────┐
                                          │  Pure Reducer (state) │
                                          │  replay-reducer.ts    │
                                          └───────────┬───────────┘
                                                      │
                                          ┌───────────▼───────────┐
                                          │   React UI Replay     │
                                          │  (call stack, queue,   │
                                          │   console panels)     │
                                          └───────────────────────┘
```

1. You write JavaScript in the CodeMirror editor.
2. A **capability validator** checks the snippet against the supported subset.
3. **Babel** rewrites `async`/`await` and Promise calls into instrumented form.
4. A **Web Worker** executes the transformed code in full isolation.
5. The worker emits a sequence of typed events back to the main thread.
6. A **pure reducer** applies each event to reconstruct execution state.
7. The **React UI** renders call stack, microtask queue, console output, and
   current source location at each step.

## 🎮 Features

### Execution Controls
- **Step forward** — advance one event at a time
- **Auto-play** — watch execution unfold automatically with adjustable speed (0.5×, 1×, 2×)
- **Step to end** — jump straight to the final state
- **Reset** — return to the beginning

### Call Stack Inspector
- Visual representation of the JavaScript call stack
- Frame states: active (green), suspended (yellow), exited (gray)
- Async function suspension and resumption made visible
- Source location highlighting (line + column)

### Microtask Queue
- Watch `.then` / `.catch` / `.finally` reactions enter and drain the queue
- Queue position tracking (shows "Microtask #1", "Microtask #2", …)
- Clear empty state when queue is fully drained

### Console Panel
- All `console.log / warn / error / info` output captured
- Syntax highlighted by log level (info = blue, warn = yellow, error = red)
- Timestamped event log in sequence order

### Partial Support Warnings
- Not every JavaScript pattern is supported in MVP — that's intentional
- Clear, actionable diagnostics when you use an unsupported construct
- Explains exactly what isn't supported and why

## ⚙️ Supported Patterns

| Pattern | Status | Notes |
|---------|--------|-------|
| `async function` declarations | ✅ Full | |
| `await` expressions | ✅ Full | |
| `Promise.resolve / reject` | ✅ Full | |
| `.then() / .catch() / .finally()` chains | ✅ Full | |
| Multiple async calls in sequence | ✅ Full | |
| Nested async functions | ⚠️ Partial | Depth limited by `maxNestedAsyncDepth` |
| Sync executor (`new Promise(...)`) | ⚠️ Partial | No timers or foreign callbacks |
| `p.then(async fn)` | ⚠️ Partial | Nested awaits traced up to depth limit |
| `Promise.all / race / allSettled / any` | ❌ Unsupported | Planned for v2 |
| Top-level `await` | ❌ Unsupported | Planned for v2 |
| `setTimeout / setInterval` | ❌ Unsupported | Use `await` instead |
| `fetch` / network APIs | ❌ Unsupported | Use `Promise.resolve(...)` to simulate |
| DOM APIs | ❌ Unsupported | No DOM access in the sandboxed Worker |
| ES module imports | ❌ Unsupported | All code must be self-contained |
| Arbitrary thenables | ❌ Unsupported | Only native Promises |

See [docs/capability-matrix.md](docs/capability-matrix.md) for the full breakdown.

## 🏗️ Architecture

### Event-Driven Design

The system is built around a strict event schema — **23 event types**. Each event
represents a meaningful step in Promise/async execution. The UI only knows about
events; it has no access to AST details or execution internals.

| Event | Meaning |
|-------|---------|
| `execution.start` | Worker received code to execute |
| `execution.end` | Top-level evaluation completed |
| `frame.enter` | A function call was entered |
| `frame.suspend` | An async frame parked (waiting for Promise) |
| `frame.resume` | Async frame re-entered after Promise settled |
| `frame.exit` | A function frame returned or propagated an error |
| `promise.create` | A new Promise was constructed |
| `promise.settle` | A Promise resolved or rejected |
| `reaction.register` | A `.then/.catch/.finally` handler was attached |
| `reaction.enqueue` | A handler was added to the microtask queue |
| `reaction.run` | A queued handler started executing |
| `promise.reaction.fire` | The handler function body ran with the settled value |
| `await.suspend` | `await <expr>` paused the enclosing async function |
| `await.resume` | Async function resumed with resolved value or propagated rejection |
| `finally.register` | A `.finally(onFinally)` handler was attached |
| `finally.complete` | The `.finally` handler finished executing |
| `console.output` | A `console.log / info` output was produced |
| `console.warn` | A `console.warn` output was produced |
| `console.error` | A `console.error` output was produced |
| `error.throw` | A synchronous `throw` executed |
| `error.reject` | A Promise transitioned to rejected state |
| `error.catch` | A thrown error was caught by a `try/catch` block |
| `error.unhandled` | A Promise rejection escaped all handlers |

Full schema: [docs/event-schema.ts](docs/event-schema.ts)

### Tech Stack

| Layer | Technology |
|-------|-----------|
| UI Framework | React 18 + TypeScript |
| Bundler | Vite |
| Code Editor | CodeMirror 6 |
| Parser / Transformer | Babel (`@babel/parser`, `@babel/traverse`, `@babel/generator`) |
| Execution | Web Worker (isolated sandbox) |
| State | React `useReducer` (pure reducer) |
| Styling | Plain CSS |
| Testing | Vitest |

## 📂 Project Structure

```
src/
  components/          # React UI components
  hooks/               # useExecution, usePlaybackControls
  lib/                 # replay-reducer, validator, capability-checker
  workers/             # executor.worker.ts
  types/               # Shared TypeScript types
  App.tsx              # Root component
  main.tsx             # Entry point

docs/
  event-schema.ts      # Full event type definitions (23 event types)
  replay-state.ts      # ReplayState + reducer state shape
  capability-matrix.md # Full supported/unsupported pattern catalogue
  partial-support-ux.md# UX guidelines for partial support warnings
  limits-and-config.md  # Runtime limits (max depth, event cap, etc.)

spikes/
  worker-spike/        # Web Worker feasibility experiments
  babel-spike/         # Babel AST transform experiments
```

## 🔬 Milestones

- [x] **M1: Foundation** — Spec, event schema, validator, capability matrix
- [x] **M2: Execution** — Worker, Babel transformer, runtime helpers
- [x] **M3: Replay Engine** — Reducer, `useExecution` hook, playback controls
- [ ] **M4: UI** — Editor, inspector panels, step controls *(in progress)*
- [ ] **M5: Polish** — Error UX, step-back, Promise combinators

## 🤝 Contributing

Contributions are welcome! Please open an issue or pull request on GitHub.

## 📄 License

MIT © Lume
