import { useEffect, useMemo, useState } from 'react';
import type { TimelineStep } from '../engine/types';

export function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

export function usePlayback(opts: {
  playing: boolean;
  speedMs: number;
  canStepForward: boolean;
  onStepForward: () => void;
}) {
  const { playing, speedMs, canStepForward, onStepForward } = opts;

  useEffect(() => {
    if (!playing) return;
    if (!canStepForward) return;

    const handle = window.setInterval(() => {
      onStepForward();
    }, speedMs);

    return () => {
      window.clearInterval(handle);
    };
  }, [playing, speedMs, canStepForward, onStepForward]);
}

export function StepsScrubber(props: {
  stepIndex: number;
  setStepIndex: (n: number) => void;
  maxIndex: number;
}) {
  const { stepIndex, setStepIndex, maxIndex } = props;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
      <div style={{ fontFamily: 'ui-monospace, Menlo, Monaco, monospace' }}>
        T{stepIndex} / T{maxIndex}
      </div>
      <input
        type="range"
        min={0}
        max={maxIndex}
        value={stepIndex}
        onChange={(e) => setStepIndex(Number(e.target.value))}
        style={{ width: 420, maxWidth: '100%' }}
      />
    </div>
  );
}

export function CallStackView(props: { step: TimelineStep }) {
  const frames = props.step.callStack;
  return (
    <div>
      <div style={{ fontWeight: 700, marginBottom: 8 }}>Call Stack</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {frames.length === 0 ? (
          <div style={{ opacity: 0.7 }}>(vazia)</div>
        ) : (
          frames.map((f, idx) => (
            <div
              key={`${f}-${idx}`}
              style={{
                border: '2px solid #1e1e1e',
                borderRadius: 10,
                padding: '6px 10px',
                background: '#fff',
                fontFamily: 'ui-monospace, Menlo, Monaco, monospace',
                fontSize: 13,
              }}
            >
              {f}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

export function MicrotaskQueueView(props: { step: TimelineStep }) {
  const q = props.step.microtaskQueue;
  return (
    <div>
      <div style={{ fontWeight: 700, marginBottom: 8 }}>Microtask Queue (FIFO)</div>
      {q.length === 0 ? (
        <div style={{ opacity: 0.7 }}>(vazia)</div>
      ) : (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          {q.map((item, idx) => (
            <div key={`${item}-${idx}`} style={{
              border: '2px solid #1e1e1e',
              borderRadius: 999,
              padding: '6px 10px',
              background: '#fff',
              fontFamily: 'ui-monospace, Menlo, Monaco, monospace',
              fontSize: 13,
            }}>
              {item}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function EventLogView(props: {
  steps: TimelineStep[];
  stepIndex: number;
}) {
  const { steps, stepIndex } = props;

  const current = steps[stepIndex];
  const prev = useMemo(() => {
    const out: TimelineStep[] = [];
    for (let i = stepIndex - 1; i >= 0 && out.length < 5; i--) out.push(steps[i]);
    return out;
  }, [steps, stepIndex]);

  if (!current) return null;

  return (
    <div>
      <div style={{ fontWeight: 700, marginBottom: 8 }}>Event Log</div>

      <div style={{
        border: '2px solid #1e1e1e',
        borderRadius: 12,
        background: '#fff3bf',
        padding: 10,
        marginBottom: 10,
      }}>
        <div style={{ fontWeight: 700, marginBottom: 6 }}>Current event (T{stepIndex})</div>
        <div style={{
          fontFamily: 'ui-monospace, Menlo, Monaco, monospace',
          fontSize: 13,
          whiteSpace: 'pre-wrap',
        }}>
          {current.event}
        </div>
      </div>

      <div style={{
        border: '2px solid #1e1e1e',
        borderRadius: 12,
        background: '#fff',
        padding: 10,
        maxHeight: 140,
        overflow: 'auto',
      }}>
        <div style={{ fontWeight: 700, marginBottom: 6 }}>Last 5 events</div>
        {prev.length === 0 ? (
          <div style={{ opacity: 0.7 }}>(nenhum)</div>
        ) : (
          <ol style={{ margin: 0, paddingLeft: 18 }}>
            {prev.map((s) => (
              <li key={s.step} style={{ marginBottom: 6 }}>
                <span style={{ opacity: 0.7, marginRight: 6 }}>T{s.step}:</span>
                <span style={{
                  fontFamily: 'ui-monospace, Menlo, Monaco, monospace',
                  fontSize: 13,
                  whiteSpace: 'pre-wrap',
                }}>
                  {s.event}
                </span>
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}

export function ConsoleView(props: {
  steps: TimelineStep[];
  stepIndex: number;
}) {
  const { steps, stepIndex } = props;

  const outputs = useMemo(() => {
    const out: string[] = [];
    for (let i = 0; i <= stepIndex; i++) {
      const s = steps[i];
      if (!s) continue;
      if (typeof s.output === 'string' && s.output.length > 0) out.push(s.output);
    }
    return out;
  }, [steps, stepIndex]);

  return (
    <div>
      <div style={{ fontWeight: 700, marginBottom: 8 }}>Console</div>
      <div style={{
        border: '2px solid #1e1e1e',
        borderRadius: 12,
        background: '#fff',
        padding: 10,
        minHeight: 80,
        fontFamily: 'ui-monospace, Menlo, Monaco, monospace',
        fontSize: 13,
        whiteSpace: 'pre-wrap',
      }}>
        {outputs.length === 0 ? '(sem output)' : outputs.map((l, i) => `> ${l}${i === outputs.length - 1 ? '' : '\n'}`)}
      </div>
    </div>
  );
}

export function useUiState(maxIndex: number) {
  const [playing, setPlaying] = useState(false);
  const [speedMs, setSpeedMs] = useState(600);
  const [stepIndex, setStepIndexRaw] = useState(0);

  const setStepIndex = (n: number) => setStepIndexRaw(clamp(n, 0, maxIndex));

  // auto-stop at end
  useEffect(() => {
    if (stepIndex >= maxIndex) setPlaying(false);
  }, [stepIndex, maxIndex]);

  return {
    playing,
    setPlaying,
    speedMs,
    setSpeedMs,
    stepIndex,
    setStepIndex,
  };
}
