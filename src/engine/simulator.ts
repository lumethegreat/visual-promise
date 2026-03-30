import type { SimulationResult } from './types';
import { EXPECTED, type DatasetCaseId } from './dataset/expected';
import { simulateCaseP1 } from './p1';

/**
 * simulateCase() — API principal para a UI.
 *
 * A partir de P1, por defeito usamos o motor real (P1) para gerar a timeline.
 * Mantemos as fixtures (EXPECTED) como fallback e como referência estável.
 */
export function simulateCase(caseId: DatasetCaseId): SimulationResult {
  const steps = simulateCaseP1(caseId);
  return {
    steps: steps.map((s) => ({
      ...s,
      callStack: [...s.callStack],
      microtaskQueue: [...s.microtaskQueue],
    })),
  };
}

/**
 * simulateCaseFixtures() — devolve as timelines hardcoded do dataset.
 * Útil para debugging/regressão.
 */
export function simulateCaseFixtures(caseId: DatasetCaseId): SimulationResult {
  const steps = EXPECTED[caseId];
  return {
    steps: steps.map((s) => ({
      ...s,
      callStack: [...s.callStack],
      microtaskQueue: [...s.microtaskQueue],
    })),
  };
}
