/**
 * executor.worker.ts — Visual Promise Executor Web Worker
 *
 * The core execution engine of Visual Promise. Runs in a dedicated Web Worker
 * thread so execution never blocks the main (UI) thread.
 *
 * Responsibilities:
 * 1. Receive raw JS snippets via postMessage
 * 2. Parse + AST-transform with Babel (multi-pass VP instrumentation)
 * 3. Execute the transformed code in a sandboxed Function() body
 * 4. Emit VPEvent objects back to the main thread via postMessage
 * 5. Support graceful termination
 *
 * MESSAGE PROTOCOL
 * ─────────────────
 * IN (main → worker):
 *   { type: 'execute', code: string }
 *   { type: 'terminate' }
 *
 * OUT (worker → main):
 *   { type: 'ready' }                            — worker initialised
 *   { type: 'event', event: VPPEvent }           — individual VP event
 *   { type: 'done', eventLog: VPPEvent[] }     — execution complete (normal)
 *   { type: 'error', error: SerializedError }   — execution threw
 */

import type { VPPEvent, ConsoleErrorEvent } from "../../docs/event-schema";
import type { ExecutorMessage, ExecutorResult, RuntimeState } from "./executor.types";
import { serialiseValue } from "../lib/runtime-vp";

// ─── Babel imports ─────────────────────────────────────────────────────────────
// Babel packages are CommonJS with `__esModule: true`. The `@babel/parser` and
// `@babel/generator` expose the main function as the `default` export (via the
// `esModuleInterop` shim). For `@babel/traverse` the types declare `traverse` as
// the `default` export, but it lives on the module namespace in the JS runtime.
import * as parserLib from "@babel/parser";
import { default as traverseFn, type NodePath } from "@babel/traverse";
import { default as generateFn } from "@babel/generator";
import * as t from "@babel/types";
import type { Node, Expression, Statement } from "@babel/types";

const parser = parserLib.parse.bind(parserLib);
const traverse = traverseFn;
const generator = generateFn;

// ─── Serialisation helpers ────────────────────────────────────────────────────

function now(): string {
  return new Date(performance.timeOrigin + performance.now()).toISOString();
}

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// ─── Runtime state ────────────────────────────────────────────────────────────

const state: RuntimeState = {
  seq: 0,
  eventLog: [],
  aborted: false,
  frameStack: [],
  promiseIdCounter: 0,
  reactionIdCounter: 0,
  awaitedPromises: new Map(),
  sourceMap: new Map(),
  unhandledRejections: new Set(),
  unhandledRejectionMeta: new Map(),
};

let entryIdCounter = 0;

// ─── PostMessage bridge ──────────────────────────────────────────────────────

function emit(event: VPPEvent): void {
  if (state.aborted) return;
  state.eventLog.push(event);
  self.postMessage({ type: "event", event } satisfies ExecutorResult);
}

function emitDone(): void {
  // Defer by one macrotask so any pending microtasks (promise continuations)
  // have a chance to emit their VP events before we tell the host we're done.
  setTimeout(() => {
    // Emit error.unhandled for every rejected promise that never got a handler.
    // The unhandledRejections Set is populated by __vp_promise_reject and
    // __vp_promise_executor whenever a promise is settled as rejected without a handler.
    for (const promiseId of state.unhandledRejections) {
      const settleEvent = state.eventLog.find(
        (e) => e.type === "promise.settle" && e.data.promiseId === promiseId
      ) as { data: { promiseId: string; reason: unknown } } | undefined;
      if (!settleEvent) continue;

      const meta = state.unhandledRejectionMeta.get(promiseId);
      const reasonSer = settleEvent.data.reason;

      // Emit console.error so the Console panel shows the error
      const consoleErrEvent: ConsoleErrorEvent = {
        type: "console.error",
        seq: ++state.seq,
        timestamp: now(),
        data: {
          method: "error",
          args: [`Unhandled Promise Rejection: ${meta?.message ?? String(reasonSer)}`]
        }
      };
      state.eventLog.push(consoleErrEvent);
      self.postMessage({ type: "event", event: consoleErrEvent });

      // Emit the canonical error.unhandled event
      const unhandledEvent: VPPEvent = {
        type: "error.unhandled",
        seq: ++state.seq,
        timestamp: now(),
        data: {
          promiseId,
          reason: reasonSer,
          message: meta?.message ?? String(reasonSer),
          stack: meta?.stack ?? "",
        },
      };
      state.eventLog.push(unhandledEvent);
      self.postMessage({ type: "event", event: unhandledEvent });
    }

    self.postMessage({ type: "done", eventLog: state.eventLog } satisfies ExecutorResult);
  }, 0);
}

