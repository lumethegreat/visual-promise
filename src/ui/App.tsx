import { useCallback, useMemo, useState } from 'react';
import { simulateCase } from '../engine/simulator';
import type { DatasetCaseId } from '../engine/dataset/expected';
import { SNIPPETS } from '../engine/dataset/snippets';
import { styles } from './styles';
import {
  CallStackView,
  ConsoleView,
  EventLogView,
  MicrotaskQueueView,
  StepsScrubber,
  usePlayback,
  useUiState,
} from './components';

const CASES: Array<{ id: DatasetCaseId; label: string }> = [
  { id: 1, label: 'Caso 1 — async/await basic' },
  { id: 2, label: 'Caso 2 — await vs then' },
  { id: 3, label: 'Caso 3 — then chain síncrona' },
  { id: 4, label: 'Caso 4 — then handler async' },
  { id: 5, label: 'Caso 5 — múltiplos awaits' },
  { id: 6, label: 'Caso 6 — inner async sem await externo' },
];

export function App() {
  const [caseId, setCaseId] = useState<DatasetCaseId>(1);

  const steps = useMemo(() => simulateCase(caseId).steps, [caseId]);
  const maxIndex = Math.max(0, steps.length - 1);

  const ui = useUiState(maxIndex);

  const canBack = ui.stepIndex > 0;
  const canForward = ui.stepIndex < maxIndex;

  const stepForward = useCallback(() => {
    ui.setStepIndex(ui.stepIndex + 1);
  }, [ui]);

  usePlayback({
    playing: ui.playing,
    speedMs: ui.speedMs,
    canStepForward: canForward,
    onStepForward: stepForward,
  });

  const step = steps[ui.stepIndex];

  return (
    <div style={styles.page}>
      <div style={styles.header}>
        <div style={styles.headerLeft}>
          <div style={{ fontWeight: 800, fontSize: 18 }}>visual-promise</div>

          <button
            onClick={() => {
              ui.setPlaying(false);
              ui.setStepIndex(0);
            }}
          >
            Reset
          </button>

          <button onClick={() => ui.setPlaying((p) => !p)} disabled={!canForward && !ui.playing}>
            {ui.playing ? 'Pause' : 'Play'}
          </button>

          <button onClick={() => ui.setStepIndex(ui.stepIndex + 1)} disabled={!canForward}>
            Step
          </button>

          <button onClick={() => ui.setStepIndex(ui.stepIndex - 1)} disabled={!canBack}>
            Back
          </button>

          <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontWeight: 700 }}>Speed</span>
            <input
              type="range"
              min={120}
              max={1500}
              step={20}
              value={ui.speedMs}
              onChange={(e) => ui.setSpeedMs(Number(e.target.value))}
            />
            <span style={{ fontFamily: 'ui-monospace, Menlo, Monaco, monospace' }}>{ui.speedMs}ms</span>
          </label>
        </div>

        <div style={styles.headerRight}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontWeight: 700 }}>Example</span>
            <select
              value={caseId}
              onChange={(e) => {
                ui.setPlaying(false);
                ui.setStepIndex(0);
                setCaseId(Number(e.target.value) as DatasetCaseId);
              }}
            >
              {CASES.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </select>
          </label>

          <div style={{ opacity: 0.8, fontSize: 13 }}>
            Timeline: {steps.length} steps
          </div>
        </div>
      </div>

      <div style={styles.grid}>
        <div style={styles.leftCol}>
          <div style={{ ...styles.panel, background: '#fff' }}>
            <div style={{ fontWeight: 700, marginBottom: 8 }}>Code (por agora read-only)</div>
            <div style={styles.monoBox}>{SNIPPETS[caseId]}</div>
          </div>

          <div style={{ ...styles.panel, background: '#fff' }}>
            <div style={{ fontWeight: 700, marginBottom: 8 }}>Step snapshot</div>
            <div style={styles.monoBox}>
              {step
                ? `T${step.step}\nCall Stack: [ ${step.callStack.join(', ')} ]\nMicrotask Queue: [ ${step.microtaskQueue.join(', ')} ]\n\nEvent:\n${step.event}`
                : '(sem step)'}
            </div>
          </div>
        </div>

        <div style={styles.rightCol}>
          <div style={styles.panel}>{step ? <CallStackView step={step} /> : null}</div>
          <div style={styles.panel}>{step ? <MicrotaskQueueView step={step} /> : null}</div>
          <div style={styles.panel}>
            <EventLogView steps={steps} stepIndex={ui.stepIndex} />
          </div>
          <div style={styles.panel}>
            <ConsoleView steps={steps} stepIndex={ui.stepIndex} />
          </div>
        </div>
      </div>

      <div style={styles.bottom}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
          <StepsScrubber stepIndex={ui.stepIndex} setStepIndex={ui.setStepIndex} maxIndex={maxIndex} />

          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button onClick={() => ui.setStepIndex(0)} disabled={ui.stepIndex === 0}>
              To start
            </button>
            <button onClick={() => ui.setStepIndex(maxIndex)} disabled={ui.stepIndex === maxIndex}>
              To end
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
