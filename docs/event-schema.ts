/**
 * Visual Promise — Canonical Event Schema
 * ========================================
 *
 * This file defines every event type that can appear in the runtime → UI
 * event log. The event log is the ONLY contract between the instrumented
 * worker and the React UI. The UI never inspects AST details or execution
 * internals; it only consumes these events.
 *
 * DESIGN PRINCIPLES
 * -----------------
 * - Every event has a monotonically-incrementing `seq` assigned inside the
 *   worker. This is the ground truth for ordering — NOT postMessage arrival.
 * - Every event carries a `timestamp` (ISO-8601) from performance.timeOrigin
 *   so the UI can display real elapsed time.
 * - Events are atomic: applying one event to the replay state must produce a
 *   state that is self-consistent. No partial updates.
 * - `data` is always type-safe and specific to the event variant.
 *
 * TIMELINE OF A PROMISE
 * ----------------------
 * 1. `promise.create`        — Promise object allocated
 * 2. `reaction.register`     — .then/.catch/.finally attached
 * 3. `reaction.enqueue`      — handler added to microtask queue (if promise already settled)
 * 4. `promise.settle`        — promise resolves or rejects
 * 5. `reaction.enqueue`      — newly-queued reactions added (from step 2, if promise was already settled this queues immediately)
 * 6. `reaction.run`          — microtask queue drains, handler executes
 * 7. `promise.reaction.fire` — the handler runs WITH the settled value/reason
 *    (step 7 is distinct from step 6: "run" = dequeue, "fire" = execute fn body)
 * 8. If the handler returns a value → may create a new promise (→ step 1)
 * 9. If the handler throws → `error.throw`
 *
 * AWAIT IN ASYNC FUNCTIONS
 * ------------------------
 * `await expr` is syntactic sugar for:
 *   Promise.resolve(expr).then($resume)
 * We model it with separate events:
 * - `await.suspend`: the async function frame pauses, waiting for the promise
 * - `await.resume`:  the promise settled, the frame is re-entered with the value
 * These are separate from `frame.suspend`/`frame.resume` because an async
 * function can suspend at await AND block on other promises independently.
 *
 * `frame.suspend` / `frame.resume` track the async frame lifecycle across
 * multiple awaits and microtask boundaries.
 */

// ─── Shared event envelope ────────────────────────────────────────────────────

export interface BaseEvent {
  /** Monotonically increasing sequence number, assigned by the worker. */
  seq: number;
  /** ISO-8601 timestamp from performance.timeOrigin inside the worker. */
  timestamp: string;
}

// ─── Execution lifecycle ─────────────────────────────────────────────────────

/**
 * execution.start
 * Fires when the instrumented code snippet begins evaluation.
 * This is always the very first event in a log.
 */
export interface ExecutionStartEvent extends BaseEvent {
  type: "execution.start";
  data: {
    /** The raw source code string being executed. */
    snippet: string;
    /** A stable identifier for the top-level entry point (e.g. "module#<n>" or "eval#<n>"). */
    entryId: string;
  };
}

/**
 * execution.end
 * Fires when the top-level evaluation completes — either normally or via an
 * uncaught exception. This is always the very last event in a log.
 */
export interface ExecutionEndEvent extends BaseEvent {
  type: "execution.end";
  data:
    | {
        /** `true` = normal completion, `false` = thrown/uncaught. */
        ok: true;
      }
    | {
        ok: false;
        /** The Error object message. */
        message: string;
        /** Formatted stack trace string. */
        stack: string;
      };
}

// ─── Call frames ─────────────────────────────────────────────────────────────

/**
 * frame.enter
 * Fires synchronously when evaluation enters a new function frame.
 * Includes both regular and async functions.
 */
export interface FrameEnterEvent extends BaseEvent {
  type: "frame.enter";
  data: {
    /** Unique frame identifier, stable across suspend/resume. */
    frameId: string;
    /** Human-readable function name (falls back to "(anonymous)" or "(async)"). */
    name: string;
    /** "script" | "module" | "eval" | "arrow" | "function" | "async" | "asyncArrow" */
    kind: FrameKind;
    /** seq of the frame.exit event (informational, for UI labels). */
    exitSeq: number;
    /** seq of the matching frame.enter event in the parent, or null for the root. */
    parentSeq: number | null;
    /** 1-indexed position in source (column). */
    startColumn: number;
    /** 1-indexed position in source (column). */
    endColumn: number;
    /** 1-indexed line number in source. */
    startLine: number;
    /** 1-indexed line number in source. */
    endLine: number;
  };
}

