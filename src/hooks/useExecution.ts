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
  /** True after a worker "error" message (persists through done). */
  showErrorBanner: boolean;

  // Actions
  execute: (code: string) => void;
  stepForward: () => void;
  stepBack: () => void;
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
  const [showErrorBanner, setShowErrorBanner] =
    useState(false);

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

  const handleStepBack = useCallback(() => {
    dispatch({ type: "step.back" } as unknown as VPPEvent);
  }, []);

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
    stepBack,
    stepToEnd,
  } = usePlaybackControls({
    canStepForward: uiStepInfo.canStepForward,
    canStepBack: uiStepInfo.canStepBack,
    onStepForward: handleStepForward,
    onStepBack: handleStepBack,
    onStepToEnd: handleStepToEnd,
  });

  // ── Worker lifecycle ───────────────────────────────────────────────────────
  useEffect(() => {
    // Create the worker eagerly so the listener is always attached before
    // any execute() call can post messages. Refs don't trigger re-renders,
    // so a worker created lazily inside execute() would miss the listener.
    const worker = new Worker(
      new URL("../workers/executor.worker.ts", import.meta.url),
      { type: "module" },
    );
    workerRef.current = worker;

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
        setShowErrorBanner(true);
        return;
      }

      // "ready" — worker initialised, do nothing
    };

    worker.addEventListener("message", onMessage);

    return () => {
      worker.terminate();
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
    setShowErrorBanner(false);
    setStatus("validating");

    const validation = validateSnippet(code);
    setValidationResult(validation);

    if (validation.level === "error") {
      setStatus("error");
      return;
    }

    // warning or ok — proceed
    setStatus("running");

    // Worker is created eagerly by useEffect, but reset() can terminate it.
    // Recreate if needed.
    if (workerRef.current === null) {
      const w = new Worker(
        new URL("../workers/executor.worker.ts", import.meta.url),
        { type: "module" },
      );
      // Re-attach the same listener pattern
      w.addEventListener("message", (e: MessageEvent) => {
        const result = e.data;
        if (result.type === "event") { dispatch(result.event as VPPEvent); return; }
        if (result.type === "done") { setStatus("done"); return; }
        if (result.type === "error") { setStatus("error"); setExecutionError(result.error); setShowErrorBanner(true); return; }
      });
      workerRef.current = w;
    }

    const worker = workerRef.current;
    worker.postMessage({ type: "execute", code });
  }, []);

  /**
   * reset
   * Clears all execution state and terminates the current worker.
   */
  const reset = useCallback(() => {
    // Signal the worker to abort BEFORE terminating it.
    // This ensures emitDone() checks state.aborted and returns early.
    workerRef.current?.postMessage({ type: "terminate" });
    workerRef.current?.terminate();
    workerRef.current = null;  // Effect won't recreate since it has [] deps — execute() handles it
    setStatus("idle");
    setValidationResult(null);
    setExecutionError(null);
    setShowErrorBanner(false);
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
    showErrorBanner,
    execute,
    stepForward,
    stepBack,
    stepToEnd,
    reset,
    isPlaying,
    playbackSpeed,
    setPlaybackSpeed,
    play,
    pause,
  };
}
