import type { UIStepInfo } from "../../docs/replay-state";

interface StepControlsProps {
  uiStepInfo: UIStepInfo;
  isPlaying: boolean;
  playbackSpeed: number;
  onStepForward: () => void;
  onStepToEnd: () => void;
  onPlay: () => void;
  onPause: () => void;
  onSpeedChange: (speed: number) => void;
}

export function StepControls({
  uiStepInfo,
  isPlaying,
  playbackSpeed,
  onStepForward,
  onStepToEnd,
  onPlay,
  onPause,
  onSpeedChange,
}: StepControlsProps) {
  return (
    <div className="step-controls">
      <button
        onClick={onStepForward}
        disabled={!uiStepInfo.canStepForward}
        title="Step forward"
      >
        ▶
      </button>
      <button onClick={isPlaying ? onPause : onPlay}>
        {isPlaying ? "⏸" : "▶"}
      </button>
      <button
        onClick={onStepToEnd}
        disabled={!uiStepInfo.canStepForward}
        title="Step to end"
      >
        ▶▶
      </button>
      <div className="step-indicator">
        {uiStepInfo.isAtStart
          ? "Ready —"
          : `Step ${uiStepInfo.currentStep} / ${uiStepInfo.totalSteps}`}
      </div>
      <div className="progress-bar">
        <div
          className="progress-fill"
          style={{ width: `${uiStepInfo.progressPercent}%` }}
        />
      </div>
      <select
        value={playbackSpeed}
        onChange={(e) => onSpeedChange(Number(e.target.value))}
      >
        <option value={0.5}>0.5x</option>
        <option value={1}>1x</option>
        <option value={2}>2x</option>
      </select>
    </div>
  );
}
