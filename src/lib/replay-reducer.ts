/**
 * Replay Reducer — Visual Promise
 * ================================
 *
 * Pure reducer that transforms an ordered event log into navigable replay state.
 *
 * Each call receives (state, event) and returns a new ReplayState — no mutations,
 * no side effects. This is the core of the step-by-step replay engine.
 *
 * The reducer handles ALL 23 VPPEvent types defined in docs/event-schema.ts.
 */

import type {
  VPPEvent,
  ReactionHandlerType,
} from "../../docs/event-schema";

import type {
  ReplayState,
  ExecutionFrame,
  ConsoleEntry,
  MicrotaskQueue,
  MicrotaskQueueEntry,
} from "../../docs/replay-state";

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Re-indexes microtask queue entries after a dequeue operation.
 * Assigns sequential `position` values (0-based) to all remaining entries.
 */
function reindexQueue(
  entries: MicrotaskQueueEntry[],
): Pick<MicrotaskQueue, "entries"> {
  return {
    entries: entries.map((entry, i) => ({ ...entry, position: i })),
  };
}

// ─── Main reducer ──────────────────────────────────────────────────────────

/**
 * replayReducer
 *
 * Pure reducer: given the same state and event, always returns the same next state.
 *
 * @param state  - The current ReplayState (before applying the event)
 * @param action - The VPPEvent to apply
 * @returns A new ReplayState with the event applied
 */
