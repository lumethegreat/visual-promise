/**
 * runtime-vp.ts — Visual Promise runtime helpers
 *
 * These functions are injected into the transformed code's scope. They emit
 * VPEvent objects and post them back to the main thread via the worker's
 * postMessage bridge.
 *
 * DESIGN RATIONALE
 * ----------------
 * - All helpers are plain functions (no `this`, no closures over mutable state
 *   beyond the `__vp` bridge). This makes the transformed code predictable.
 * - The `__vp` bridge is the only channel from the sandboxed execution context
 *   to the outer worker scope. It holds seq counter and postMessage.
 * - Each helper is self-contained so it can be copied verbatim into a
 *   Function() body (the runtime semantic test uses this).
 */

import type { VPPEvent } from "../../docs/event-schema";
import type { RuntimeState } from "../workers/executor.types";

/** ISO-8601 timestamp from performance.timeOrigin (available in both browser and Node worker_threads). */
function now(): string {
  return new Date(performance.timeOrigin + performance.now()).toISOString();
}

// ─── Serialisation helpers ────────────────────────────────────────────────────

/**
 * Serialise an unknown value to a JSON-safe representation.
 * Errors are reduced to { message, name, stack }; functions become "[Function]".
 */
export function serialiseValue(val: unknown): unknown {
  if (val === null) return null;
  if (val === undefined) return undefined;
  if (typeof val === "number") return val;
  if (typeof val === "boolean") return val;
  if (typeof val === "string") return val;
  if (typeof val === "bigint") return String(val);
  if (typeof val === "symbol") return String(val);
  if (typeof val === "function") return "[Function]";
  if (val instanceof Error) {
    return {
      name: val.name,
      message: val.message,
      stack: val.stack ?? "",
    };
  }
  try {
    return JSON.parse(JSON.stringify(val));
  } catch {
    return String(val);
  }
}

// ─── Runtime state bridge ─────────────────────────────────────────────────────

/**
 * __vp_bridge — the single mutable object that connects the helpers below to the
 * outer worker scope. It is injected into the sandboxed execution Function body.
 */
export interface VPBridge {
  state: RuntimeState;
  postMessage: (msg: unknown) => void;
}

// ─── Core runtime helpers ─────────────────────────────────────────────────────

/**
 * __vp_init — initialise the VP runtime state.
 * Called once at the top of every transformed snippet execution.
 *
 * @param bridge  — the VPBridge injected by the worker
 * @param snippet — the source code being executed (for execution.start)
 * @param entryId — a stable identifier for the top-level entry point
 */
export function __vp_init(
  bridge: VPBridge,
  snippet: string,
  entryId: string
): void {
  bridge.state.seq = 0;
  bridge.state.eventLog = [];
  bridge.state.aborted = false;
  bridge.state.frameStack = [];
  bridge.state.promiseIdCounter = 0;
  bridge.state.reactionIdCounter = 0;
  bridge.state.awaitedPromises = new Map();

  const event: VPPEvent = {
    type: "execution.start",
    seq: ++bridge.state.seq,
    timestamp: now(),
    data: { snippet, entryId },
  } as VPPEvent;
  bridge.state.eventLog.push(event);
  bridge.postMessage({ type: "event", event });
}

/**
 * __vp_promise_create — record that a new Promise was created.
 *
 * @param bridge      — VPBridge
 * @param label       — human-readable label (e.g. "new Promise", "Promise.resolve")
 * @param constructor — "Promise" | "AsyncFunction" | "Thenable"
 * @param asyncFrameId — frameId if this is an async function implicit promise
 */
export function __vp_promise_create(
  bridge: VPBridge,
  _label: string,
  constructor: "Promise" | "AsyncFunction" | "Thenable" = "Promise",
  asyncFrameId?: string
): void {
  const promiseId = `p${++bridge.state.promiseIdCounter}`;
  const event: VPPEvent = {
    type: "promise.create",
    seq: ++bridge.state.seq,
    timestamp: now(),
    data: {
      promiseId,
      constructor,
      ...(asyncFrameId ? { asyncFrameId } : {}),
    },
  } as VPPEvent;
  bridge.state.eventLog.push(event);
  bridge.postMessage({ type: "event", event });
  return promiseId as unknown as void;
}

