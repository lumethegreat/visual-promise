/**
 * useExecution.ts
 *
 * Orchestrates the full execution pipeline: validation → worker execution → replay state.
 *
 * Responsibilities:
 * - Validate snippets before execution
 * - Spin up / tear down the executor Web Worker
 * - Stream events from the worker into the replay state via useReducer
 * - Maintain the raw eventLog (source of truth) separately from replayState
 * - Expose playback controls (play, pause, step, speed)
 *
 * Note: replayReducer is imported from src/lib/replay-reducer.ts when available.
 * Until then, an inline implementation is used. After the vp-replay-reducer agent
 * commits its file, update the import below and remove the inline reducer.
 */

import {
  useCallback,
  useEffect,
  useReducer,
  useRef,
  useState,
} from "react";
import { validateSnippet } from "../lib/validator";
import type { ValidationResult } from "../lib/validation-result";
import {
  createInitialReplayState,
  deriveUIStepInfo,
} from "../../docs/replay-state";
import type {
  ExecutionFrame,
  PromiseRecord,
  ReactionRecord,
  MicrotaskQueueEntry,
  ConsoleEntry,
  ReplayState,
} from "../../docs/replay-state";
import type { VPPEvent } from "../../docs/event-schema";
import type { SerializedError, ExecutorResult } from "../workers/executor.types";
import { usePlaybackControls } from "./usePlaybackControls";
import type {
  ExecutionEndEvent,
  FrameEnterEvent,
  FrameSuspendEvent,
  FrameResumeEvent,
  FrameExitEvent,
  PromiseCreateEvent,
  PromiseSettleEvent,
  ReactionRegisterEvent,
  ReactionEnqueueEvent,
  ReactionRunEvent,
  PromiseReactionFireEvent,
  FinallyRegisterEvent,
  FinallyCompleteEvent,
  ConsoleOutputEvent,
  ConsoleWarnEvent,
  ConsoleErrorEvent,
} from "../../docs/event-schema";

// ─── Inline reducer ─────────────────────────────────────────────────────────
//
// This is a temporary inline implementation until src/lib/replay-reducer.ts
// is committed by the vp-replay-reducer agent. Once that file exists,
// replace the import below and remove this section.

function updateFrameInStack(
  stack: readonly ExecutionFrame[],
  frameId: string,
  updates: Partial<ExecutionFrame>,
): readonly ExecutionFrame[] {
  return stack.map((f) => (f.frameId === frameId ? { ...f, ...updates } : f));
}