/**
 * frame.suspend
 * Fires when an async function's frame stops executing at an await boundary.
 * The frame is parked until the awaited promise settles.
 * A frame may suspend multiple times (once per await it contains).
 */
export interface FrameSuspendEvent extends BaseEvent {
  type: "frame.suspend";
  data: {
    frameId: string;
    /** The awaited expression rendered as a string (e.g. "Promise.resolve()"). */
    awaitExpr: string;
    /** seq of the promise that is being awaited (the one that will unblock this frame). */
    awaitedPromiseId: string;
  };
}

/**
 * frame.resume
 * Fires when the awaited promise has settled and the async function's frame
 * is re-entered to continue execution. This happens after the microtask
 * that resolved the promise runs.
 */
export interface FrameResumeEvent extends BaseEvent {
  type: "frame.resume";
  data: {
    frameId: string;
    /** Whether the awaited promise resolved (true) or rejected (false). */
    settled: boolean;
    /** The resolved value (if settled === true). */
    value?: unknown;
    /** The rejection reason (if settled === false). */
    reason?: unknown;
  };
}

/**
 * frame.exit
 * Fires when evaluation exits a function frame, either by reaching the end,
 * an explicit return, or a thrown error that escapes the frame boundary.
 */
export interface FrameExitEvent extends BaseEvent {
  type: "frame.exit";
  data: {
    frameId: string;
    /** `true` if the frame returned normally, `false` if a throw propagated out. */
    normal: boolean;
    /** The return value, present only when `normal === true`. */
    returnValue?: unknown;
  };
}

// ─── Promise lifecycle ───────────────────────────────────────────────────────

/**
 * promise.create
 * Fires when a `new Promise(executor)` is constructed. The executor runs
 * synchronously inside this event; reactions may be registered immediately.
 */
export interface PromiseCreateEvent extends BaseEvent {
  type: "promise.create";
  data: {
    promiseId: string;
    /** "Promise" | "AsyncFunction" (implicit Promise wrapping an async fn) | "Thenable" */
    constructor: PromiseConstructorType;
    /** seq of the frame.enter event for the async function body, if constructor === "AsyncFunction". */
    asyncFrameId?: string;
  };
}

/**
 * promise.settle
 * Fires when a TrackedPromise transitions from pending → fulfilled or pending → rejected.
 * This is the canonical "resolved/rejected" event for the UI.
 */
export interface PromiseSettleEvent extends BaseEvent {
  type: "promise.settle";
  data: {
    promiseId: string;
    /** "fulfilled" | "rejected" */
    state: "fulfilled" | "rejected";
    /** The resolved value (present when state === "fulfilled"). */
    value?: unknown;
    /** The rejection reason (present when state === "rejected"). */
    reason?: unknown;
  };
}

// ─── Reaction lifecycle ───────────────────────────────────────────────────────

/**
 * reaction.register
 * Fires when a .then / .catch / .finally handler is attached to a TrackedPromise.
 * This happens synchronously during executor code or when chaining.
 */
export interface ReactionRegisterEvent extends BaseEvent {
  type: "reaction.register";
  data: {
    reactionId: string;
    /** The promise on which .then/.catch/.finally was called. */
    promiseId: string;
    /** "then" | "catch" | "finally" */
    handlerType: "then" | "catch" | "finally";
    /** Index of this handler in the promise's reaction list (0-based). */
    index: number;
  };
}

/**
 * reaction.enqueue
 * Fires when a registered reaction is added to the microtask queue.
 * A reaction is enqueued when its source promise settles (if it was already
 * settled at registration time) OR immediately after registration (if the
 * source promise was already settled).
 *
 * This is an explicit event (not derived) because:
 * - It is a distinct conceptual step in the Promise/A+ spec
 * - The PM wants pedagogical clarity: students should see "enqueue" happen
 *   as a separate moment from "register"
 * - It maps cleanly to the visual metaphor of a queue growing/shifting
 */
export interface ReactionEnqueueEvent extends BaseEvent {
  data: {
    reactionId: string;
    promiseId: string;
    /** Index in the microtask queue at the moment of enqueuing (0 = front). */
    queuePosition: number;
    /** Total queue depth after this enqueue (informational for UI). */
    queueDepth: number;
  };
  type: "reaction.enqueue";
}

/**
 * reaction.run
 * Fires when a reaction is dequeued from the microtask queue and is about to
 * execute. This marks the moment the JS engine transfers control to the handler.
 */
export interface ReactionRunEvent extends BaseEvent {
  type: "reaction.run";
  data: {
    reactionId: string;
    /** "fulfilled" | "rejected" — which path the microtask will take. */
    settlementType: "fulfilled" | "rejected";
    /** The value/reason that triggered this handler. */
    settlementValue: unknown;
  };
}