export function replayReducer(
  state: ReplayState,
  action: VPPEvent,
): ReplayState {
  // Start from a shallow copy so we only replace the fields that actually change
  const newState: ReplayState = {
    ...state,
    promises: state.promises,
    reactions: state.reactions,
    frameStack: state.frameStack,
    microtaskQueue: state.microtaskQueue,
    consoleEntries: state.consoleEntries,
  };

  // Mutable scratch maps for this event — converted to ReadonlyMap on assignment
  const newPromises = new Map(state.promises);
  const newReactions = new Map(state.reactions);

  switch (action.type) {
    // ── Execution lifecycle ─────────────────────────────────────────────────

    case "execution.start":
    case "execution.end":
      // Marker events — no state change needed
      return state;

    // ── Promise lifecycle ─────────────────────────────────────────────────

    case "promise.create": {
      newPromises.set(action.data.promiseId, {
        promiseId: action.data.promiseId,
        state: "pending",
        createSeq: action.seq,
        settleSeq: null,
        constructor: action.data.constructor,
      });
      newState.promises = newPromises;
      newState.lastEvent = action;
      return newState;
    }

    case "promise.settle": {
      const existing = newPromises.get(action.data.promiseId);
      if (existing) {
        newPromises.set(action.data.promiseId, {
          ...existing,
          state: action.data.state === "fulfilled" ? "fulfilled" : "rejected",
          value: action.data.value,
          reason: action.data.reason,
          settleSeq: action.seq,
        });
      }
      newState.promises = newPromises;
      newState.lastEvent = action;
      return newState;
    }

    // ── Reaction lifecycle ────────────────────────────────────────────────

    case "reaction.register": {
      newReactions.set(action.data.reactionId, {
        reactionId: action.data.reactionId,
        promiseId: action.data.promiseId,
        handlerType: action.data.handlerType as ReactionHandlerType,
        status: "registered",
        registerSeq: action.seq,
        enqueueSeq: null,
        runSeq: null,
        fireSeq: null,
        queuePosition: null,
      });
      newState.reactions = newReactions;
      newState.lastEvent = action;
      return newState;
    }

    case "reaction.enqueue": {
      const reaction = newReactions.get(action.data.reactionId);
      if (reaction) {
        const newTotalEnqueued = state.microtaskQueue.totalEnqueued + 1;
        const label = `${reaction.handlerType} #${newTotalEnqueued}`;
        const position = state.microtaskQueue.entries.length;

        newReactions.set(action.data.reactionId, {
          ...reaction,
          status: "enqueued",
          enqueueSeq: action.seq,
          queuePosition: position,
        });

        const newEntry: MicrotaskQueueEntry = {
          reactionId: action.data.reactionId,
          label,
          position,
          enqueueSeq: action.seq,
        };

        newState.microtaskQueue = {
          entries: [...state.microtaskQueue.entries, newEntry],
          totalEnqueued: newTotalEnqueued,
        };
      }
      newState.reactions = newReactions;
      newState.lastEvent = action;
      return newState;
    }

    case "reaction.run": {
      const runReaction = newReactions.get(action.data.reactionId);
      if (runReaction) {
        newReactions.set(action.data.reactionId, {
          ...runReaction,
          status: "running",
          runSeq: action.seq,
          queuePosition: null,
        });

        const remainingEntries = state.microtaskQueue.entries.filter(
          (e: MicrotaskQueueEntry) => e.reactionId !== action.data.reactionId,
        );

        newState.microtaskQueue = {
          ...reindexQueue(remainingEntries),
          totalEnqueued: state.microtaskQueue.totalEnqueued,
        };
      }
      newState.reactions = newReactions;
      newState.lastEvent = action;
      return newState;
    }

    case "promise.reaction.fire": {
      const fireReaction = newReactions.get(action.data.reactionId);
      if (fireReaction) {
        newReactions.set(action.data.reactionId, {
          ...fireReaction,
          status: "complete",
          fireSeq: action.seq,
        });
      }
      newState.reactions = newReactions;
      newState.lastEvent = action;
      return newState;
    }

    // ── Frame lifecycle ────────────────────────────────────────────────────

    case "frame.enter": {
      const frame: ExecutionFrame = {
        frameId: action.data.frameId,
        name: action.data.name,
        kind: action.data.kind,
        status: "active",
        enterSeq: action.seq,
        exitSeq: null,
        suspendSeq: null,
        startLine: action.data.startLine,
        startColumn: action.data.startColumn,
        endLine: action.data.endLine,
        endColumn: action.data.endColumn,
      };
      newState.frameStack = [...state.frameStack, frame];
      newState.lastEvent = action;
      return newState;
    }

    case "frame.exit": {
      newState.frameStack = state.frameStack.map((f: ExecutionFrame) =>
        f.frameId === action.data.frameId
          ? { ...f, status: "exited", exitSeq: action.seq }
          : f,
      );
      newState.lastEvent = action;
      return newState;
    }

    case "frame.suspend": {
      newState.frameStack = state.frameStack.map((f: ExecutionFrame) =>
        f.frameId === action.data.frameId
          ? { ...f, status: "suspended", suspendSeq: action.seq }
          : f,
      );
      newState.lastEvent = action;
      return newState;
    }

    case "frame.resume": {
      newState.frameStack = state.frameStack.map((f: ExecutionFrame) =>
        f.frameId === action.data.frameId
          ? { ...f, status: "active", suspendSeq: null }
          : f,
      );
      newState.lastEvent = action;
      return newState;
    }

    // ── Await ─────────────────────────────────────────────────────────────

    case "await.suspend": {
      // Suspend the currently-active async frame
      newState.frameStack = state.frameStack.map((f: ExecutionFrame) =>
        f.kind === "async" && f.status === "active"
          ? { ...f, status: "suspended", suspendSeq: action.seq }
          : f,
      );
      newState.lastEvent = action;
      return newState;
    }

    case "await.resume": {
      // Resume the most recently suspended async frame
      const suspendedFrame = [...state.frameStack].reverse().find(
        (f: ExecutionFrame) => f.status === "suspended",
      );
      if (suspendedFrame) {
        newState.frameStack = state.frameStack.map((f: ExecutionFrame) =>
          f.frameId === suspendedFrame.frameId
            ? { ...f, status: "active", suspendSeq: null }
            : f,
        );
      }
      newState.lastEvent = action;
      return newState;
    }

    // ── finally() ──────────────────────────────────────────────────────────

    case "finally.register": {
      // finally.register creates a pass-through reaction alongside the onFinally reaction.
      // The onFinally reaction is already registered via reaction.register, so we only
      // track the pass-through reaction here for completeness.
      // (The pass-through reaction is handled implicitly by the promise settlement flow.)
      // We record it with status "registered" to maintain the reaction map.
      newReactions.set(action.data.reactionId, {
        reactionId: action.data.reactionId,
        promiseId: action.data.promiseId,
        handlerType: "finally",
        status: "registered",
        registerSeq: action.seq,
        enqueueSeq: null,
        runSeq: null,
        fireSeq: null,
        queuePosition: null,
      });
      newState.reactions = newReactions;
      newState.lastEvent = action;
      return newState;
    }

    case "finally.complete": {
      // finally.complete just updates the reaction status — the settlement
      // flows through the pass-through reaction automatically.
      const finReaction = newReactions.get(action.data.reactionId);
      if (finReaction) {
        newReactions.set(action.data.reactionId, {
          ...finReaction,
          status: "complete",
          fireSeq: action.seq,
        });
      }
      newState.reactions = newReactions;
      newState.lastEvent = action;
      return newState;
    }

    // ── Console ───────────────────────────────────────────────────────────

    case "console.output":
    case "console.warn":
    case "console.error": {
      const entry: ConsoleEntry = {
        seq: action.seq,
        method: action.data.method,
        args: action.data.args,
        timestamp: action.timestamp,
      };
      newState.consoleEntries = [...state.consoleEntries, entry];
      newState.lastEvent = action;
      return newState;
    }

    // ── Errors ────────────────────────────────────────────────────────────

    case "error.throw": {
      newState.executionFailed = true;
      newState.lastEvent = action;
      return newState;
    }

    case "error.reject": {
      // Mark the promise as rejected via promise.settle — error.reject is
      // annotational (shows cause) but the state change comes from promise.settle.
      // We still track lastEvent so the UI knows this event happened.
      newState.lastEvent = action;
      return newState;
    }

    case "error.catch": {
      // A thrown error was caught — frame exit will handle the frame state;
      // error.catch is informational for the UI.
      newState.lastEvent = action;
      return newState;
    }

    case "error.unhandled": {
      newState.executionFailed = true;
      newState.lastEvent = action;
      return newState;
    }

    // ── Unknown event type ────────────────────────────────────────────────

    default: {
      // Forward-compatibility: unknown event types leave state unchanged.
      // This allows the system to evolve without breaking older reducer versions.
      return state;
    }
  }
}