function emitError(err: unknown): void {
  const msg = errMessage(err);
  const s = err instanceof Error ? (err.stack ?? "") : "";
  self.postMessage({
    type: "error",
    error: { name: "Error", message: msg, stack: s },
  } satisfies ExecutorResult);
}

// ─── ID factories ─────────────────────────────────────────────────────────────

function newPromiseId(): string {
  return `p${++state.promiseIdCounter}`;
}

function newReactionId(): string {
  return `r${++state.reactionIdCounter}`;
}

function newFrameId(): string {
  return `f${++state.promiseIdCounter}`;
}

// ─── Babel helpers ────────────────────────────────────────────────────────────

/** Build a call expression node for a __vp_* runtime helper. */
function vpCall(name: string, args: Expression[]): t.CallExpression {
  const dotIdx = name.indexOf(".");
  const first = dotIdx >= 0 ? name.slice(0, dotIdx) : name;
  const rest = dotIdx >= 0 ? name.slice(dotIdx + 1) : "";
  let expr: Expression = t.identifier("__vp_" + first);
  if (rest) {
    for (const part of rest.split(".")) {
      expr = t.memberExpression(expr, t.identifier(part));
    }
  }
  return t.callExpression(expr, args);
}

/** Wrap a CallExpression in an ExpressionStatement. */
function exprStmt(call: t.CallExpression): Statement {
  return t.expressionStatement(call);
}

// Guard set to prevent the same node from being visited twice (infinite recursion).
const done = new WeakSet<Node>();

// ─── Transform: multi-pass Babel instrumentation ─────────────────────────────
// See spikes/babel-spike/RESULTS.md for the full design rationale.
// Pass order: AwaitExpression → Promise.resolve → .then/.catch/.finally → functions/try

interface TransformResult {
  code: string;
  success: boolean;
  error?: string;
}

