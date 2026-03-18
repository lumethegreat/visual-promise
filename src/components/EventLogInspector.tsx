import { useState } from "react";
import type { VPPEvent } from "../../docs/event-schema";

interface EventLogInspectorProps {
  eventLog: readonly VPPEvent[];
}

export function EventLogInspector({ eventLog }: EventLogInspectorProps) {
  const [collapsed, setCollapsed] = useState(true);

  if (eventLog.length === 0) return null;

  return (
    <div className="panel event-log-inspector">
      <button
        className="event-log-toggle"
        onClick={() => setCollapsed((c) => !c)}
      >
        {collapsed ? "▶" : "▼"} Event Log ({eventLog.length})
      </button>
      {!collapsed && (
        <ul className="event-log-list">
          {eventLog.map((evt, i) => (
            <li key={evt.seq} className="event-log-entry">
              <span className="event-index">#{i + 1}</span>
              <span className="event-type">{evt.type}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
