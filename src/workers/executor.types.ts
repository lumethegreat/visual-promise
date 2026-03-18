/**
 * executor.types.ts — Shared types for the executor worker ↔ main thread contract.
 *
 * These types use only primitives (no class instances with prototypes) so they
 * survive the structured-clone algorithm used by postMessage.
 */

import type {
  VPPEvent,
  FrameKind,
} from "../../docs/event-schema";

// ─── Incoming messages (main → worker) ───────────────────────────────────────

/** Message to execute instrumented code. */
export interface ExecuteMessage {
  type: "execute";
  code: string;
}

/** Message to terminate a running execution. */
export interface TerminateMessage {
  type: "terminate";
}

/** Union of all messages the worker can receive. */
export type ExecutorMessage = ExecuteMessage | TerminateMessage;

// ─── Outgoing messages (worker → main) ───────────────────────────────────────

/** A single VP event emitted during execution. */
export interface WorkerEventMessage {
  type: "event";
  event: VPPEvent;
}

/** Emitted once when the worker is initialised and ready to receive code. */
export interface WorkerReadyMessage {
  type: "ready";
}

/**
 * Emitted when execution completes normally (including unhandled rejections that
 * fire after the top-level promise settles).
 */
export interface WorkerDoneMessage {
  type: "done";
  eventLog: VPPEvent[];
}

/** Emitted when execution throws a synchronous exception. */
export interface WorkerErrorMessage {
  type: "error";
  error: SerializedError;
}

/** Union of all messages the worker can send. */
export type ExecutorResult =
  | WorkerEventMessage
  | WorkerReadyMessage
  | WorkerDoneMessage
  | WorkerErrorMessage;

// ─── Error serialisation ──────────────────────────────────────────────────────

/**
 * Error properties that survive structured clone.
 * Class prototypes are NOT preserved — only these primitive fields are safe.
 */
export interface SerializedError {
  name: string;
  message: string;
  stack: string;
}

// ─── Worker configuration ─────────────────────────────────────────────────────

/**
 * VPConfig — minimal configuration the worker receives alongside the code.
 * Extend this as the VP feature set grows.
 */
export interface WorkerConfig {
  /** Maximum number of events before the worker aborts execution (0 = unlimited). */
  maxEvents?: number;
  /** Timeout in milliseconds after which execution is terminated (0 = unlimited). */
  timeoutMs?: number;
}

// ─── Frame metadata ──────────────────────────────────────────────────────────

/** Map from source position (line:col) to frame metadata for the event schema. */
export type SourceMap = Map<string, FrameMeta>;

/** Frame metadata derived from Babel AST node positions. */
export interface FrameMeta {
  name: string;
  kind: FrameKind;
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
}

// ─── Runtime state ────────────────────────────────────────────────────────────

/** Runtime state held inside the worker while execution is in progress. */
export interface RuntimeState {
  seq: number;
  eventLog: VPPEvent[];
  aborted: boolean;
  // Frame tracking
  frameStack: string[];
  promiseIdCounter: number;
  reactionIdCounter: number;
  /** Tracks promiseIds of rejected promises created via Promise.reject() or new Promise with no handler. */
  unhandledRejections: Set<string>;
  /** Serialised data for each unhandled rejection: promiseId → { reason, message, stack } */
  unhandledRejectionMeta: Map<string, { reason: unknown; message: string; stack: string }>;
  awaitedPromises: Map<string, string>; // promiseId → frameId
  // Source map for frame metadata
  sourceMap: SourceMap;
}

// ─── Promise/Reaction id factory ─────────────────────────────────────────────

export function newPromiseId(state: RuntimeState): string {
  return `p${++state.promiseIdCounter}`;
}

export function newReactionId(state: RuntimeState): string {
  return `r${++state.reactionIdCounter}`;
}

export function newFrameId(state: RuntimeState): string {
  return `f${++state.promiseIdCounter}`;
}
