import type { SimulationResult } from '../types';
import { simulateCase } from '../simulator';
import type { DatasetCaseId } from '../dataset/expected';
import { identifyDatasetCase } from '../../parser/identify-dataset-case';
import { toP1ProgramFromCode } from '../../parser/p2/to-program';
import { simulateProgram } from '../p1/engine';

export type SimulateResult =
  | ({ ok: true; mode: 'dataset'; caseId: DatasetCaseId } & SimulationResult)
  | ({ ok: true; mode: 'subset' } & SimulationResult)
  | { ok: false; reason: string };

/**
 * simulate(code)
 *
 * - Primeiro tenta modo dataset (P2.1) para garantir exactidão dos 6 casos.
 * - Se não reconhecer, tenta subset P2.2 (Promise chains) e gera Program -> P1 engine.
 */
export function simulate(code: string): SimulateResult {
  const id = identifyDatasetCase(code);
  if (id.ok) {
    const res = simulateCase(id.caseId);
    return { ok: true, mode: 'dataset', caseId: id.caseId, steps: res.steps };
  }

  try {
    const program = toP1ProgramFromCode(code);
    const steps = simulateProgram(program);
    return { ok: true, mode: 'subset', steps };
  } catch (e) {
    return {
      ok: false,
      reason: (e instanceof Error ? e.message : String(e)) || 'Erro desconhecido',
    };
  }
}
