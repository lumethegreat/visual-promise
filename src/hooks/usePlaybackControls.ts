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
  stepBack: () => void;
  stepToEnd: () => void;
}

interface UsePlaybackControlsOptions {
  /** Whether there is a next event to step to. */
  canStepForward: boolean;
  /** Whether there is a previous event to step back to. */
  canStepBack: boolean;
  /** Called when stepForward should be triggered. */
  onStepForward: () => void;
  /** Called when stepping back should be triggered. */
  onStepBack: () => void;
  /** Called when stepping to end should be triggered. */
  onStepToEnd: () => void;
}

export function usePlaybackControls({
  canStepForward,
  canStepBack: _canStepBack,
  onStepForward,
  onStepBack,
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onStepForward, onStepToEnd, canStepForward]);

  const isPlayingRef = useRef(false);

  const clearPlaybackInterval = useCallback(() => {
    if (intervalRef.current !== null) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  const play = useCallback(
    (canStepForwardCurrent: boolean) => {
      if (!canStepForwardRef.current) return;
      isPlayingRef.current = true;
      setIsPlaying(true);
      const intervalMs = SPEED_INTERVALS[playbackSpeed] ?? 500;
      intervalRef.current = setInterval(() => {
        // Read from REF so it's always current — not from closure param
        if (!canStepForwardRef.current) {
          clearPlaybackInterval();
          isPlayingRef.current = false;
          setIsPlaying(false);
          return;
        }
        onStepForwardRef.current();
      }, intervalMs);
    },
    [playbackSpeed, clearPlaybackInterval],
  );

  const pause = useCallback(() => {
    clearPlaybackInterval();
    isPlayingRef.current = false;
    setIsPlaying(false);
  }, [clearPlaybackInterval]);

  const togglePlay = useCallback(() => {
    if (isPlayingRef.current) {
      pause();
    } else {
      play(canStepForward);
    }
  }, [play, pause, canStepForward]);

  const setSpeed = useCallback(
    (speed: number) => {
      setPlaybackSpeedState(speed);
      // Restart the interval with the new speed if currently playing
      if (isPlaying) {
        clearPlaybackInterval();
        const intervalMs = SPEED_INTERVALS[speed] ?? 500;
        intervalRef.current = setInterval(() => {
          // Read from REF so it's always current
          if (!canStepForwardRef.current) {
            clearPlaybackInterval();
            setIsPlaying(false);
            return;
          }
          onStepForwardRef.current();
        }, intervalMs);
      }
    },
    [isPlaying, clearPlaybackInterval, canStepForward],
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

  const stepBack = useCallback(() => {
    pause();
    onStepBack();
  }, [pause, onStepBack]);

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
    stepBack,
    stepToEnd,
  };
}
