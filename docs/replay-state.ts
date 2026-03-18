/**
 * Visual Promise — Replay State Shape
 * =====================================
 *
 * This file defines the canonical state shape used by the React reducer that
 * drives the step-by-step UI replay.
 *
 * ─── THE REPLAY MODEL ────────────────────────────────────────────────────────
 *
 * The UI receives a complete, ordered event log from the worker. Replay works
 * by applying events one at a time to a pure reducer:
 *
 *   reducer(state, event) → state'
 *
 * The reducer is a pure function with NO side effects. Given the same state
 * and event, it always produces the same next state. This makes:
 *   - Stepping forward: deterministic (just apply the next event)
 *   - Stepping backward: also deterministic (snapshot or replay from start)
 *     — for MVP: step-back is DISABLED (canStepBack = false always)
 *     — for post-M1: implement immutable snapshots or replay-from-zero
 *   - Seeking to a specific step: apply events[0..n] in order
 *
 * Each applied event produces a new state that the React component tree
 * consumes. The UI is a pure function of (eventLog, currentStepIndex).
 *
 * ─── STATE INVERSION ─────────────────────────────────────────────────────────
 *
 * The reducer does NOT store "current step" — it stores the full accumulated
 * state after applying ALL events up to the current step index. The UI
 * derives step info from the event log itself:
 *
 *   currentStepIndex  → which event is "now"
 *   totalSteps        → eventLog.length
 *   currentEvent      → eventLog[currentStepIndex]
 *   canStepForward    → currentStepIndex < totalSteps - 1
 *   canStepBack       → currentStepIndex > 0  (disabled in MVP)
 *
 * ─── PROMISE TRACKING ───────────────────────────────────────────────────────
 *
 * Promises are tracked as a Map<promiseId, PromiseRecord>. A promise record
 * captures the resolved/rejected state and the resolved value / rejection
 * reason. The UI uses this to colour-code promise nodes (pending/fulfilled/
 * rejected) and to show the settlement value on hover.
 *
 * Note: the PromiseRecord does NOT store the executor function or the
 * reaction callbacks — those are internal to the worker's instrumentation.
 *
 * ─── FRAME TRACKING ──────────────────────────────────────────────────────────
 *
 * Frames are tracked as an ordered array (logical call stack). The top of
 * the stack is the currently-executing frame. Frames are pushed on
 * frame.enter and popped on frame.exit. Async frames may suspend (parked,
 * removed from top) and later resume (pushed back to top).
 *
 * The frame stack is the primary visual element: it drives the "call stack"
 * panel and the animated pointer on the source code.
 *
 * ─── MICROTASK QUEUE ─────────────────────────────────────────────────────────
 *
 * The microtask queue is modelled as an ordered array of reaction IDs with
 * pedagogical labels. This is NOT the real JS microtask queue — it is a
 * derived view that shows what WOULD drain next.
 *
 * A reaction enters the queue via reaction.enqueue and leaves via
 * reaction.run. The queue state is updated by the reducer so the UI can
 * animate reactions entering and leaving the queue.
 *
 * ─── CONSOLE ENTRIES ─────────────────────────────────────────────────────────
 *
 * Console events are appended to an array. The UI renders them as a terminal/
 * console panel. Each entry carries its seq so it can be associated with
 * the step that produced it.
 */

import type {
  VPPEvent,
  FrameKind,
  PromiseConstructorType,
  ReactionHandlerType,
  ConsoleMethod,
} from "./event-schema";

// ─── Primitive records ───────────────────────────────────────────────────────

/**
 * ExecutionFrame
 * Represents a function call on the logical call stack during replay.
 *
 * Frames are pushed on `frame.enter` and popped on `frame.exit`. Async
 * frames transition to `suspended` state on `frame.suspend` and back to
 * `active` on `frame.resume`. While suspended, the frame is NOT at the top
 * of the stack (the worker has parked it); it is kept in the frames array
 * so we can resume it later.
 */
