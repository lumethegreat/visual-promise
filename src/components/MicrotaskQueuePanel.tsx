import type {
  MicrotaskQueue,
  ReactionRecord,
} from "../../docs/replay-state";

interface MicrotaskQueuePanelProps {
  microtaskQueue: MicrotaskQueue;
  reactions: ReadonlyMap<string, ReactionRecord>;
}

interface MicrotaskQueuePanelProps {
  microtaskQueue: MicrotaskQueue;
  // reactions map available for future enrichment (e.g. promiseId lookup)
  reactions: ReadonlyMap<string, ReactionRecord>;
}

export function MicrotaskQueuePanel({
  microtaskQueue,
  reactions: _reactions,
}: MicrotaskQueuePanelProps) {
  return (
    <div className="panel microtask-panel">
      <h3>Microtask Queue</h3>
      {microtaskQueue.entries.length === 0 ? (
        <p className="empty">
          Microtask queue is empty — all tasks completed ✓
        </p>
      ) : (
        <ul>
          {microtaskQueue.entries.map((entry) => (
            <li key={entry.reactionId} className="microtask">
              <span className="microtask-label">{entry.label}</span>
              <span className="queue-position">#{entry.position + 1}</span>
            </li>
          ))}
        </ul>
      )}
      <div className="total-count">
        Total enqueued: {microtaskQueue.totalEnqueued}
      </div>
    </div>
  );
}