function inlineReducer(state: ReplayState, event: VPPEvent): ReplayState {
  switch (event.type) {
    case "execution.start": {
      return {
        ...state,
        eventLog: [...state.eventLog, event],
        currentStepIndex: state.currentStepIndex + 1,
        lastEvent: event,
      };
    }

    case "execution.end": {
      const data = (event as ExecutionEndEvent).data;
      return {
        ...state,
        eventLog: [...state.eventLog, event],
        currentStepIndex: state.currentStepIndex + 1,
        lastEvent: event,
        executionFailed: !data.ok,
      };
    }

    case "frame.enter": {
      const e = event as FrameEnterEvent;
      const frame: ExecutionFrame = {
        frameId: e.data.frameId,
        name: e.data.name,
        kind: e.data.kind,
        status: "active",
        enterSeq: e.seq,
        exitSeq: e.data.exitSeq,
        suspendSeq: null,
        startLine: e.data.startLine,
        startColumn: e.data.startColumn,
        endLine: e.data.endLine,
        endColumn: e.data.endColumn,
      };
      return {
        ...state,
        eventLog: [...state.eventLog, event],
        currentStepIndex: state.currentStepIndex + 1,
        frameStack: [...state.frameStack, frame],
        lastEvent: event,
      };
    }

    case "frame.suspend": {
      const e = event as FrameSuspendEvent;
      return {
        ...state,
        eventLog: [...state.eventLog, event],
        currentStepIndex: state.currentStepIndex + 1,
        frameStack: updateFrameInStack(state.frameStack, e.data.frameId, {
          status: "suspended",
          suspendSeq: e.seq,
        }),
        lastEvent: event,
      };
    }

    case "frame.resume": {
      const e = event as FrameResumeEvent;
      return {
        ...state,
        eventLog: [...state.eventLog, event],
        currentStepIndex: state.currentStepIndex + 1,
        frameStack: updateFrameInStack(state.frameStack, e.data.frameId, {
          status: "active",
        }),
        lastEvent: event,
      };
    }

    case "frame.exit": {
      const e = event as FrameExitEvent;
      return {
        ...state,
        eventLog: [...state.eventLog, event],
        currentStepIndex: state.currentStepIndex + 1,
        frameStack: updateFrameInStack(state.frameStack, e.data.frameId, {
          status: "exited",
          exitSeq: e.seq,
        }),
        lastEvent: event,
      };
    }

    case "promise.create": {
      const e = event as PromiseCreateEvent;
      const record: PromiseRecord = {
        promiseId: e.data.promiseId,
        state: "pending",
        createSeq: e.seq,
        settleSeq: null,
        constructor: e.data.constructor,
      };
      const promises = new Map(state.promises);
      promises.set(e.data.promiseId, record);
      return {
        ...state,
        eventLog: [...state.eventLog, event],
        currentStepIndex: state.currentStepIndex + 1,
        promises,
        lastEvent: event,
      };
    }

    case "promise.settle": {
      const e = event as PromiseSettleEvent;
      const promises = new Map(state.promises);
      const existing = promises.get(e.data.promiseId);
      if (existing) {
        promises.set(e.data.promiseId, {
          ...existing,
          state: e.data.state,
          value: e.data.value,
          reason: e.data.reason,
          settleSeq: e.seq,
        });
      }
      return {
        ...state,
        eventLog: [...state.eventLog, event],
        currentStepIndex: state.currentStepIndex + 1,
        promises,
        lastEvent: event,
      };
    }

    case "reaction.register": {
      const e = event as ReactionRegisterEvent;
      const record: ReactionRecord = {
        reactionId: e.data.reactionId,
        promiseId: e.data.promiseId,
        handlerType: e.data.handlerType,
        status: "registered",
        registerSeq: e.seq,
        enqueueSeq: null,
        runSeq: null,
        fireSeq: null,
        queuePosition: null,
      };
      const reactions = new Map(state.reactions);
      reactions.set(e.data.reactionId, record);
      return {
        ...state,
        eventLog: [...state.eventLog, event],
        currentStepIndex: state.currentStepIndex + 1,
        reactions,
        lastEvent: event,
      };
    }

    case "reaction.enqueue": {
      const e = event as ReactionEnqueueEvent;
      const reactions = new Map(state.reactions);
      const reaction = reactions.get(e.data.reactionId);
      if (reaction) {
        reactions.set(e.data.reactionId, {
          ...reaction,
          status: "enqueued",
          enqueueSeq: e.seq,
          queuePosition: e.data.queuePosition,
        });
      }
      const label = `Microtask #${state.microtaskQueue.totalEnqueued + 1}`;
      const entry: MicrotaskQueueEntry = {
        reactionId: e.data.reactionId,
        label,
        position: e.data.queuePosition,
        enqueueSeq: e.seq,
      };
      const sortedEntries = [...state.microtaskQueue.entries, entry].sort(
        (a, b) => a.position - b.position,
      );
      return {
        ...state,
        eventLog: [...state.eventLog, event],
        currentStepIndex: state.currentStepIndex + 1,
        reactions,
        microtaskQueue: {
          entries: sortedEntries,
          totalEnqueued: state.microtaskQueue.totalEnqueued + 1,
        },
        lastEvent: event,
      };
    }

    case "reaction.run": {
      const e = event as ReactionRunEvent;
      const reactions = new Map(state.reactions);
      const reaction = reactions.get(e.data.reactionId);
      if (reaction) {
        reactions.set(e.data.reactionId, {
          ...reaction,
          status: "running",
          runSeq: e.seq,
        });
      }
      const entries = state.microtaskQueue.entries.filter(
        (entry) => entry.reactionId !== e.data.reactionId,
      );
      return {
        ...state,
        eventLog: [...state.eventLog, event],
        currentStepIndex: state.currentStepIndex + 1,
        reactions,
        microtaskQueue: { ...state.microtaskQueue, entries },
        lastEvent: event,
      };
    }

    case "promise.reaction.fire": {
      const e = event as PromiseReactionFireEvent;
      const reactions = new Map(state.reactions);
      const reaction = reactions.get(e.data.reactionId);
      if (reaction) {
        reactions.set(e.data.reactionId, {
          ...reaction,
          status: "running",
          fireSeq: e.seq,
        });
      }
      return {
        ...state,
        eventLog: [...state.eventLog, event],
        currentStepIndex: state.currentStepIndex + 1,
        reactions,
        lastEvent: event,
      };
    }

    case "await.suspend": {
      return {
        ...state,
        eventLog: [...state.eventLog, event],
        currentStepIndex: state.currentStepIndex + 1,
        lastEvent: event,
      };
    }

    case "await.resume": {
      return {
        ...state,
        eventLog: [...state.eventLog, event],
        currentStepIndex: state.currentStepIndex + 1,
        lastEvent: event,
      };
    }

    case "finally.register": {
      const e = event as FinallyRegisterEvent;
      const record: ReactionRecord = {
        reactionId: e.data.reactionId,
        promiseId: e.data.promiseId,
        handlerType: "finally",
        status: "registered",
        registerSeq: e.seq,
        enqueueSeq: null,
        runSeq: null,
        fireSeq: null,
        queuePosition: null,
      };
      const reactions = new Map(state.reactions);
      reactions.set(e.data.reactionId, record);
      return {
        ...state,
        eventLog: [...state.eventLog, event],
        currentStepIndex: state.currentStepIndex + 1,
        reactions,
        lastEvent: event,
      };
    }

    case "finally.complete": {
      const e = event as FinallyCompleteEvent;
      const reactions = new Map(state.reactions);
      const reaction = reactions.get(e.data.reactionId);
      if (reaction) {
        reactions.set(e.data.reactionId, {
          ...reaction,
          status: "complete",
        });
      }
      return {
        ...state,
        eventLog: [...state.eventLog, event],
        currentStepIndex: state.currentStepIndex + 1,
        reactions,
        lastEvent: event,
      };
    }

    case "console.output":
    case "console.warn":
    case "console.error": {
      const e = event as ConsoleOutputEvent | ConsoleWarnEvent | ConsoleErrorEvent;
      const entry: ConsoleEntry = {
        seq: e.seq,
        method: e.data.method,
        args: e.data.args,
        timestamp: e.timestamp,
      };
      return {
        ...state,
        eventLog: [...state.eventLog, event],
        currentStepIndex: state.currentStepIndex + 1,
        consoleEntries: [...state.consoleEntries, entry],
        lastEvent: event,
      };
    }

    case "error.throw": {
      return {
        ...state,
        eventLog: [...state.eventLog, event],
        currentStepIndex: state.currentStepIndex + 1,
        lastEvent: event,
      };
    }

    case "error.reject": {
      return {
        ...state,
        eventLog: [...state.eventLog, event],
        currentStepIndex: state.currentStepIndex + 1,
        lastEvent: event,
      };
    }

    case "error.catch": {
      return {
        ...state,
        eventLog: [...state.eventLog, event],
        currentStepIndex: state.currentStepIndex + 1,
        lastEvent: event,
      };
    }

    case "error.unhandled": {
      return {
        ...state,
        eventLog: [...state.eventLog, event],
        currentStepIndex: state.currentStepIndex + 1,
        executionFailed: true,
        lastEvent: event,
      };
    }

    default: {
      // Exhaustiveness: if we missed an event type, just add it to the log
      return {
        ...state,
        eventLog: [...state.eventLog, event],
        currentStepIndex: state.currentStepIndex + 1,
        lastEvent: event,
      };
    }
  }
}

