import type { SimulationResult } from '../types';
import type { DatasetCaseId } from '../dataset/expected';
import { simulateCase } from '../simulator';
import { identifyDatasetCase } from '../../parser/identify-dataset-case';

export type SimulateFromCodeResult =
  | ({ ok: true; caseId: DatasetCaseId } & SimulationResult)
  | { ok: false; reason: string };

/**
 * P2.1 (dataset-first): tenta identificar qual dos 6 casos o utilizador escreveu.
 *
 * Se identificar, devolve a timeline via `simulateCase(caseId)`.
 */
export function simulateFromCode(code: string): SimulateFromCodeResult {
  const r = identifyDatasetCase(code);
  if (!r.ok) return r;
  const res = simulateCase(r.caseId);
  return { ok: true, caseId: r.caseId, steps: res.steps };
}
