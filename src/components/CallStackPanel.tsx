import type { ExecutionFrame } from "../../docs/replay-state";

interface CallStackPanelProps {
  frameStack: readonly ExecutionFrame[];
}

export function CallStackPanel({ frameStack }: CallStackPanelProps) {
  return (
    <div className="panel call-stack-panel">
      <h3>Call Stack</h3>
      {frameStack.length === 0 ? (
        <p className="empty">No frames</p>
      ) : (
        <ul>
          {[...frameStack].reverse().map((frame) => (
            <li
              key={frame.frameId}
              className={`frame frame-${frame.status}`}
              aria-label={`${frame.name} — ${frame.status} at L${frame.startLine}:${frame.startColumn}`}
            >
              <span className="frame-name">{frame.name}{"\u00A0"}</span>
              <span className="frame-badge">{frame.status}</span>
              <span className="frame-location">
                L{frame.startLine}:{frame.startColumn}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
