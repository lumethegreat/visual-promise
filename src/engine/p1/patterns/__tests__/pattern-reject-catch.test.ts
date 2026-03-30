import { describe, expect, it } from 'vitest';
import { simulateProgram } from '../../engine';
import type { TimelineStep } from '../../../types';
import { PATTERN_REJECT_THEN_CATCH } from '../pattern-reject-catch';

function s(
  step: number,
  callStack: string[],
  microtaskQueue: string[],
  event: string,
  output?: string
): TimelineStep {
  return { step, callStack, microtaskQueue, event, output };
}

describe('P1 patterns — Promise.reject().then().catch()', () => {
  it('then é ignorado (passthrough) e catch corre', () => {
    const steps = simulateProgram(PATTERN_REJECT_THEN_CATCH);

    const expected: TimelineStep[] = [
      s(0, [], [], 'Promise.reject().then(...)\n→ agenda reaction(then1) (rejected)'),
      s(1, [], ['reaction(then1)'], 'anexar .catch(...)\n→ fica pendente da promise derivada'),
      s(2, [], ['reaction(then1)'], 'dequeue microtask'),
      s(3, [], [], 'reaction(then1) (no handler)\n→ propagate rejected'),
      s(4, [], ['reaction(catch1)'], 'dequeue microtask'),
      s(5, ['catch1'], [], 'console.log("B")', 'B'),
      s(6, [], [], 'fim'),
    ];

    expect(steps).toEqual(expected);
  });
});