function transformSnippet(source: string): TransformResult {
  try {
    const ast = parser(source, {
      sourceType: "script",
      // Babel 7+ supports async/await natively — no plugin needed.
      plugins: ["typescript"],
    });

    // ── PASS 1: AwaitExpression → await __vp_await(X) ──────────────────────
    traverse(ast, {
      AwaitExpression(path: NodePath<t.AwaitExpression>) {
        const arg = path.node.argument;
        if (!arg) return;

        const parentFn = path.scope.getFunctionParent();
        const fnNode = parentFn?.path.node as t.FunctionDeclaration | t.FunctionExpression | undefined;
        const fnId = fnNode?.id;
        const frameId = fnId
          ? `f_${String(fnId)}_${fnNode.start}`
          : newFrameId();

        const awaitExpr = source.slice(path.node.start!, path.node.end!);
        const promiseId = newPromiseId();

        // Replace: `await X` → `await __vp_await(X, "await X", frameId, promiseId)`
        path.replaceWith(
          t.awaitExpression(
            vpCall("await", [
              arg,
              t.stringLiteral(awaitExpr),
              t.stringLiteral(frameId),
              t.stringLiteral(promiseId),
            ])
          )
        );
        path.skip();
      },
    });

    // ── PASS 2: Promise.resolve(...) ────────────────────────────────────────
    traverse(ast, {
      CallExpression(path: NodePath<t.CallExpression>) {
        const callee = path.node.callee;
        if (
          t.isMemberExpression(callee) &&
          t.isIdentifier(callee.object, { name: "Promise" }) &&
          t.isIdentifier(callee.property, { name: "resolve" })
        ) {
          // Guard: skip if already wrapped in a sequence expression (created by us)
          if (t.isSequenceExpression(path.parent)) return;
          // Guard: skip if nested inside another call's arguments (e.g. __vp_await(...))
          if (t.isCallExpression(path.parent) && path.parent.callee !== path.node) return;

          const promiseId = newPromiseId();
          const original = t.callExpression(
            t.memberExpression(t.identifier("Promise"), t.identifier("resolve")),
            [...path.node.arguments]
          );
          path.replaceWith(
            t.sequenceExpression([
              vpCall("promise_create", [
                t.stringLiteral(promiseId),
                t.stringLiteral("Promise.resolve"),
                t.stringLiteral("Promise"),
              ]),
              original,
            ])
          );
        }
      },
    });

    // ── PASS 3: .then / .catch / .finally ───────────────────────────────────
    // Abordagem A fix: transform promise.then(fn) → __vp_then(p.then(), ...) to execute
    // callbacks SYNCHRONOUSLY (worker has no microtask queue).
    traverse(ast, {
      MemberExpression(path: NodePath<t.MemberExpression>) {
        if (done.has(path.node)) return;
        const prop = path.node.property;
        if (!t.isIdentifier(prop)) return;
        if (prop.name !== "then" && prop.name !== "catch" && prop.name !== "finally") return;

        const parent = path.parent;
        if (!t.isCallExpression(parent) || parent.callee !== path.node) return;
        if (done.has(parent)) return;

        done.add(parent);
        done.add(path.node);

        const promiseId = newPromiseId();
        const reactionId = newReactionId();
        const method = prop.name;

        if (method === "then") {
          // Transform: p.then(onFulfilled, onRejected)
          //   → __vp_then(p, __vp_reaction_register(...), onFulfilled, onRejected)
          //
          // __vp_then calls p.then(onFulfilled) internally and executes onFulfilled
          // SYNCHRONOUSLY so console.output is emitted immediately (worker has no microtask
          // queue to defer into). It returns p.then() so promise chains continue to work.
          const promiseObj = path.node.object;
          const onFulfilled = parent.arguments[0] ?? t.identifier("undefined");
          const onRejected = parent.arguments[1] ?? t.identifier("undefined");

          const registrationCall = vpCall("reaction_register", [
            t.stringLiteral(promiseId),
            t.stringLiteral(method),
            t.stringLiteral(reactionId),
          ]);

          // Replace entire call: p.then(...) → __vp_then(p, registrationResult, onFulfilled, onRejected)
          path.replaceWith(
            t.callExpression(t.identifier("__vp_then"), [
              promiseObj,          // p — the promise object
              registrationCall,    // reactionId from __vp_reaction_register
              onFulfilled,        // onFulfilled callback
              onRejected,         // onRejected callback
            ])
          );
          path.skip();
        } else {
          // .catch / .finally — prepend reaction_register as first argument (existing approach)
          parent.arguments.unshift(
            vpCall("reaction_register", [
              t.stringLiteral(promiseId),
              t.stringLiteral(method),
              t.stringLiteral(reactionId),
            ])
          );
        }
      },
    });

    // ── PASS 4: FunctionDeclaration / FunctionExpression / TryStatement ─────
    traverse(ast, {
      FunctionDeclaration(path: NodePath<t.FunctionDeclaration>) {
        const id = path.node.id;
        const name = id ? id.name : "(anonymous)";
        const body = path.node.body;
        if (!body || !t.isBlockStatement(body)) return;

        const frameId = id ? `f_${name}_${path.node.start}` : newFrameId();

        // Wrap body in try/finally so frame.exit always fires even on early return
        const tryStmt = t.tryStatement(
          t.blockStatement([
            exprStmt(
              vpCall("frame_enter", [
                t.stringLiteral(frameId),
                t.stringLiteral(name),
                t.stringLiteral("function"),
                t.numericLiteral(path.node.loc?.start.line ?? 0),
                t.numericLiteral(path.node.loc?.start.column ?? 0),
                t.numericLiteral(path.node.loc?.end.line ?? 0),
                t.numericLiteral(path.node.loc?.end.column ?? 0),
                t.numericLiteral(0), // exitSeq placeholder
                t.nullLiteral(), // parentSeq
              ])
            ),
            ...(body.body as Statement[]),
          ]),
          null,
          t.blockStatement([
            exprStmt(
              vpCall("frame_exit", [
                t.stringLiteral(frameId),
                t.booleanLiteral(true),
              ])
            ),
          ])
        );

        body.body = [tryStmt];
      },

      FunctionExpression(path: NodePath<t.FunctionExpression>) {
        const body = path.node.body;
        if (!body || !t.isBlockStatement(body)) return;

        const name = "(fn)";
        const frameId = newFrameId();
        const tryStmt = t.tryStatement(
          t.blockStatement([
            exprStmt(
              vpCall("frame_enter", [
                t.stringLiteral(frameId),
                t.stringLiteral(name),
                t.stringLiteral("function"),
                t.numericLiteral(path.node.loc?.start.line ?? 0),
                t.numericLiteral(path.node.loc?.start.column ?? 0),
                t.numericLiteral(path.node.loc?.end.line ?? 0),
                t.numericLiteral(path.node.loc?.end.column ?? 0),
                t.numericLiteral(0),
                t.nullLiteral(),
              ])
            ),
            ...(body.body as Statement[]),
          ]),
          null,
          t.blockStatement([
            exprStmt(
              vpCall("frame_exit", [
                t.stringLiteral(frameId),
                t.booleanLiteral(true),
              ])
            ),
          ])
        );

        body.body = [tryStmt];
      },

      // Arrow function with block body: `() => { ... }`
      ArrowFunctionExpression(path: NodePath<t.ArrowFunctionExpression>) {
        const body = path.node.body;
        if (!t.isBlockStatement(body)) return;

        const name = "(arrow)";
        const frameId = newFrameId();
        const tryStmt = t.tryStatement(
          t.blockStatement([
            exprStmt(
              vpCall("frame_enter", [
                t.stringLiteral(frameId),
                t.stringLiteral(name),
                t.stringLiteral("arrow"),
                t.numericLiteral(path.node.loc?.start.line ?? 0),
                t.numericLiteral(path.node.loc?.start.column ?? 0),
                t.numericLiteral(path.node.loc?.end.line ?? 0),
                t.numericLiteral(path.node.loc?.end.column ?? 0),
                t.numericLiteral(0),
                t.nullLiteral(),
              ])
            ),
            ...(body.body as Statement[]),
          ]),
          null,
          t.blockStatement([
            exprStmt(
              vpCall("frame_exit", [
                t.stringLiteral(frameId),
                t.booleanLiteral(true),
              ])
            ),
          ])
        );

        body.body = [tryStmt];
      },

      TryStatement(path: NodePath<t.TryStatement>) {
        const { handler, finalizer } = path.node;

        if (handler && handler.body.body.length > 0) {
          handler.body.body.unshift(
            exprStmt(vpCall("error_catch", [t.stringLiteral(newFrameId())]))
          );
        }

        if (finalizer) {
          finalizer.body.unshift(exprStmt(vpCall("try_finally", [])));
        } else {
          path.node.finalizer = t.blockStatement([
            exprStmt(vpCall("try_finally", [])),
          ]);
        }
      },
    });

    // ── PASS 5: console.* → __vp_console_log ─────────────────────────────
    // Intercept all console method calls so they emit VP events.
    const __consoleMethods = new Set(["log", "warn", "error", "info", "debug"]);
    traverse(ast, {
      CallExpression(path) {
        const callee = path.node.callee;
        if (
          t.isMemberExpression(callee) &&
          t.isIdentifier(callee.object, { name: "console" }) &&
          t.isIdentifier(callee.property) &&
          __consoleMethods.has(callee.property.name)
        ) {
          // Guard: skip if already wrapped
          if (t.isSequenceExpression(path.parent) &&
              t.isStringLiteral(path.parent.expressions[0]) &&
              path.parent.expressions[0].value === "__vp_console_marker") return;
          // Replace: console.log(X, Y) → __vp_console_log(X, Y)
          path.replaceWith(
            t.callExpression(t.identifier("__vp_console_log"), [
              t.stringLiteral(callee.property.name),
              ...path.node.arguments,
            ])
          );
          path.skip();
        }
      },
    });

    // ── PASS 6: Promise.reject(...) → __vp_promise_reject ──────────────────
    traverse(ast, {
      CallExpression(path) {
        const callee = path.node.callee;
        if (
          t.isMemberExpression(callee) &&
          t.isIdentifier(callee.object, { name: "Promise" }) &&
          t.isIdentifier(callee.property, { name: "reject" })
        ) {
          // Guard: skip if already wrapped
          if (t.isSequenceExpression(path.parent) &&
              t.isStringLiteral(path.parent.expressions[0]) &&
              path.parent.expressions[0].value === "__vp_marker_promise_reject") return;
          // Guard: skip if nested inside another call's arguments
          if (t.isCallExpression(path.parent) && path.parent.callee !== path.node) return;
          const promiseId = newPromiseId();
          path.replaceWith(
            t.sequenceExpression([
              t.stringLiteral("__vp_marker_promise_reject"),
              vpCall("promise_reject", [
                t.stringLiteral(promiseId),
                ...(path.node.arguments as t.Expression[]),
              ]),
            ])
          );
          path.skip();
        }
      },
    });

    // ── PASS 7: new Promise(executor) — wrap executor to track rejections ──
    traverse(ast, {
      NewExpression(path) {
        const callee = path.node.callee;
        if (!t.isIdentifier(callee, { name: "Promise" })) return;
        const args = path.node.arguments;
        if (args.length === 0) return;
        const executor = args[0];
        // Handle FunctionExpression and ArrowFunctionExpression (covers async too since async is a modifier)
        if (!t.isFunctionExpression(executor) && !t.isArrowFunctionExpression(executor)) return;

        const promiseId = newPromiseId();

        // Wrap: new Promise((resolve, reject) => { ... })
        //   → new Promise(__vp_promise_executor(__vp, (resolve, reject) => { ... }, promiseId))
        const wrappedExecutor = t.callExpression(
          t.identifier("__vp_promise_executor"),
          [t.identifier("__vp"), executor, t.stringLiteral(promiseId)]
        );
        args[0] = wrappedExecutor;
        path.skip();
      },
    });

    const generated = generator(ast, {
      comments: true,
      compact: false,
      retainLines: false,
    }, source);

    return { code: generated.code ?? "", success: true };
  } catch (err: unknown) {
    return { code: "", success: false, error: errMessage(err) };
  }
}