/**
 * promise.reaction.fire
 * Fires when the reaction handler function body actually executes — i.e. when
 * the then/catch/finally callback code runs with the settled value or reason.
 *
 * DISTINCTION FROM reaction.run:
 * - `reaction.run`: the microtask is dequeued and JS engine begins executing the handler
 * - `promise.reaction.fire`: the callback function body runs with the resolved/rejected value
 *
 * Having both allows the UI to animate: dequeue → fire separately (e.g. show
 * the reaction "jumping off" the queue before the handler body executes).
 */
export interface PromiseReactionFireEvent extends BaseEvent {
  type: "promise.reaction.fire";
  data: {
    reactionId: string;
    /** The promise that produced this reaction's settlement value. */
    sourcePromiseId: string;
    /** "fulfilled" | "rejected" */
    settlementType: "fulfilled" | "rejected";
    /** The value or reason the handler received as its argument. */
    settlementValue: unknown;
  };
}

// ─── Await ───────────────────────────────────────────────────────────────────

/**
 * await.suspend
 * Fires when an `await <expr>` expression suspends the enclosing async function.
 * The awaited expression is evaluated, converted to a promise, and the async
 * function parks here until that promise settles.
 *
 * Note: `await.suspend` is the await-specific analogue of `frame.suspend`.
 * Both can fire for the same await point (frame.suspend covers the general
 * async-frame lifecycle; await.suspend covers the expression-level detail).
 */
export interface AwaitSuspendEvent extends BaseEvent {
  type: "await.suspend";
  data: {
    frameId: string;
    /** The awaited expression as written in source (e.g. "Promise.resolve()"). */
    awaitExpr: string;
    /** The promise returned by evaluating the await expression. */
    awaitedPromiseId: string;
  };
}

/**
 * await.resume
 * Fires when the awaited promise settles and the async function resumes
 * execution with the resolved value (or propagates the rejection).
 */
export interface AwaitResumeEvent extends BaseEvent {
  type: "await.resume";
  data: {
    frameId: string;
    /** `true` if the awaited promise resolved, `false` if it rejected. */
    settled: boolean;
    /** The resolved value (if settled === true). */
    value?: unknown;
    /** The rejection reason (if settled === false). */
    reason?: unknown;
  };
}

// ─── finally() ───────────────────────────────────────────────────────────────

/**
 * finally.register
 * Fires when a `.finally(onFinally)` handler is attached to a TrackedPromise.
 * Unlike .then/.catch, a .finally handler receives NO argument (it ignores
 * the settlement value/reason — it just passes it through).
 */
export interface FinallyRegisterEvent extends BaseEvent {
  type: "finally.register";
  data: {
    reactionId: string;
    promiseId: string;
    /** The reactionId of the implicit pass-through reaction created alongside this finally. */
    passThroughReactionId: string;
  };
}

/**
 * finally.complete
 * Fires when the .finally() handler function body has finished executing.
 * This fires regardless of whether the handler returned normally or threw.
 * If it threw, the throw becomes the new settlement of the pass-through promise.
 */
export interface FinallyCompleteEvent extends BaseEvent {
  type: "finally.complete";
  data: {
    reactionId: string;
    /** `true` if the handler completed without throwing. */
    ok: boolean;
    /** The return value of the handler, if `ok === true`. */
    returnValue?: unknown;
    /** The error thrown by the handler, if `ok === false`. */
    throwValue?: unknown;
  };
}

// ─── Console ─────────────────────────────────────────────────────────────────

/**
 * console.output
 * Fires for console.log and console.info output.
 */
export interface ConsoleOutputEvent extends BaseEvent {
  type: "console.output";
  data: {
    /** "log" | "info" */
    method: "log" | "info";
    /** Serialised arguments (strings, numbers, objects via JSON.stringify-safe repr). */
    args: unknown[];
  };
}

/**
 * console.warn
 * Fires for console.warn output.
 */
export interface ConsoleWarnEvent extends BaseEvent {
  type: "console.warn";
  data: {
    method: "warn";
    args: unknown[];
  };
}

/**
 * console.error
 * Fires for console.error output.
 */
export interface ConsoleErrorEvent extends BaseEvent {
  type: "console.error";
  data: {
    method: "error";
    args: unknown[];
  };
}

// ─── Errors ──────────────────────────────────────────────────────────────────

