import { useCallback, useState } from 'react';
import type { TimelineStep } from '../engine/types';
import { simulate } from '../engine/from-code/simulate';

/**
 * useSimulator — bridge entre a UI e o motor de simulação P2.
 *
 * Aceita código JS arbitrário (subset P2), corre-o através do parser → engine,
 * e devolve a timeline de passos para apresentação na UI.
 *
 * @param onSteps — callback chamado com os passos quando a simulação termina.
 *                  Recebe `null` quando há erro de parse/execução.
 */
export function useSimulator(onSteps?: (steps: TimelineStep[] | null) => void) {
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(
    (code: string): TimelineStep[] | null => {
      setRunning(true);
      setError(null);

      const result = simulate(code);

      if (!result.ok) {
        const msg = result.reason ?? 'Unknown error';
        setError(msg);
        setRunning(false);
        onSteps?.(null);
        return null;
      }

      setRunning(false);
      onSteps?.(result.steps);
      return result.steps;
    },
    [onSteps]
  );

  return { run, running, error };
}
