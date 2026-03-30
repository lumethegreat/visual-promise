import { describe, expect, it } from 'vitest';
import { simulateProgram } from '../../engine';
import type { TimelineStep } from '../../../types';
import { PATTERN_H } from '../pattern-h';

function s(
  step: number,
  callStack: string[],
  microtaskQueue: string[],
  event: string,
  output?: string
): TimelineStep {
  return { step, callStack, microtaskQueue, event, output };
}

describe('P1 patterns — H (finally)', () => {
  it('finally corre antes do then seguinte', () => {
    const steps = simulateProgram(PATTERN_H);

    const expected: TimelineStep[] = [
      s(0, [], [], 'Promise.resolve("x").finally(...)\n→ agenda reaction(finally1)'),
      s(1, [], ['reaction(finally1)'], 'anexar .then(...)\n→ fica pendente da promise derivada'),
      s(2, [], ['reaction(finally1)'], 'dequeue microtask'),
      s(3, ['finally1'], [], 'console.log("F")', 'F'),
      s(4, [], [], 'finally1 termina'),
      s(5, [], ['reaction(then1)'], 'dequeue microtask'),
      s(6, ['then1'], [], 'console.log("x")', 'x'),
      s(7, [], [], 'fim'),
    ];

    expect(steps).toEqual(expected);
  });
});
