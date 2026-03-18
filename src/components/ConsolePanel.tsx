import { useEffect, useRef } from "react";
import type { ConsoleEntry } from "../../docs/replay-state";

interface ConsolePanelProps {
  entries: readonly ConsoleEntry[];
}

export function ConsolePanel({ entries }: ConsolePanelProps) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [entries]);

  return (
    <div className="panel console-panel">
      <h3>Console</h3>
      {entries.length === 0 ? (
        <p className="empty">No console output yet</p>
      ) : (
        <div className="console-entries">
          {entries.map((entry) => (
            <div
              key={entry.seq}
              className={`console-entry console-entry-${entry.method}`}
            >
              <span className="console-method">[{entry.method}]</span>{" "}
              {entry.args.map((arg, i) => (
                <span key={i}>{String(arg)}{i < entry.args.length - 1 ? " " : ""}</span>
              ))}
            </div>
          ))}
          <div ref={bottomRef} />
        </div>
      )}
    </div>
  );
}
