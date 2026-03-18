/**
 * usePlaybackControls.ts
 *
 * Manages automatic playback of the replay (step-forward on a timer).
 *
 * Responsibilities:
 * - Start/stop the auto-step interval with play/pause
 * - Step forward one event at a time
 * - Step to the last event
 * - Control playback speed (0.5x, 1x, 2x)
 */

import { useCallback, useEffect, useRef, useState } from "react";

const SPEED_INTERVALS: Record<number, number> = {
  0.5: 1000,
  1: 500,
  2: 250,
};

export interface PlaybackControls {
  isPlaying: boolean;
  playbackSpeed: number;
  play: () => void;
  pause: () => void;
  togglePlay: () => void;
  setSpeed: (speed: number) => void;
  stepForward: () => void;
  stepToEnd: () => void;
}

interface UsePlaybackControlsOptions {
  /** Whether there is a next event to step to. */
  canStepForward: boolean;
  /** Called when stepForward should be triggered. */
  onStepForward: () => void;
  /** Called when stepping to end should be triggered. */
  onStepToEnd: () => void;
}

export function usePlaybackControls({
  canStepForward,
  onStepForward,
  onStepToEnd,
}: UsePlaybackControlsOptions): PlaybackControls {
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackSpeed, setPlaybackSpeedState] = useState(1);

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const onStepForwardRef = useRef(onStepForward);
  const onStepToEndRef = useRef(onStepToEnd);
  const canStepForwardRef = useRef(canStepForward);

  // Keep refs in sync with latest callbacks / props
  useEffect(() => {
    onStepForwardRef.current = onStepForward;
    onStepToEndRef.current = onStepToEnd;
    canStepForwardRef.current = canStepForward;
  }, [onStepForward, onStepToEnd, canStepForward]);

  const clearPlaybackInterval = useCallback(() => {
    if (intervalRef.current !== null) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  const play = useCallback(() => {
    if (!canStepForwardRef.current) return;
    setIsPlaying(true);
    const intervalMs = SPEED_INTERVALS[playbackSpeed] ?? 500;
    intervalRef.current = setInterval(() => {
      if (!canStepForwardRef.current) {
        clearPlaybackInterval();
        setIsPlaying(false);
        return;
      }
      onStepForwardRef.current();
    }, intervalMs);
  }, [playbackSpeed, clearPlaybackInterval]);

  const pause = useCallback(() => {
    clearPlaybackInterval();
    setIsPlaying(false);
  }, [clearPlaybackInterval]);

  const togglePlay = useCallback(() => {
    if (isPlaying) {
      pause();
    } else {
      play();
    }
  }, [isPlaying, play, pause]);

  const setSpeed = useCallback(
    (speed: number) => {
      setPlaybackSpeedState(speed);
      // Restart the interval with the new speed if currently playing
      if (isPlaying) {
        clearPlaybackInterval();
        const intervalMs = SPEED_INTERVALS[speed] ?? 500;
        intervalRef.current = setInterval(() => {
          if (!canStepForwardRef.current) {
            clearPlaybackInterval();
            setIsPlaying(false);
            return;
          }
          onStepForwardRef.current();
        }, intervalMs);
      }
    },
    [isPlaying, clearPlaybackInterval],
  );

  // Stop playback when there are no more steps
  useEffect(() => {
    if (isPlaying && !canStepForward) {
      clearPlaybackInterval();
      setIsPlaying(false);
    }
  }, [isPlaying, canStepForward, clearPlaybackInterval]);

  const stepForward = useCallback(() => {
    onStepForward();
  }, [onStepForward]);

  const stepToEnd = useCallback(() => {
    pause();
    onStepToEnd();
  }, [pause, onStepToEnd]);

  // Cleanup on unmount
  useEffect(() => {
    return clearPlaybackInterval;
  }, [clearPlaybackInterval]);

  return {
    isPlaying,
    playbackSpeed,
    play,
    pause,
    togglePlay,
    setSpeed,
    stepForward,
    stepToEnd,
  };
}