export interface ExecutionFrame {
  /** Unique frame identifier (matches frameId from frame.enter). */
  frameId: string;
  /** Human-readable function name. */
  name: string;
  /** Frame kind for styling/label purposes. */
  kind: FrameKind;
  /** Whether this frame is currently executing or parked. */
  status: "active" | "suspended" | "exited";
  /** seq of the frame.enter event for this frame. */
  enterSeq: number;
  /** seq of the frame.exit event, or null if not yet exited. */
  exitSeq: number | null;
  /** seq of the frame.suspend event if currently suspended, null otherwise. */
  suspendSeq: number | null;
  /** 1-indexed source position. */
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
}

/**
 * PromiseRecord
 * A live view of a tracked Promise's settlement state at the current step.
 *
 * This is updated on every `promise.create` (add to map) and `promise.settle`
 * (update state + value/reason). The UI uses the `state` field to colour
 * promise nodes and the `value`/`reason` fields for detail popovers.
 */
export interface PromiseRecord {
  promiseId: string;
  /** "pending" | "fulfilled" | "rejected" */
  state: "pending" | "fulfilled" | "rejected";
  /** The resolved value, populated when state === "fulfilled". */
  value?: unknown;
  /** The rejection reason, populated when state === "rejected". */
  reason?: unknown;
  /** seq of the promise.create event. */
  createSeq: number;
  /** seq of the promise.settle event, or null if still pending. */
  settleSeq: number | null;
  /** "Promise" | "AsyncFunction" | "Thenable" */
  constructor: PromiseConstructorType;
}

/**
 * ReactionRecord
 * A registered handler attached to a TrackedPromise.
 *
 * A reaction is added to the map on `reaction.register`. Its state
 * transitions: registered → enqueued → running → complete.
 */
export interface ReactionRecord {
  reactionId: string;
  /** The promise this reaction is attached to. */
  promiseId: string;
  /** "then" | "catch" | "finally" */
  handlerType: ReactionHandlerType;
  /** Current lifecycle state of this reaction. */
  status: "registered" | "enqueued" | "running" | "complete";
  /** seq of reaction.register */
  registerSeq: number;
  /** seq of reaction.enqueue, null if not yet queued. */
  enqueueSeq: number | null;
  /** seq of reaction.run, null if not yet started. */
  runSeq: number | null;
  /** seq of promise.reaction.fire, null if handler hasn't fired yet. */
  fireSeq: number | null;
  /** Queue position when enqueued, null if not queued. */
  queuePosition: number | null;
}

/**
 * ConsoleEntry
 * A single console output line rendered in the console panel.
 * Entries are appended in seq order; the UI displays them as a terminal log.
 */
export interface ConsoleEntry {
  /** Monotonically increasing sequence number. */
  seq: number;
  /** "log" | "info" | "warn" | "error" */
  method: ConsoleMethod;
  /** Serialised arguments. */
  args: unknown[];
  /** ISO timestamp from the event. */
  timestamp: string;
}

/**
 * MicrotaskQueue
 * The conceptual microtask queue state at the current replay step.
 *
 * This is NOT the real JS microtask queue — it is a derived model maintained
 * by the reducer. Each entry is a reaction with pedagogical metadata.
 *
 * Reactions are added via `reaction.enqueue` and removed via `reaction.run`.
 */
export interface MicrotaskQueue {
  /** Ordered array of reactions currently in the queue. */
  entries: MicrotaskQueueEntry[];
  /** Total count of reactions that have ever been enqueued (for labels like "Microtask #3"). */
  totalEnqueued: number;
}

/**
 * MicrotaskQueueEntry
 * A single reaction waiting in the microtask queue.
 */
export interface MicrotaskQueueEntry {
  reactionId: string;
  /** Human-readable label for the UI (e.g. "Microtask #1 — .then()"). */
  label: string;
  /** Queue position (0 = front of queue, drains next). */
  position: number;
  /** seq of the reaction.enqueue event that added this entry. */
  enqueueSeq: number;
}

