# Visual Promise - Revised Specification

## 1. Project Overview

**Name:** Visual Promise  
**Type:** Web application (Vite + React)  
**Primary goal:** Visualize a **pedagogical execution model** of Promises and `async/await` for supported JavaScript snippets.  
**Target users:** Developers learning JavaScript async behavior, educators, interview preparation, and debugging/teaching scenarios.

### Core product promise
Visual Promise does **not** aim to expose the browser's internal call stack or native microtask queue directly. Instead, it provides a **controlled, explainable, deterministic model** of Promise and `async/await` execution for a supported subset of JavaScript.

This distinction is deliberate:
- the product is primarily **pedagogical**, not a low-level runtime inspector
- correctness of the teaching model matters more than pretending to expose engine internals
- the architecture must support growth beyond the MVP without major rewrites

---

## 2. Product Goals

### 2.1 Primary goals
- Let the user paste or write a JavaScript snippet inside the app
- Execute the snippet in a controlled environment
- Produce a deterministic event log describing Promise / `async/await` behavior
- Replay execution step by step in a visual UI
- Help the user understand:
  - when promises are created and settled
  - when reactions are registered and enqueued
  - when async functions suspend and resume
  - how the logical call stack changes over time
  - how console output relates to execution order

### 2.2 Non-goals for MVP
- Inspecting real browser internals directly
- Supporting arbitrary JavaScript
- Supporting all host/browser async APIs
- Emulating the full ECMAScript event loop
- Supporting all Promise edge cases from day one

---

## 3. MVP Scope

### 3.1 Supported snippet profile (MVP)
The MVP supports a **closed, explicitly defined subset** of JavaScript.

#### Supported constructs
- `Promise.resolve(value)`
- `Promise.reject(error)`
- `new Promise((resolve, reject) => { ... })` with **synchronous executor logic only**
- `.then(...)`
- `.catch(...)`
- `.finally(...)`
- `async function ...`
- `await <supported-promise-expression>`
- regular function calls used in the snippet
- `console.log(...)`
- nested async functions in simple supported patterns

#### Supported pedagogical behavior
- Promise creation and settlement
- reaction registration (`then/catch/finally` handlers)
- conceptual microtask enqueue / dequeue
- async function enter / suspend / resume / exit
- logical call stack visualization
- console output replay
- forward stepping through execution
- replay from the beginning

### 3.2 Explicitly unsupported in MVP
- `setTimeout`, `setInterval`, `requestAnimationFrame`
- DOM APIs
- `fetch` and network access
- imports / modules / multiple files
- top-level `await`
- `Promise.all`, `Promise.race`, `Promise.allSettled`, `Promise.any`
- arbitrary thenables
- Promise subclasses
- host callbacks and browser event APIs
- highly dynamic metaprogramming patterns
- unbounded code with unknown environment dependencies

### 3.3 Partial/degraded support policy
If a snippet contains unsupported constructs, the app should:
- fail fast during validation when possible
- show a clear pedagogical diagnostic
- explain whether the pattern is:
  - unsupported
  - partially supported
  - planned for a later version

The MVP should prefer **explicit rejection** over silently misleading visualization.

---

## 4. Product Principles

1. **Pedagogical correctness over runtime mimicry**  
   The visualization should teach the right mental model, even if it is not a literal dump of engine internals.

2. **Determinism over broad coverage**  
   Better to support fewer snippets well than many snippets unreliably.

3. **Replay-first architecture**  
   Execution generates an event log first; the UI replays that log.

4. **Extensibility from day one**  
   The MVP must not be hardcoded around a handful of demo snippets.

5. **Explicit capability boundaries**  
   The system should know what it supports and communicate unsupported patterns clearly.

---

## 5. High-Level Architecture

### 5.1 Pipeline

```text
User Input
  → Capability Validator
  → Parser / Normalizer
  → Transformer / Instrumenter
  → Traced Runtime Execution
  → Canonical Event Log
  → State Reducer / Timeline Builder
  → UI Replay Renderer
```

### 5.2 Architectural layers

#### A. Capability Validator
Responsible for:
- checking whether the snippet is within the supported subset
- detecting unsupported constructs early
- returning diagnostics before execution

#### B. Parser / Normalizer
Responsible for:
- parsing source code into AST
- normalizing patterns where useful
- attaching source location metadata for later mapping

#### C. Transformer / Instrumenter
Responsible for:
- rewriting supported constructs into a traced runtime model
- injecting hooks without coupling to UI code
- producing:
  - instrumented code
  - metadata/source mapping
  - support diagnostics if needed

