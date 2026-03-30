import { simulateProgram } from './engine';
import { PROGRAMS } from './programs';
import type { TimelineStep } from '../types';

export function simulateCaseP1(caseId: 1 | 2 | 3 | 4 | 5 | 6): TimelineStep[] {
  return simulateProgram(PROGRAMS[caseId]);
}