// ─── Reducer state ───────────────────────────────────────────────────────────

/**
 * ReplayState
 * The complete state shape consumed and produced by the replay reducer.
 *
 * This is the single source of truth for the UI at any given step index.
 * The UI derives everything else (current event, step controls, visual
 * elements) from this state and the event log.
 *
 * The state is IMMUTABLE: every reducer call returns a new state object.
 * This enables React's reconciliation and supports future undo/step-back.
 */
export interface ReplayState {
  /** Ordered list of all events received from the worker. */
  eventLog: readonly VPPEvent[];

  /**
   * The step index the UI is currently displaying.
   * - 0 = before any event (clean slate)
   * - n = after applying events[0..n-1]
   * - eventLog.length = fully replayed (all events applied)
   */
  currentStepIndex: number;

  /**
   * All TrackedPromises known at the current step.
   * Keyed by promiseId for O(1) lookups from event handlers.
   */
  promises: ReadonlyMap<string, PromiseRecord>;

  /**
   * All reactions registered at the current step.
   * Keyed by reactionId for O(1) lookups.
   */
  reactions: ReadonlyMap<string, ReactionRecord>;

  /**
   * The logical call stack of execution frames at the current step.
   * Ordered from root (index 0) to currently-executing (last element).
   * Async frames may be "suspended" but are NOT removed from this array.
   */
  frameStack: readonly ExecutionFrame[];

  /**
   * The conceptual microtask queue state at the current step.
   * Maintained by the reducer: updated on reaction.enqueue and reaction.run.
   */
  microtaskQueue: MicrotaskQueue;

  /**
   * All console output produced so far, in seq order.
   * Append-only at the current step (no removals on step-back in MVP).
   */
  consoleEntries: readonly ConsoleEntry[];

  /**
   * The most recently applied event (eventLog[currentStepIndex - 1]).
   * Null when currentStepIndex === 0 (no events applied yet).
   */
  lastEvent: VPPEvent | null;

  /**
   * Whether the full execution ended with an uncaught error.
   * Set to true when execution.end fires with ok === false.
   */
  executionFailed: boolean;
}

// ─── Reducer signature ────────────────────────────────────────────────────────

/**
 * ReplayAction
 * Alias for VPPEvent in the reducer context.
 * Every event in the log is a potential action dispatched to the reducer.
 *
 * Note: In the reducer paradigm, we dispatch events one at a time as the user
 * steps through. The full log is also kept in ReplayState.eventLog so the UI
 * can reference events directly without going through state.
 */
export type ReplayAction = VPPEvent;

/**
 * Reducer
 * The pure function that advances replay state by one event.
 *
 * Signature matches the standard React reducer pattern:
 *   (state, action) => state
 *
 * IMPORTANT: The reducer must be a PURE function. No side effects, no async
 * operations, no mutations. Each call returns a new ReplayState object.
 *
 * The reducer is called by the UI's step-forward control. For step-back
 * (future), the UI either:
 *   (a) snapshots state at each step (memory-intensive but simple), or
 *   (b) replays from event[0] to event[n] on each back-step (CPU-intensive
 *       but memory-efficient — the MVP approach once step-back is needed)
 *
 * @param state  - The current ReplayState (before applying the action)
 * @param action - The next VPPEvent to apply
 * @returns A new ReplayState with the event applied
 */
export type Reducer = (state: ReplayState, action: ReplayAction) => ReplayState;

// ─── UI state contract ───────────────────────────────────────────────────────

/**
 * UIStepInfo
 * Derived information about the current step, computed from ReplayState.
 * The UI computes these on every render rather than storing them in state.
 *
 * These are NOT part of ReplayState — they are derived values that are a
 * function of (eventLog, currentStepIndex). Storing them in state would
 * create redundancy and the risk of the two copies going out of sync.
 */
