/**
 * useExecution.ts
 *
 * Orchestrates the full execution pipeline: validation → worker execution → replay state.
 *
 * Responsibilities:
 * - Validate snippets before execution
 * - Spin up / tear down the executor Web Worker
 * - Stream events from the worker into the replay state via useReducer
 * - Expose playback controls (play, pause, step, speed)
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
import { replayReducer } from "../lib/replay-reducer";
import {
  createInitialReplayState,
  deriveUIStepInfo,
} from "../../docs/replay-state";
import type { VPPEvent } from "../../docs/event-schema";
import type { SerializedError } from "../workers/executor.types";
import type { ReplayState } from "../../docs/replay-state";
import { usePlaybackControls } from "./usePlaybackControls";

// ─── Execution status ────────────────────────────────────────────────────────

type ExecutionStatus = "idle" | "validating" | "running" | "done" | "error";

// ─── Hook ───────────────────────────────────────────────────────────────────

export interface UseExecutionReturn {
  status: ExecutionStatus;
  validationResult: ValidationResult | null;
  /** The full ordered event log from the worker. */
  eventLog: readonly VPPEvent[];
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
  const [executionError, setExecutionError] =
    useState<SerializedError | null>(null);

  // Replay state is managed entirely by the reducer.
  // eventLog lives inside replayState.eventLog — no separate state needed.
  const [replayState, dispatch] = useReducer(
    replayReducer,
    [],
    createInitialReplayState,
  );

  // ── Worker ref ───────────────────────────────────────────────────────────
  const workerRef = useRef<Worker | null>(null);

  // ── Playback controls ─────────────────────────────────────────────────────
  const uiStepInfo = deriveUIStepInfo(replayState);

  const handleStepForward = useCallback(() => {
    const { eventLog, currentStepIndex } = replayState;
    const nextEvent = eventLog[currentStepIndex];
    if (nextEvent !== undefined) {
      dispatch(nextEvent);
    }
  }, [replayState]);

  const handleStepToEnd = useCallback(() => {
    const { eventLog, currentStepIndex } = replayState;
    const remaining = eventLog.slice(currentStepIndex);
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

  // ── Worker lifecycle ───────────────────────────────────────────────────────
  useEffect(() => {
    const worker = workerRef.current;
    if (!worker) return;

    const onMessage = (e: MessageEvent) => {
      const result = e.data;

      if (result.type === "event") {
        dispatch(result.event as VPPEvent);
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

  // ── Cleanup on unmount ───────────────────────────────────────────────────
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
  const execute = useCallback((code: string) => {
    // Reset replay state for a fresh run
    dispatch({ type: "__RESET__" } as unknown as VPPEvent);
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

    // Lazy-create worker on first execute call
    if (workerRef.current === null) {
      workerRef.current = new Worker(
        new URL("../workers/executor.worker.ts", import.meta.url),
        { type: "module" },
      );
    }

    const worker = workerRef.current;
    worker.postMessage({ type: "execute", code });
  }, []);

  /**
   * reset
   * Clears all execution state and terminates the current worker.
   */
  const reset = useCallback(() => {
    workerRef.current?.terminate();
    workerRef.current = null;
    setStatus("idle");
    setValidationResult(null);
    setExecutionError(null);
    // Reset reducer state by dispatching a no-op that re-initialises
    // (the reducer will rebuild from the fresh createInitialReplayState)
    dispatch({ type: "__RESET__" } as unknown as VPPEvent);
  }, []);

  return {
    status,
    validationResult,
    eventLog: replayState.eventLog,
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