// ─── Execution ────────────────────────────────────────────────────────────────

/**
 * Build the sandboxed execution source for a transformed snippet.
 *
 * All `__vp_*` helpers are defined as local variables inside the Function body
 * so they are in scope for the transformed code without polluting the worker global.
 */
function buildExecutionSource(transformedCode: string): string {
  return `
'use strict';
// ── VP runtime helpers (sandboxed inside this execution context) ──────────────
const __vp = __bridge;

function __serialise(val) {
  if (val === null) return null;
  if (val === undefined) return undefined;
  if (typeof val === 'number' || typeof val === 'boolean' || typeof val === 'string') return val;
  if (typeof val === 'function') return '[Function]';
  if (val instanceof Error) return { name: val.name, message: val.message, stack: val.stack ?? '' };
  try { return JSON.parse(JSON.stringify(val)); } catch { return String(val); }
}

function __now() {
  return new Date(performance.timeOrigin + performance.now()).toISOString();
}

function __vp_seq() { return ++__vp.state.seq; }

// __vp_promise_create(promiseId, label, constructor, asyncFrameId?)
function __vp_promise_create(promiseId, label, constructor, asyncFrameId) {
  const event = {
    type: 'promise.create',
    seq: __vp_seq(),
    timestamp: __now(),
    data: { promiseId, constructor, ...(asyncFrameId ? { asyncFrameId } : {}) }
  };
  __vp.state.eventLog.push(event);
  __vp.postMessage({ type: 'event', event });
}

// __vp_promise_settle(promiseId, status, value)
function __vp_promise_settle(promiseId, status, value) {
  const event = {
    type: 'promise.settle',
    seq: __vp_seq(),
    timestamp: __now(),
    data: {
      promiseId,
      state: status,
      ...(status === 'fulfilled' ? { value: __serialise(value) } : {}),
      ...(status === 'rejected' ? { reason: __serialise(value) } : {})
    }
  };
  __vp.state.eventLog.push(event);
  __vp.postMessage({ type: 'event', event });
}

// __vp_reaction_register(promiseId, method, reactionId)
function __vp_reaction_register(promiseId, method, reactionId) {
  const event = {
    type: 'reaction.register',
    seq: __vp_seq(),
    timestamp: __now(),
    data: { reactionId, promiseId, handlerType: method, index: 0 }
  };
  __vp.state.eventLog.push(event);
  __vp.postMessage({ type: 'event', event });
}

// __vp_reaction_enqueue(reactionId, promiseId, queuePosition, queueDepth)
function __vp_reaction_enqueue(reactionId, promiseId, queuePosition, queueDepth) {
  const event = {
    type: 'reaction.enqueue',
    seq: __vp_seq(),
    timestamp: __now(),
    data: { reactionId, promiseId, queuePosition, queueDepth }
  };
  __vp.state.eventLog.push(event);
  __vp.postMessage({ type: 'event', event });
}

// __vp_then(promise, registrationResult, onFulfilled, onRejected)
// Abordagem A fix: executes .then() callbacks SYNCHRONOUSLY (worker has no microtask queue).
// 1. Calls promise.then(onFulfilled, onRejected) internally, using a wrapper callback that:
//    a. Calls the user's onFulfilled SYNCHRONOUSLY → emits reaction.run + console.output
//    b. Returns the result so the promise resolves correctly
// 2. Returns the result of promise.then(...) so promise chains continue to work
function __vp_then(promise, _registrationResult, onFulfilled, onRejected) {
  const __vp_reactionId = _registrationResult;

  // Call promise.then(onFulfilled, onRejected) internally to keep promise chains working.
  // We wrap the callbacks to execute the user's onFulfilled SYNCHRONOUSLY.
  // The worker has no microtask queue, so the microtask would never fire — but we
  // call the callback right now, synchronously, to emit console.output immediately.
  const wrappedOnFulfilled = function(__vp_val) {
    const runEvent = {
      type: 'reaction.run',
      seq: __vp_seq(),
      timestamp: __now(),
      data: { reactionId: __vp_reactionId, settlementType: 'fulfilled', settlementValue: __serialise(__vp_val) }
    };
    __vp.state.eventLog.push(runEvent);
    __vp.postMessage({ type: 'event', event: runEvent });

    // Execute user's callback SYNCHRONOUSLY — this triggers __vp_console_log calls
    if (typeof onFulfilled === 'function') {
      try {
        return onFulfilled(__vp_val);
      } catch(__vp_e) {
        throw __vp_e; // re-throw so promise.reject fires
      }
    }
    return __vp_val;
  };

  const wrappedOnRejected = function(__vp_err) {
    const runEvent = {
      type: 'reaction.run',
      seq: __vp_seq(),
      timestamp: __now(),
      data: { reactionId: __vp_reactionId, settlementType: 'rejected', settlementValue: __serialise(__vp_err) }
    };
    __vp.state.eventLog.push(runEvent);
    __vp.postMessage({ type: 'event', event: runEvent });

    if (typeof onRejected === 'function') {
      try {
        return onRejected(__vp_err);
      } catch(__vp_e2) {
        throw __vp_e2;
      }
    }
    throw __vp_err;
  };

  // Call promise.then(...) and return the result so chains like p.then(fn1).then(fn2) work
  return promise.then(wrappedOnFulfilled, wrappedOnRejected);
}

// __vp_reaction_run(reactionId, settlementType, settlementValue)
function __vp_reaction_run(reactionId, settlementType, settlementValue) {
  const event = {
    type: 'reaction.run',
    seq: __vp_seq(),
    timestamp: __now(),
    data: { reactionId, settlementType, settlementValue: __serialise(settlementValue) }
  };
  __vp.state.eventLog.push(event);
  __vp.postMessage({ type: 'event', event });
}

// __vp_promise_reject(promiseId, reason) — wraps Promise.reject(reason)
// Emits promise.create + promise.settle(rejected) and tracks the promise as
// unhandled so emitDone can surface error.unhandled.
function __vp_promise_reject(promiseId, reason) {
  // Emit promise.create
  const createEvent = {
    type: 'promise.create',
    seq: __vp_seq(),
    timestamp: __now(),
    data: { promiseId, constructor: 'Promise' }
  };
  __vp.state.eventLog.push(createEvent);
  __vp.postMessage({ type: 'event', event: createEvent });

  // Emit promise.settle with state: rejected
  const reasonSer = __serialise(reason);
  const settleEvent = {
    type: 'promise.settle',
    seq: __vp_seq(),
    timestamp: __now(),
    data: { promiseId, state: 'rejected', reason: reasonSer }
  };
  __vp.state.eventLog.push(settleEvent);
  __vp.postMessage({ type: 'event', event: settleEvent });

  // Track as unhandled so emitDone can surface error.unhandled
  const msg = reason instanceof Error ? reason.message : String(reason);
  const stack = reason instanceof Error ? (reason.stack ?? '') : '';
  __vp.state.unhandledRejections.add(promiseId);
  __vp.state.unhandledRejectionMeta.set(promiseId, { reason: reasonSer, message: msg, stack });

  // Return the actual rejected promise so code can still chain onto it
  return Promise.reject(reason);
}

// __vp_promise_executor(__vp, executor, promiseId)
// Wraps the executor passed to new Promise(executor) so that:
// 1. Sync throws are caught and emit error.throw
// 2. Calls to the reject callback emit promise.settle(rejected) and track as unhandled
function __vp_promise_executor(__vp, executor, promiseId) {
  return function(__vp_resolve, __vp_reject) {
    // Wrap reject: any rejection should emit promise.settle and be tracked
    const wrappedReject = function(__vp_reason) {
      const reasonSer = __serialise(__vp_reason);
      // Emit promise.settle with state: rejected
      const settleEvent = {
        type: 'promise.settle',
        seq: __vp_seq(),
        timestamp: __now(),
        data: { promiseId, state: 'rejected', reason: reasonSer }
      };
      __vp.state.eventLog.push(settleEvent);
      __vp.postMessage({ type: 'event', event: settleEvent });

      // Track as unhandled
      const msg = __vp_reason instanceof Error ? __vp_reason.message : String(__vp_reason);
      const stack = __vp_reason instanceof Error ? (__vp_reason.stack ?? '') : '';
      __vp.state.unhandledRejections.add(promiseId);
      __vp.state.unhandledRejectionMeta.set(promiseId, { reason: reasonSer, message: msg, stack });

      // Call original reject
      return __vp_reject(__vp_reason);
    };

    try {
      return executor(__vp_resolve, wrappedReject);
    } catch (__vp_err) {
      // Sync throw inside executor → emit error.throw
      const msg = __vp_err instanceof Error ? __vp_err.message : String(__vp_err);
      const s = __vp_err instanceof Error ? (__vp_err.stack ?? '') : '';
      const throwEvent = {
        type: 'error.throw',
        seq: __vp_seq(),
        timestamp: __now(),
        data: { frameId: promiseId, error: __serialise(__vp_err), message: msg, stack: s }
      };
      __vp.state.eventLog.push(throwEvent);
      __vp.postMessage({ type: 'event', event: throwEvent });
      // Re-throw so the promise rejects normally
      throw __vp_err;
    }
  };
}

// __vp_await(promisedValue, awaitExpr, frameId, promiseId)
function __vp_await(promisedValue, awaitExpr, frameId, promiseId) {
  // Emit await.suspend + frame.suspend
  __vp.state.awaitedPromises.set(promiseId, frameId);

  const suspendEvent = {
    type: 'await.suspend',
    seq: __vp_seq(),
    timestamp: __now(),
    data: { frameId, awaitExpr, awaitedPromiseId: promiseId }
  };
  __vp.state.eventLog.push(suspendEvent);
  __vp.postMessage({ type: 'event', event: suspendEvent });

  // frame.suspend for parent async frame
  const parentFrameId = __vp.state.frameStack[__vp.state.frameStack.length - 1];
  if (parentFrameId) {
    const parentSuspend = {
      type: 'frame.suspend',
      seq: __vp_seq(),
      timestamp: __now(),
      data: { frameId: parentFrameId, awaitExpr, awaitedPromiseId: promiseId }
    };
    __vp.state.eventLog.push(parentSuspend);
    __vp.postMessage({ type: 'event', event: parentSuspend });
  }

  // Chain onto the awaited promise to emit resume when it settles
  return promisedValue.then(
    function(__vp_resolvedValue) {
      const resumeEvent = {
        type: 'await.resume',
        seq: __vp_seq(),
        timestamp: __now(),
        data: { frameId, settled: true, value: __serialise(__vp_resolvedValue) }
      };
      __vp.state.eventLog.push(resumeEvent);
      __vp.postMessage({ type: 'event', event: resumeEvent });

      if (parentFrameId) {
        const parentResume = {
          type: 'frame.resume',
          seq: __vp_seq(),
          timestamp: __now(),
          data: { frameId: parentFrameId, settled: true, value: __serialise(__vp_resolvedValue) }
        };
        __vp.state.eventLog.push(parentResume);
        __vp.postMessage({ type: 'event', event: parentResume });
      }
      return __vp_resolvedValue;
    },
    function(__vp_rejectedReason) {
      const resumeEvent = {
        type: 'await.resume',
        seq: __vp_seq(),
        timestamp: __now(),
        data: { frameId, settled: false, reason: __serialise(__vp_rejectedReason) }
      };
      __vp.state.eventLog.push(resumeEvent);
      __vp.postMessage({ type: 'event', event: resumeEvent });

      if (parentFrameId) {
        const parentResume = {
          type: 'frame.resume',
          seq: __vp_seq(),
          timestamp: __now(),
          data: { frameId: parentFrameId, settled: false, reason: __serialise(__vp_rejectedReason) }
        };
        __vp.state.eventLog.push(parentResume);
        __vp.postMessage({ type: 'event', event: parentResume });
      }
      return Promise.reject(__vp_rejectedReason);
    }
  );
}

// __vp_frame_enter(frameId, name, kind, startLine, startCol, endLine, endCol, exitSeq, parentSeq)
function __vp_frame_enter(frameId, name, kind, startLine, startCol, endLine, endCol, _exitSeq, parentSeq) {
  __vp.state.frameStack.push(frameId);
  const event = {
    type: 'frame.enter',
    seq: __vp_seq(),
    timestamp: __now(),
    data: { frameId, name, kind, exitSeq: _exitSeq, parentSeq, startLine, startColumn: startCol, endLine, endColumn: endCol }
  };
  __vp.state.eventLog.push(event);
  __vp.postMessage({ type: 'event', event });
}

// __vp_frame_exit(frameId, normal, returnVal?)
function __vp_frame_exit(frameId, normal, returnVal) {
  __vp.state.frameStack.pop();
  const event = {
    type: 'frame.exit',
    seq: __vp_seq(),
    timestamp: __now(),
    data: { frameId, normal, ...(normal ? { returnValue: __serialise(returnVal) } : {}) }
  };
  __vp.state.eventLog.push(event);
  __vp.postMessage({ type: 'event', event });
}

// __vp_error_catch(frameId)
function __vp_error_catch(frameId) {
  // Error catch emitted by try/catch block at runtime
}

// __vp_try_finally()
function __vp_try_finally() {
  // try.finally / try.catch tracked at instrumentation level
}

// __vp_console_log(...args)
function __vp_console_log(method) {
  const args = Array.from(arguments).slice(1);
  const event = {
    type: 'console.output',
    seq: __vp_seq(),
    timestamp: __now(),
    data: { method: method, args: args.map(__serialise) }
  };
  __vp.state.eventLog.push(event);
  __vp.postMessage({ type: 'event', event });
}

// ── execution.start ──────────────────────────────────────────────────────────
const __entryId = __bridge.entryId;
const __snippet = __bridge.snippet;

const __startEvent = {
  type: 'execution.start',
  seq: __vp_seq(),
  timestamp: __now(),
  data: { snippet: __snippet, entryId: __entryId }
};
__vp.state.eventLog.push(__startEvent);
__vp.postMessage({ type: 'event', event: __startEvent });

// ── User code ────────────────────────────────────────────────────────────────
${transformedCode}
`;
}