#### D. Runtime
Responsible for:
- executing the instrumented snippet in isolation
- exposing tracing helpers (conceptually `__vp.*`)
- maintaining semantic execution entities
- emitting ordered runtime events

#### E. Event Log / Timeline Layer
Responsible for:
- storing atomic runtime events in deterministic order
- deriving timeline state from events
- supporting replay and future step-back behavior

#### F. UI Replay Layer
Responsible for:
- rendering the current replay step
- showing logical call stack
- showing conceptual microtask queue
- showing promise/reaction state
- showing console output
- presenting step explanations and warnings

---

## 6. Technical Stack

### 6.1 Recommended MVP stack
- **Frontend:** React + Vite
- **Styling:** styled-components
- **Editor:** CodeMirror (preferred for MVP simplicity)
- **Parsing/transform:** Babel
  - `@babel/parser`
  - `@babel/traverse`
  - `@babel/generator`
  - `@babel/types`
- **Execution isolation:** Web Worker
- **State management:** React state + reducer-based replay model

### 6.2 Backend requirement
No backend is required for the MVP.

However:
- execution must be isolated from the main UI thread
- safety is limited because browser-side isolation is not a hardened sandbox
- the product must present itself as a controlled educational runtime, not a secure arbitrary-code runner

---

## 7. Execution Model Contract

This is the most important extensibility layer in the system.

### 7.1 Core idea
The runtime emits a **canonical event log** describing semantic execution.
The UI does not depend directly on AST transform details or execution implementation.

### 7.2 Core runtime entities
The internal runtime model should be able to represent at least:
- `ExecutionFrame`
- `PromiseRecord`
- `ReactionRecord`
- `ContinuationRecord`
- `ConsoleRecord`
- `RuntimeErrorRecord`

### 7.3 Canonical event categories
Initial event schema should reserve space for at least:
- `execution.start`
- `execution.end`
- `frame.enter`
- `frame.exit`
- `promise.create`
- `promise.settle`
- `reaction.register`
- `reaction.enqueue`
- `reaction.run`
- `await.suspend`
- `await.resume`
- `console.output`
- `error.throw`
- `error.catch`
- `error.unhandled`

Not all categories must be fully visualized in MVP, but the semantic space should exist.

### 7.4 Event requirements
Each event should include, where applicable:
- stable entity IDs
- sequence number / logical timestamp
- parent/child references
- source location mapping
- human-readable label where useful
- payload data relevant to replay

### 7.5 Replay model
The UI should consume:
- either the raw event log + reducer
- or a derived timeline built from the event log

The contract should preserve the ability to:
- step forward deterministically
- reset replay
- later support step backward and timeline scrubbing
- add new views without changing the runtime contract

---

## 8. Runtime Strategy

### 8.1 Recommended runtime approach
Use **AST transformation + traced runtime helpers** as the primary architecture.

Examples of conceptual transformation:
- `console.log(x)` → traced console helper
- `Promise.resolve(v)` → runtime-tracked Promise creation
- `p.then(fn)` → runtime-tracked reaction registration
- `async function f() { ... }` → transformed form that emits enter / suspend / resume / exit semantics

### 8.2 Important architectural rule
**Monkey-patching native `Promise` must not be the core architectural abstraction.**
It may be used as an implementation aid in limited cases, but the product architecture should be built around a **runtime trace API** and a semantic event model.

### 8.3 Modeling `await`
`await` should be modeled conceptually as:
1. enter async frame
2. evaluate awaited promise expression
3. suspend current async frame
4. associate continuation with the awaited promise
5. enqueue continuation when promise settles
6. resume async frame later

This model enables future support for:
- nested awaits
- multiple async functions
- richer causal visualization
- broader Promise composition support later

---

## 9. Visualization Model

### 9.1 UI panels for MVP
The MVP should include at least:
- **Code editor**
- **Logical call stack panel**
- **Conceptual microtask queue panel**
- **Console output panel**
- **Controls panel**
- **Step explanation / diagnostics panel**

### 9.2 Important terminology rule
The UI should avoid teaching that "promises themselves sit in the microtask queue".

The queue should be described as containing:
- reactions
- continuations
- scheduled microtasks

not simply "pending promises".

### 9.3 Step semantics
A "step" should be defined as:
- application of one atomic event
- or one carefully defined atomic replay unit

This must be explicit and stable.

### 9.4 UX requirements for extensibility
Even in MVP, the UI should already support:
- numbered steps
- textual explanation of the current step
- stable labels/IDs for promises and tasks where useful
- a warning surface for unsupported patterns
- visual language that can later grow to multiple queues/types of async work