/**
 * __vp_promise_settle — record that a promise transitioned to fulfilled or rejected.
 */
export function __vp_promise_settle(
  bridge: VPBridge,
  promiseId: string,
  status: "fulfilled" | "rejected",
  value: unknown
): void {
  const event: VPPEvent = {
    type: "promise.settle",
    seq: ++bridge.state.seq,
    timestamp: now(),
    data: {
      promiseId,
      state: status,
      ...(status === "fulfilled" ? { value: serialiseValue(value) } : {}),
      ...(status === "rejected" ? { reason: serialiseValue(value) } : {}),
    },
  } as VPPEvent;
  bridge.state.eventLog.push(event);
  bridge.postMessage({ type: "event", event });
}

/**
 * __vp_reaction_register — record that a .then/.catch/.finally handler was attached.
 *
 * @param bridge      — VPBridge
 * @param promiseId   — the promise that .then/.catch/.finally was called on
 * @param method      — "then" | "catch" | "finally"
 * @param reactionId  — unique id for this reaction
 */
export function __vp_reaction_register(
  bridge: VPBridge,
  promiseId: string,
  method: "then" | "catch" | "finally",
  reactionId: string
): void {
  const index = 0; // TODO: track reaction index per promise
  const event: VPPEvent = {
    type: "reaction.register",
    seq: ++bridge.state.seq,
    timestamp: now(),
    data: { reactionId, promiseId, handlerType: method, index },
  } as VPPEvent;
  bridge.state.eventLog.push(event);
  bridge.postMessage({ type: "event", event });
}

/**
 * __vp_reaction_enqueue — record that a reaction was added to the microtask queue.
 */
export function __vp_reaction_enqueue(
  bridge: VPBridge,
  reactionId: string,
  promiseId: string,
  queuePosition: number,
  queueDepth: number
): void {
  const event: VPPEvent = {
    type: "reaction.enqueue",
    seq: ++bridge.state.seq,
    timestamp: now(),
    data: { reactionId, promiseId, queuePosition, queueDepth },
  } as VPPEvent;
  bridge.state.eventLog.push(event);
  bridge.postMessage({ type: "event", event });
}

/**
 * __vp_reaction_run — record that a reaction was dequeued and is about to execute.
 */
export function __vp_reaction_run(
  bridge: VPBridge,
  reactionId: string,
  settlementType: "fulfilled" | "rejected",
  settlementValue: unknown
): void {
  const event: VPPEvent = {
    type: "reaction.run",
    seq: ++bridge.state.seq,
    timestamp: now(),
    data: { reactionId, settlementType, settlementValue: serialiseValue(settlementValue) },
  } as VPPEvent;
  bridge.state.eventLog.push(event);
  bridge.postMessage({ type: "event", event });
}

/**
 * __vp_await_suspend — record that an async function frame suspended at an await.
 *
 * @param bridge   — VPBridge
 * @param frameId — id of the async function frame
 * @param awaitExpr — source text of the awaited expression
 * @param awaitedPromiseId — the promise returned by the await expression
 */
export function __vp_await_suspend(
  bridge: VPBridge,
  frameId: string,
  awaitExpr: string,
  awaitedPromiseId: string
): void {
  bridge.state.awaitedPromises.set(awaitedPromiseId, frameId);

  const event: VPPEvent = {
    type: "await.suspend",
    seq: ++bridge.state.seq,
    timestamp: now(),
    data: { frameId, awaitExpr, awaitedPromiseId },
  } as VPPEvent;
  bridge.state.eventLog.push(event);
  bridge.postMessage({ type: "event", event });

  // Also emit frame.suspend for the parent async frame
  const parentFrameId = bridge.state.frameStack[bridge.state.frameStack.length - 1];
  if (parentFrameId) {
    const suspendEvent: VPPEvent = {
      type: "frame.suspend",
      seq: ++bridge.state.seq,
      timestamp: now(),
      data: { frameId: parentFrameId, awaitExpr, awaitedPromiseId },
    } as VPPEvent;
    bridge.state.eventLog.push(suspendEvent);
    bridge.postMessage({ type: "event", event: suspendEvent });
  }
}