/**
 * error.throw
 * Fires when `throw` executes — either an explicit `throw <expr>` or an
 * uncaught exception. This is the **origin** of an error in the call stack.
 *
 * CONTRAST WITH error.reject:
 * - `error.throw`: a synchronous `throw` statement executes, or an error
 *   originates inside a non-Promise context (e.g. inside a regular function)
 * - `error.reject`: a Promise is explicitly settled with Promise.reject()
 *   or an async function throws (which becomes a Promise rejection)
 *
 * CONTRAST WITH error.unhandled:
 * - `error.throw` is the moment the error is CREATED
 * - `error.unhandled` is the moment the error ESCAPES all handlers
 */
export interface ErrorThrowEvent extends BaseEvent {
  type: "error.throw";
  data: {
    frameId: string;
    /** The thrown value (usually an Error instance). */
    error: unknown;
    /** Human-readable error message. */
    message: string;
    /** Stack trace string. */
    stack: string;
  };
}

/**
 * error.reject
 * Fires when a Promise transitions to the rejected state — specifically
 * via Promise.reject() or an async function body throwing.
 *
 * This is distinct from `promise.settle` with state "rejected" in that
 * `error.reject` annotates the *cause* (a throw) whereas `promise.settle`
 * only records the state transition.
 */
export interface ErrorRejectEvent extends BaseEvent {
  type: "error.reject";
  data: {
    promiseId: string;
    /** The rejection reason (usually an Error instance). */
    reason: unknown;
    /** Human-readable reason message. */
    message: string;
  };
}

/**
 * error.catch
 * Fires when a thrown error is caught by a try/catch block.
 * This is NOT the same as a `.catch()` handler on a Promise.
 */
export interface ErrorCatchEvent extends BaseEvent {
  type: "error.catch";
  data: {
    frameId: string;
    /** The caught error value. */
    error: unknown;
    /** Human-readable error message. */
    message: string;
  };
}

/**
 * error.unhandled
 * Fires when a Promise rejection escapes ALL registered handlers — i.e.
 * when the rejection has no `.catch()` or `.then(null, fn)` and the
 * microtask that would carry the rejection also has no handler.
 *
 * This is a runtime-level event: by the time this fires, the error has
 * propagated through the entire chain and found no handler.
 *
 * CONTRAST WITH error.throw:
 * - `error.throw`: synchronous throw or rejection ORIGIN (the error is born)
 * - `error.unhandled`: rejection that has ESCAPED all handlers (nobody caught it)
 *
 * Both `error.throw` and `error.unhandled` may appear in the same log:
 * an error is thrown inside an async function (→ error.throw), the async
 * function's promise rejects (→ error.reject), and if nobody catches it
 * (→ error.unhandled), this event fires too.
 */
export interface ErrorUnhandledEvent extends BaseEvent {
  type: "error.unhandled";
  data: {
    promiseId: string;
    /** The unhandled rejection reason. */
    reason: unknown;
    /** Human-readable reason message. */
    message: string;
    /** Stack trace string (may be empty if the rejection originated from a silent Promise.reject). */
    stack: string;
  };
}

// ─── Union type ──────────────────────────────────────────────────────────────

/**
 * VPPEvent
 * The complete union of all event types in the Visual Promise event log.
 * This is the only type the UI ever needs to import from the worker contract.
 */
export type VPPEvent =
  | ExecutionStartEvent
  | ExecutionEndEvent
  | FrameEnterEvent
  | FrameSuspendEvent
  | FrameResumeEvent
  | FrameExitEvent
  | PromiseCreateEvent
  | PromiseSettleEvent
  | ReactionRegisterEvent
  | ReactionEnqueueEvent
  | ReactionRunEvent
  | PromiseReactionFireEvent
  | AwaitSuspendEvent
  | AwaitResumeEvent
  | FinallyRegisterEvent
  | FinallyCompleteEvent
  | ConsoleOutputEvent
  | ConsoleWarnEvent
  | ConsoleErrorEvent
  | ErrorThrowEvent
  | ErrorRejectEvent
  | ErrorCatchEvent
  | ErrorUnhandledEvent;

// ─── Utility types ────────────────────────────────────────────────────────────

/** Frame kind taxonomy for frame.enter / frame.suspend events. */
export type FrameKind =
  | "script"
  | "module"
  | "eval"
  | "arrow"
  | "function"
  | "async"
  | "asyncArrow";

/** Constructor type for promises created by the instrumented runtime. */
export type PromiseConstructorType =
  | "Promise"
  | "AsyncFunction"
  | "Thenable";

/** Handler type for reactions. */
export type ReactionHandlerType = "then" | "catch" | "finally";

/** Console method taxonomy. */
export type ConsoleMethod = "log" | "info" | "warn" | "error";