---

## 10. Controls

### MVP controls
- Run / Visualize
- Play
- Pause
- Next step
- Reset to beginning

### Deferred controls
The following are explicitly deferred until the replay model is stable:
- Step backward
- Timeline scrubber
- Advanced speed controls

These can be added later once the event contract and reducer are stable.

---

## 11. Example Pedagogical Interpretation

Input example:

```js
const p1 = Promise.resolve();

const innerTask = async () => {
  await Promise.resolve();
  await Promise.resolve();

  console.log('innerTask');
}

const task1 = async () => {
  console.log('task1');

  innerTask();
}

const task2 = () => {
  console.log('task2')
}

const task3 = async () => {
  console.log('task3');
}

p1.then(task1).then(task2).then(task3);
```

Example interpretation should teach something closer to:
- `p1` is created and fulfilled
- attaching `.then(task1)` registers a reaction
- because `p1` is already fulfilled, the reaction becomes eligible to enqueue as a conceptual microtask
- the microtask is dequeued and `task1` runs
- `task1` logs output and calls `innerTask`
- `innerTask` suspends on `await`, registering a continuation
- that continuation is later enqueued and resumed
- subsequent reactions continue in deterministic order

This is pedagogically more accurate than saying the promise itself enters the queue.

---

## 12. Product Constraints / Guardrails

### 12.1 Execution guardrails
The MVP should enforce:
- snippet size limit
- maximum event count per run
- execution timeout
- worker termination/reset on runaway execution
- no network access
- no external module loading

### 12.2 Unsupported diagnostics
If validation fails, the system should show:
- what construct was detected
- why it is unsupported
- whether it is planned for a later phase
- ideally a suggestion for a simpler supported rewrite

### 12.3 Trust model
The app is a pedagogical tool, not a secure arbitrary-code sandbox.
This must be reflected in both implementation and user messaging.

---

## 13. MVP Milestones (Revised)

### Milestone 1 — Execution model and contracts
- define supported snippet profile
- define canonical event schema
- define replay state shape
- define unsupported diagnostics behavior

### Milestone 2 — Parser, validator, transformer foundation
- Babel-based parsing
- capability validation
- source mapping metadata
- transform supported Promise/async constructs into traced runtime form

### Milestone 3 — Runtime and event log
- isolated execution in worker
- runtime trace helpers
- deterministic event log generation
- console capture

### Milestone 4 — Replay engine and base visualization
- reducer/timeline builder
- call stack panel
- conceptual microtask queue panel
- console panel
- step explanation panel

### Milestone 5 — Controls and UX polish
- Run / Play / Pause / Next / Reset
- example snippets
- warnings and unsupported diagnostics
- clearer labels and annotations

---

## 14. Roadmap Beyond MVP

### v1 — Greater Promise/async depth
Potential additions:
- richer rejection/error flow visualization
- better `await` causality tracking
- more complex chains
- `try/catch/finally`
- branching and more nested supported patterns
- improved snippet diagnostics
- example library by difficulty

### v2 — Broader event-loop model
Potential additions:
- `setTimeout`
- `queueMicrotask`
- macrotask queue visualization
- multiple queue types
- mixed Promise + timer scenarios
- richer causal graphs

### Long-term possibilities
- `Promise.all` / `race` / `allSettled` / `any`
- export/import runs
- compare two executions
- interview/exercise mode
- more advanced explanation modes

---

## 15. Open Questions (Reduced and Focused)

The following questions may remain open, but only after the core contract is fixed:

1. Should the initial editor be CodeMirror now and Monaco later, or should Monaco be accepted immediately despite the added weight?
2. Should step-back in the first post-MVP version be implemented via reducer replay only, or via cached derived snapshots?
3. What is the best diagnostic UX for partially supported snippets?
4. When should Promise combinators enter the roadmap: v1 or v2?

The following decisions are **no longer open** in this revised spec:
- use AST transformation + traced runtime as the primary approach
- do not make monkey-patching the core architecture
- use a replay-first model
- define a closed supported subset for MVP
- separate runtime semantics from UI rendering

---

## 16. Summary

Visual Promise should begin as a **small but principled pedagogical runtime visualizer** for Promises and `async/await`.

Its success depends on:
- a clear supported subset
- deterministic semantic events
- replay-driven visualization
- explicit boundaries
- an architecture that can expand from Promise chains to richer async behavior later

The MVP should not try to be a complete JavaScript runtime inspector.
It should be a trustworthy, explainable learning tool with an extensible core.

---

*Created: 2026-03-17*  
*Status: Revised draft based on PM + dev review*
