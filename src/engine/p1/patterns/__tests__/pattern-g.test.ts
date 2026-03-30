import { describe, expect, it } from 'vitest';
import { simulateProgram } from '../../engine';
import type { TimelineStep } from '../../../types';
import { PATTERN_G } from '../pattern-g';

function s(
  step: number,
  callStack: string[],
  microtaskQueue: string[],
  event: string,
  output?: string
): TimelineStep {
  return { step, callStack, microtaskQueue, event, output };
}

describe('P1 patterns — G (throw -> catch)', () => {
  it('deve executar catch depois do throw', () => {
    const steps = simulateProgram(PATTERN_G);

    const expected: TimelineStep[] = [
      s(0, [], [], 'Promise.resolve().then(...)\n→ agenda reaction(then1)'),
      s(1, [], ['reaction(then1)'], 'anexar .catch(...)\n→ fica pendente da promise derivada'),
      s(2, [], ['reaction(then1)'], 'dequeue microtask'),
      s(
        3,
        ['then1'],
        [],
        'throw new Error("boom")\n→ reject promise derivada\n→ agenda reaction(catch1)'
      ),
      s(4, [], ['reaction(catch1)'], 'dequeue microtask'),
      s(5, ['catch1'], [], 'console.log("caught")', 'caught'),
      s(6, [], [], 'fim'),
    ];

    expect(steps).toEqual(expected);
  });
});
