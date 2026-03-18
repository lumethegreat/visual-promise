import { useState } from "react";
import { useExecution } from "./hooks/useExecution";
import { Editor } from "./components/Editor";
import { StepControls } from "./components/StepControls";
import { CallStackPanel } from "./components/CallStackPanel";
import { MicrotaskQueuePanel } from "./components/MicrotaskQueuePanel";
import { ConsolePanel } from "./components/ConsolePanel";
import { CapabilityBanner } from "./components/CapabilityBanner";
import { EventLogInspector } from "./components/EventLogInspector";

const DEFAULT_CODE = `async function example() {
  console.log("start");
  const result = await Promise.resolve(42);
  console.log(result);
  return result;
}

example();`;

export default function App() {
  const {
    status,
    validationResult,
    eventLog,
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
  } = useExecution();

  const [code, setCode] = useState(DEFAULT_CODE);
  const [activeTab, setActiveTab] = useState<"stack" | "queue" | "console">(
    "stack",
  );

  const handleRun = () => {
    execute(code);
  };

  const handleReset = () => {
    reset();
    setCode(DEFAULT_CODE);
  };

  const validationLevel = validationResult?.level ?? "ok";
  const executionFailed = replayState.executionFailed;
  const errorMessage =
    showErrorBanner && executionError
      ? executionError.message
      : executionFailed && uiStepInfo.currentEvent?.type === "error.throw"
        ? (uiStepInfo.currentEvent as { data?: { message?: string } }).data?.message ?? "Execution failed"
        : null;

  return (
    <div className="app">
      {/* Header */}
      <header className="app-header">
        <h1>✨ Visual Promise</h1>
        <StepControls
          uiStepInfo={uiStepInfo}
          isPlaying={isPlaying}
          playbackSpeed={playbackSpeed}
          onStepForward={stepForward}
          onStepBack={stepBack}
          onStepToEnd={stepToEnd}
          onPlay={play}
          onPause={pause}
          onSpeedChange={setPlaybackSpeed}
        />
        <div className="run-actions">
          <button
            className="btn-run"
            onClick={handleRun}
            disabled={status === "running" || status === "validating"}
          >
            ▶ Run
          </button>
          <button className="btn-reset" onClick={handleReset}>
            ↺ Reset
          </button>
        </div>
      </header>

      {/* Capability Banner */}
      {validationLevel !== "ok" && (
        <CapabilityBanner
          level={validationLevel}
          message={validationResult?.messages.map((m) => m.message).join("; ")}
        />
      )}

      {/* Execution Error Banner */}
      {errorMessage && (
        <div className="banner banner-error">
          <span>⚠ Error: {errorMessage}</span>
        </div>
      )}

      {/* Main layout */}
      <div className="app-body">
        {/* Editor */}
        <div className="editor-pane">
          <Editor code={code} onChange={setCode} />
        </div>

        {/* Right panel */}
        <div className="inspector-pane">
          {/* Tab bar */}
          <div className="tab-bar">
            <button
              className={`tab ${activeTab === "stack" ? "active" : ""}`}
              onClick={() => setActiveTab("stack")}
            >
              Stack
            </button>
            <button
              className={`tab ${activeTab === "queue" ? "active" : ""}`}
              onClick={() => setActiveTab("queue")}
            >
              Queue
            </button>
            <button
              className={`tab ${activeTab === "console" ? "active" : ""}`}
              onClick={() => setActiveTab("console")}
            >
              Console
            </button>
          </div>

          {/* Tab content */}
          <div className="tab-content">
            {activeTab === "stack" && (
              <CallStackPanel frameStack={replayState.frameStack} />
            )}
            {activeTab === "queue" && (
              <MicrotaskQueuePanel
                microtaskQueue={replayState.microtaskQueue}
                reactions={replayState.reactions}
              />
            )}
            {activeTab === "console" && (
              <ConsolePanel entries={replayState.consoleEntries} />
            )}
          </div>

          {/* Promise overview */}
          {replayState.promises.size > 0 && (
            <div className="promise-overview">
              <h4>Promises ({replayState.promises.size})</h4>
              <ul>
                {[...replayState.promises.values()].map((p) => (
                  <li
                    key={p.promiseId}
                    className={`promise promise-${p.state}`}
                  >
                    <span className="promise-id">
                      {p.promiseId.slice(0, 8)}
                    </span>
                    <span className="promise-state">{p.state}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>

      {/* Event log (collapsible, for debugging) */}
      <EventLogInspector eventLog={eventLog} />
    </div>
  );
}
