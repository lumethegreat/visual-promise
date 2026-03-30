import { describe, expect, it } from 'vitest';
import { simulateProgram } from '../../engine';
import type { TimelineStep } from '../../../types';
import { PATTERN_H2_FINALLY_THROWS } from '../pattern-h2-finally-throws';

function s(
  step: number,
  callStack: string[],
  microtaskQueue: string[],
  event: string,
  output?: string
): TimelineStep {
  return { step, callStack, microtaskQueue, event, output };
}

describe('P1 patterns — H2 (finally throws -> catch)', () => {
  it('se finally lançar, o then é saltado e o catch corre', () => {
    const steps = simulateProgram(PATTERN_H2_FINALLY_THROWS);

    const expected: TimelineStep[] = [
      s(0, [], [], 'Promise.resolve("x").finally(...)\n→ agenda reaction(finally1)'),
      s(1, [], ['reaction(finally1)'], 'anexar .then(...)\n→ fica pendente da promise derivada'),
      s(2, [], ['reaction(finally1)'], 'anexar .catch(...)\n→ fica pendente da promise derivada'),
      s(3, [], ['reaction(finally1)'], 'dequeue microtask'),
      s(
        4,
        ['finally1'],
        [],
        'throw new Error("boom")\n→ reject promise derivada\n→ agenda reaction(catch1)'
      ),
      s(5, [], ['reaction(catch1)'], 'dequeue microtask'),
      s(6, ['catch1'], [], 'console.log("caught")', 'caught'),
      s(7, [], [], 'fim'),
    ];

    expect(steps).toEqual(expected);
  });
});
