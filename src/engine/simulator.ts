import type { SimulationResult } from './types';
import { EXPECTED, type DatasetCaseId } from './dataset/expected';

/**
 * Fase 1 (MVP): devolve a timeline EXACTA do dataset por `caseId`.
 *
 * Nota: ainda não é um motor geral. O objectivo aqui é:
 * - estabilizar o formato da timeline
 * - ter testes 100% determinísticos
 * - permitir construir UI e refactor posterior para um motor real
 */
export function simulateCase(caseId: DatasetCaseId): SimulationResult {
  const steps = EXPECTED[caseId];
  // devolvemos cópia defensiva (evita mutações acidentais pela UI)
  return { steps: steps.map((s) => ({ ...s, callStack: [...s.callStack], microtaskQueue: [...s.microtaskQueue] })) };
}