// ─── Execution status ────────────────────────────────────────────────────────

type ExecutionStatus = "idle" | "validating" | "running" | "done" | "error";

// ─── Hook ───────────────────────────────────────────────────────────────────

export interface UseExecutionReturn {
  status: ExecutionStatus;
  validationResult: ValidationResult | null;
  eventLog: VPPEvent[];
  replayState: ReplayState;
  uiStepInfo: ReturnType<typeof deriveUIStepInfo>;
  executionError: SerializedError | null;

  // Actions
  execute: (code: string) => void;
  stepForward: () => void;
  stepToEnd: () => void;
  reset: () => void;

  // Playback
  isPlaying: boolean;
  playbackSpeed: number;
  setPlaybackSpeed: (speed: number) => void;
  play: () => void;
  pause: () => void;
}

export function useExecution(): UseExecutionReturn {
  // ── State ────────────────────────────────────────────────────────────────
  const [status, setStatus] = useState<ExecutionStatus>("idle");
  const [validationResult, setValidationResult] =
    useState<ValidationResult | null>(null);
  const [eventLog, setEventLog] = useState<VPPEvent[]>([]);
  const [replayState, dispatch] = useReducer(
    inlineReducer,
    [],
    createInitialReplayState,
  );
  const [executionError, setExecutionError] =
    useState<SerializedError | null>(null);

  // ── Worker ref ───────────────────────────────────────────────────────────
  const workerRef = useRef<Worker | null>(null);

  // Initialise worker once
  if (workerRef.current === null) {
    workerRef.current = new Worker(
      new URL("../workers/executor.worker.ts", import.meta.url),
    );
  }

  // ── Playback controls ─────────────────────────────────────────────────────
  const uiStepInfo = deriveUIStepInfo(replayState);

  const handleStepForward = useCallback(() => {
    const { eventLog: log, currentStepIndex } = replayState;
    const event = log[currentStepIndex];
    if (event !== undefined) {
      dispatch(event);
    }
  }, [replayState]);

  const handleStepToEnd = useCallback(() => {
    // Step through all remaining events
    const { eventLog: log, currentStepIndex } = replayState;
    const remaining = log.slice(currentStepIndex);
    remaining.forEach((evt) => dispatch(evt));
  }, [replayState]);

  const {
    isPlaying,
    playbackSpeed,
    play,
    pause,
    setSpeed: setPlaybackSpeed,
    stepForward,
    stepToEnd,
  } = usePlaybackControls({
    canStepForward: uiStepInfo.canStepForward,
    onStepForward: handleStepForward,
    onStepToEnd: handleStepToEnd,
  });

  // ── Worker message handler ────────────────────────────────────────────────
  useEffect(() => {
    const worker = workerRef.current;
    if (!worker) return;

    const onMessage = (e: MessageEvent<ExecutorResult>) => {
      const result = e.data;

      if (result.type === "event") {
        const event = result.event as VPPEvent;
        setEventLog((prev) => [...prev, event]);
        dispatch(event);
        return;
      }

      if (result.type === "done") {
        setStatus("done");
        return;
      }

      if (result.type === "error") {
        setStatus("error");
        setExecutionError(result.error);
        return;
      }

      // "ready" — worker initialised, do nothing
    };

    worker.addEventListener("message", onMessage);
    return () => worker.removeEventListener("message", onMessage);
  }, []);

  // ── Cleanup on unmount ────────────────────────────────────────────────────
  useEffect(() => {
    return () => {
      workerRef.current?.terminate();
      workerRef.current = null;
    };
  }, []);

  // ── Actions ──────────────────────────────────────────────────────────────

  /**
   * execute
   * Validates the snippet then sends it to the worker for execution.
   * - 'error' validation → status = 'error', no worker call
   * - 'warning' validation → status = 'running', show banner
   * - 'ok' validation → status = 'running'
   */
  const execute = useCallback(
    (code: string) => {
      // Reset state from previous run
      setEventLog([]);
      setExecutionError(null);
      setStatus("validating");

      const validation = validateSnippet(code);
      setValidationResult(validation);

      if (validation.level === "error") {
        setStatus("error");
        return;
      }

      // warning or ok — proceed
      setStatus("running");

      const worker = workerRef.current;
      if (!worker) {
        setStatus("error");
        setExecutionError({
          name: "WorkerError",
          message: "Executor worker is not available.",
          stack: "",
        });
        return;
      }

      worker.postMessage({ type: "execute", code } satisfies {
        type: "execute";
        code: string;
      });
    },
    [],
  );

  /**
   * reset
   * Clears all execution state and terminates the current worker.
   * A new worker will be created on the next execute() call.
   */
  const reset = useCallback(() => {
    workerRef.current?.terminate();
    workerRef.current = null;
    setStatus("idle");
    setValidationResult(null);
    setEventLog([]);
    setExecutionError(null);
  }, []);

  return {
    status,
    validationResult,
    eventLog,
    replayState,
    uiStepInfo,
    executionError,
    execute,
    stepForward,
    stepToEnd,
    reset,
    isPlaying,
    playbackSpeed,
    setPlaybackSpeed,
    play,
    pause,
  };
}