async function executeSnippet(code: string, snippet: string, entryId: string): Promise<void> {
  // Reset state for this execution
  state.seq = 0;
  state.eventLog = [];
  state.aborted = false;
  state.frameStack = [];
  state.promiseIdCounter = 0;
  state.reactionIdCounter = 0;
  state.awaitedPromises = new Map();
  state.unhandledRejections = new Set();
  state.unhandledRejectionMeta = new Map();

  // Transform with Babel
  const result = transformSnippet(code);
  if (!result.success) {
    emitError(new Error(`Transform error: ${result.error}`));
    emitDone();
    return;
  }

  // Build the execution source
  const execSource = buildExecutionSource(result.code);

  // The VPBridge gives the sandboxed code access to postMessage and state
  const bridge = {
    state,
    entryId,
    snippet,
    postMessage: (msg: unknown) => {
      if (state.aborted) return;
      self.postMessage(msg);
    },
  };

  try {
    // Construct and call the execution function
    const execFn = new Function("__bridge", execSource);
    const returnValue = execFn(bridge);

    // If the top-level code returns a promise (async IIFE, or top-level async),
    // wait for it to settle before sending done.
    if (returnValue && typeof (returnValue as Promise<unknown>).then === "function") {
      await (returnValue as Promise<unknown>).catch((err: unknown) => {
        const msg = errMessage(err);
        const s = err instanceof Error ? (err.stack ?? "") : "";
        emit({
          type: "error.throw",
          seq: ++state.seq,
          timestamp: now(),
          data: { frameId: "top-level", error: serialiseValue(err), message: msg, stack: s },
        } as VPPEvent);
      });
    }

    // Emit execution.end (normal)
    emit({
      type: "execution.end",
      seq: ++state.seq,
      timestamp: now(),
      data: { ok: true },
    } as VPPEvent);

    emitDone();
  } catch (err: unknown) {
    const msg = errMessage(err);
    const s = err instanceof Error ? (err.stack ?? "") : "";
    const errVal = err instanceof Error ? err : new Error(msg);

    // Emit a synthetic frame.enter so the CallStackPanel shows the error context
    emit({
      type: "frame.enter",
      seq: ++state.seq,
      timestamp: now(),
      data: {
        frameId: "top-level",
        name: "<error>",
        kind: "function",
        exitSeq: 0,
        parentSeq: null,
        startLine: 0,
        startColumn: 0,
        endLine: 0,
        endColumn: 0,
      },
    } as VPPEvent);

    // Emit error.throw so the reducer marks executionFailed = true
    emit({
      type: "error.throw",
      seq: ++state.seq,
      timestamp: now(),
      data: { frameId: "top-level", error: serialiseValue(errVal), message: msg, stack: s },
    } as VPPEvent);

    // Emit console.error so the error appears in the Console panel
    emit({
      type: "console.error",
      seq: ++state.seq,
      timestamp: now(),
      data: { method: "error" as const, args: [msg] },
    } as VPPEvent);

    // Emit execution.end with error
    emit({
      type: "execution.end",
      seq: ++state.seq,
      timestamp: now(),
      data: { ok: false, message: msg, stack: s },
    } as VPPEvent);

    emitError(err);
    emitDone();
  }
}

// ─── Message handler ──────────────────────────────────────────────────────────

self.onmessage = (event: MessageEvent<ExecutorMessage>) => {
  const msg = event.data;

  switch (msg.type) {
    case "execute": {
      const code = msg.code;
      const entryId = `eval#${++entryIdCounter}`;
      executeSnippet(code, code, entryId).catch((err: unknown) => {
        emitError(err);
      });
      break;
    }

    case "terminate": {
      state.aborted = true;
      emit({
        type: "execution.end",
        seq: ++state.seq,
        timestamp: now(),
        data: { ok: false, message: "Execution terminated by host", stack: "" },
      } as VPPEvent);
      emitDone();
      break;
    }

    default:
      break;
  }
};

// ─── Signal ready ─────────────────────────────────────────────────────────────
// The main thread should wait for this message before posting any execute messages.
self.postMessage({ type: "ready" } satisfies ExecutorResult);