/**
 * __vp_await_resume — record that an async function frame resumed after an await.
 *
 * @param bridge  — VPBridge
 * @param frameId — id of the async function frame
 * @param settled — whether the awaited promise resolved (true) or rejected (false)
 * @param value   — resolved value or rejection reason
 */
export function __vp_await_resume(
  bridge: VPBridge,
  frameId: string,
  settled: boolean,
  value: unknown
): void {
  const event: VPPEvent = {
    type: "await.resume",
    seq: ++bridge.state.seq,
    timestamp: now(),
    data: {
      frameId,
      settled,
      ...(settled ? { value: serialiseValue(value) } : {}),
      ...(!settled ? { reason: serialiseValue(value) } : {}),
    },
  } as VPPEvent;
  bridge.state.eventLog.push(event);
  bridge.postMessage({ type: "event", event });

  // Also emit frame.resume for the parent async frame
  const parentFrameId = bridge.state.frameStack[bridge.state.frameStack.length - 1];
  if (parentFrameId) {
    const resumeEvent: VPPEvent = {
      type: "frame.resume",
      seq: ++bridge.state.seq,
      timestamp: now(),
      data: { frameId: parentFrameId, settled, value: serialiseValue(value) },
    } as VPPEvent;
    bridge.state.eventLog.push(resumeEvent);
    bridge.postMessage({ type: "event", event: resumeEvent });
  }
}

/**
 * __vp_frame_enter — record entry into a function frame.
 *
 * @param bridge     — VPBridge
 * @param frameId    — unique id for this frame
 * @param name       — function name or "(anonymous)"
 * @param kind       — frame kind ("function" | "async" | "arrow" | "asyncArrow" | etc.)
 * @param startLine  — source line (1-indexed)
 * @param startCol   — source column (1-indexed)
 * @param endLine    — source end line
 * @param endCol     — source end column
 * @param exitSeq    — placeholder for the exit seq (filled in later)
 * @param parentSeq  — seq of parent frame.enter, or null
 */
export function __vp_frame_enter(
  bridge: VPBridge,
  frameId: string,
  name: string,
  kind: string,
  startLine: number,
  startCol: number,
  endLine: number,
  endCol: number,
  _exitSeq: number = 0,
  parentSeq: number | null = null
): void {
  bridge.state.frameStack.push(frameId);

  const event: VPPEvent = {
    type: "frame.enter",
    seq: ++bridge.state.seq,
    timestamp: now(),
    data: {
      frameId,
      name,
      kind: kind as VPPEvent extends { data: { kind: infer K } } ? K : never,
      exitSeq: _exitSeq,
      parentSeq,
      startLine,
      startColumn: startCol,
      endLine,
      endColumn: endCol,
    },
  } as VPPEvent;
  bridge.state.eventLog.push(event);
  bridge.postMessage({ type: "event", event });
}

/**
 * __vp_frame_exit — record exit from a function frame.
 *
 * @param bridge    — VPBridge
 * @param frameId   — id of the exiting frame
 * @param normal    — true if return, false if throw escaped
 * @param returnVal — return value (only if normal === true)
 */
export function __vp_frame_exit(
  bridge: VPBridge,
  frameId: string,
  normal: boolean,
  returnVal?: unknown
): void {
  bridge.state.frameStack.pop();

  const event: VPPEvent = {
    type: "frame.exit",
    seq: ++bridge.state.seq,
    timestamp: now(),
    data: {
      frameId,
      normal,
      ...(normal ? { returnValue: serialiseValue(returnVal) } : {}),
    },
  } as VPPEvent;
  bridge.state.eventLog.push(event);
  bridge.postMessage({ type: "event", event });
}