export interface UIStepInfo {
  /** Whether the user can step forward to the next event. */
  canStepForward: boolean;
  /** Whether the user can step back to the previous event. */
  canStepBack: boolean;
  /** Current step number (1-indexed for display). */
  currentStep: number;
  /** Total number of steps (= eventLog.length). */
  totalSteps: number;
  /** Progress percentage (0–100). */
  progressPercent: number;
  /** The event that is about to be applied if the user steps forward. */
  nextEvent: VPPEvent | null;
  /** The last applied event (event at index currentStepIndex - 1). */
  currentEvent: VPPEvent | null;
  /** Whether the replay is at the initial state (no events applied). */
  isAtStart: boolean;
  /** Whether the replay is fully complete (all events applied). */
  isAtEnd: boolean;
}

/**
 * UIState
 * The complete state shape the React component tree consumes.
 * This bundles ReplayState with UI-specific ephemeral state (playback mode,
 * selected panel, etc.).
 *
 * The separation:
 *   - ReplayState  → deterministic, derived from event log
 *   - UIState      → includes playback controls, panel selection, theme, etc.
 *
 * The reducer ONLY manages ReplayState. UIState is managed by a separate
 * React useState/useReducer outside the replay reducer.
 */
export interface UIState {
  replay: ReplayState;
  /** Whether playback is running (auto-stepping forward on a timer). */
  isPlaying: boolean;
  /** Playback speed multiplier (1 = normal, 2 = double speed, 0.5 = half). */
  playbackSpeed: number;
  /** ID of the promise node currently selected/highlighted in the graph view. */
  selectedPromiseId: string | null;
  /** ID of the frame currently highlighted in the source view. */
  selectedFrameId: string | null;
  /** Which side panel is expanded: "stack" | "queue" | "console" | null */
  activePanel: "stack" | "queue" | "console" | null;
  /** Whether the partial-support disclaimer banner should be shown. */
  showPartialSupportBanner: boolean;
}

// ─── Initial state factory ───────────────────────────────────────────────────

/**
 * createInitialReplayState
 * Constructs the empty ReplayState before any events have been applied.
 * Used to initialise the reducer.
 *
 * @param eventLog - The complete event log from the worker (may be empty initially)
 */
export function createInitialReplayState(
  eventLog: readonly VPPEvent[] = [],
): ReplayState {
  return {
    eventLog,
    currentStepIndex: 0,
    promises: new Map(),
    reactions: new Map(),
    frameStack: [],
    microtaskQueue: { entries: [], totalEnqueued: 0 },
    consoleEntries: [],
    lastEvent: null,
    executionFailed: false,
  };
}

/**
 * deriveUIStepInfo
 * Computes UIStepInfo from a ReplayState. Called on every render.
 * This is a pure function — no state updates.
 */
export function deriveUIStepInfo(state: ReplayState): UIStepInfo {
  const { currentStepIndex, eventLog } = state;
  const totalSteps = eventLog.length;
  // currentStep matches currentStepIndex directly — execution.start is index 0.
  // "Step 1" means "showing event at index 0" (execution.start).
  const currentStep = currentStepIndex;
  const progressPercent =
    totalSteps === 0
      ? 0
      : Math.round((currentStepIndex / totalSteps) * 100);

  return {
    canStepForward: currentStepIndex < totalSteps,
    canStepBack: currentStepIndex > 0,
    currentStep,
    totalSteps,
    progressPercent: currentStepIndex >= totalSteps ? 100 : progressPercent,
    nextEvent:
      currentStepIndex < totalSteps ? (eventLog[currentStepIndex] ?? null) : null,
    currentEvent:
      currentStepIndex > 0 ? (eventLog[currentStepIndex - 1] ?? null) : null,
    isAtStart: currentStepIndex === 0,
    // Use >= so isAtEnd is true even while the final event is being rendered
    isAtEnd: currentStepIndex >= totalSteps,
  };
}

// ─── Type exports for convenience ────────────────────────────────────────────

export type {
  // Re-export key types so consumers don't need to import from event-schema
  VPPEvent,
  PromiseConstructorType,
  ReactionHandlerType,
  ConsoleMethod,
  FrameKind,
};