/**
 * __vp_await — transform `await X` into `await __vp_await(X)`.
 *
 * This is the key helper for async function instrumentation. It wraps the
 * awaited promise in a .then() chain to emit suspend/resume events around the
 * microtask boundary.
 *
 * @param bridge      — VPBridge
 * @param awaitedExpr — the expression being awaited (a Promise or thenable)
 * @param awaitExpr   — source text of the await expression (for event.data)
 * @param frameId     — id of the enclosing async frame
 * @param promiseId   — id of the promise created by this await
 */
export function __vp_await(
  bridge: VPBridge,
  awaitedExpr: Promise<unknown>,
  awaitExpr: string,
  frameId: string,
  promiseId: string
): Promise<unknown> {
  // Emit suspend BEFORE the promise settles
  __vp_await_suspend(bridge, frameId, awaitExpr, promiseId);

  // Chain onto the awaited promise to emit resume when it settles
  return awaitedExpr.then(
    (value: unknown) => {
      __vp_await_resume(bridge, frameId, true, value);
      return value;
    },
    (reason: unknown) => {
      __vp_await_resume(bridge, frameId, false, reason);
      return Promise.reject(reason);
    }
  );
}

/**
 * __vp_error_throw — record a synchronous throw.
 *
 * @param bridge  — VPBridge
 * @param frameId — id of the frame where the throw originated
 * @param error   — the thrown value (usually an Error)
 */
export function __vp_error_throw(
  bridge: VPBridge,
  frameId: string,
  error: unknown
): void {
  const msg = error instanceof Error ? error.message : String(error);
  const stack = error instanceof Error ? (error.stack ?? "") : "";
  const event: VPPEvent = {
    type: "error.throw",
    seq: ++bridge.state.seq,
    timestamp: now(),
    data: { frameId, error: serialiseValue(error), message: msg, stack },
  } as VPPEvent;
  bridge.state.eventLog.push(event);
  bridge.postMessage({ type: "event", event });
}

/**
 * __vp_console_log — capture console.log / console.info output.
 *
 * @param bridge — VPBridge
 * @param args   — arguments passed to console.log()
 */
export function __vp_console_log(
  bridge: VPBridge,
  method: "log" | "info",
  ...args: unknown[]
): void {
  const event: VPPEvent = {
    type: "console.output",
    seq: ++bridge.state.seq,
    timestamp: now(),
    data: { method, args: args.map(serialiseValue) },
  } as VPPEvent;
  bridge.state.eventLog.push(event);
  bridge.postMessage({ type: "event", event });
}

/**
 * __vp_console_warn — capture console.warn output.
 */
export function __vp_console_warn(
  bridge: VPBridge,
  ...args: unknown[]
): void {
  const event: VPPEvent = {
    type: "console.warn",
    seq: ++bridge.state.seq,
    timestamp: now(),
    data: { method: "warn" as const, args: args.map(serialiseValue) },
  } as VPPEvent;
  bridge.state.eventLog.push(event);
  bridge.postMessage({ type: "event", event });
}

/**
 * __vp_console_error — capture console.error output.
 */
export function __vp_console_error(
  bridge: VPBridge,
  ...args: unknown[]
): void {
  const event: VPPEvent = {
    type: "console.error",
    seq: ++bridge.state.seq,
    timestamp: now(),
    data: { method: "error" as const, args: args.map(serialiseValue) },
  } as VPPEvent;
  bridge.state.eventLog.push(event);
  bridge.postMessage({ type: "event", event });
}

/**
 * __vp_execution_end — record that the top-level execution completed.
 *
 * @param bridge — VPBridge
 * @param ok     — true = normal completion, false = uncaught exception
 * @param message — error message (only when ok === false)
 * @param stack   — error stack (only when ok === false)
 */
export function __vp_execution_end(
  bridge: VPBridge,
  ok: boolean,
  message?: string,
  stack?: string
): void {
  const event: VPPEvent = {
    type: "execution.end",
    seq: ++bridge.state.seq,
    timestamp: now(),
    data: ok
      ? { ok: true as const }
      : { ok: false as const, message: message ?? "", stack: stack ?? "" },
  } as VPPEvent;
  bridge.state.eventLog.push(event);
  bridge.postMessage({ type: "event", event });
}
