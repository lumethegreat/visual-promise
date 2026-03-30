import type { TimelineStep } from '../types';

export type DatasetCaseId = 1 | 2 | 3 | 4 | 5 | 6;

function s(
  step: number,
  callStack: string[],
  microtaskQueue: string[],
  event: string,
  output?: string
): TimelineStep {
  return { step, callStack, microtaskQueue, event, output };
}

export const EXPECTED: Record<DatasetCaseId, TimelineStep[]> = {
  1: [
    s(0, [], [], 'chamar example()'),
    s(1, ['example'], [], 'console.log("start")', 'start'),
    s(
      2,
      ['example'],
      [],
      'await Promise.resolve(42)\n→ suspende função\n→ agenda continuação'
    ),
    s(3, [], ['resume(example)'], 'dequeue microtask'),
    s(4, ['example'], [], 'retoma após await\nconsole.log(42)', '42'),
    s(5, [], [], 'return 42\n→ resolve promise')
  ],

  2: [
    s(0, [], [], 'chamar example()'),
    s(
      1,
      ['example'],
      [],
      'await Promise.resolve()\n→ suspende função\n→ agenda continuação'
    ),
    s(
      2,
      [],
      ['resume(example)'],
      'Promise.resolve().then(...)\n→ agenda reaction(B)'
    ),
    s(3, [], ['resume(example)', 'reaction(B)'], 'dequeue microtask'),
    s(
      4,
      ['example'],
      ['reaction(B)'],
      'retoma após await\nconsole.log("A")',
      'A'
    ),
    s(5, [], ['reaction(B)'], 'dequeue microtask'),
    s(6, ['then callback'], [], 'console.log("B")', 'B'),
    s(7, [], [], 'fim')
  ],

  3: [
    s(
      0,
      [],
      [],
      'Promise.resolve().then(...)\n→ agenda reaction(then1)'
    ),
    s(
      1,
      [],
      ['reaction(then1)'],
      'anexar segundo .then\n→ fica pendente da promise derivada'
    ),
    s(2, [], ['reaction(then1)'], 'dequeue microtask'),
    s(3, ['then1'], [], 'console.log("A")', 'A'),
    s(
      4,
      [],
      [],
      'then1 termina\n→ resolve promise derivada\n→ agenda reaction(then2)'
    ),
    s(5, [], ['reaction(then2)'], 'dequeue microtask'),
    s(6, ['then2'], [], 'console.log("B")', 'B'),
    s(7, [], [], 'fim')
  ],

  4: [
    s(
      0,
      [],
      [],
      'Promise.resolve().then(...)\n→ agenda reaction(asyncThen1)'
    ),
    s(
      1,
      [],
      ['reaction(asyncThen1)'],
      'anexar segundo .then\n→ fica pendente da promise derivada'
    ),
    s(2, [], ['reaction(asyncThen1)'], 'dequeue microtask'),
    s(3, ['asyncThen1'], [], 'console.log("A")', 'A'),
    s(
      4,
      [],
      [],
      'asyncThen1 termina\n→ devolve Promise fulfilled\n→ agenda resolve-derived'
    ),
    s(5, [], ['resolve-derived'], 'dequeue microtask'),
    s(
      6,
      ['resolve-derived'],
      [],
      'resolve promise derivada\n→ agenda reaction(then2)'
    ),
    s(7, [], ['reaction(then2)'], 'dequeue microtask'),
    s(8, ['then2'], [], 'console.log("B")', 'B'),
    s(9, [], [], 'fim')
  ],

  5: [
    s(0, [], [], 'chamar f()'),
    s(1, ['f'], [], 'console.log("A")', 'A'),
    s(
      2,
      ['f'],
      [],
      'await Promise.resolve()\n→ suspende função\n→ agenda resume#1'
    ),
    s(3, [], ['resume#1'], 'dequeue microtask'),
    s(4, ['f'], [], 'retoma após await\nconsole.log("B")', 'B'),
    s(
      5,
      ['f'],
      [],
      'await Promise.resolve()\n→ suspende função\n→ agenda resume#2'
    ),
    s(6, [], ['resume#2'], 'dequeue microtask'),
    s(7, ['f'], [], 'retoma após await\nconsole.log("C")', 'C'),
    s(8, [], [], 'fim')
  ],

  6: [
    s(
      0,
      [],
      [],
      'Promise.resolve().then(...)\n→ agenda reaction(then1)'
    ),
    s(1, [], ['reaction(then1)'], 'dequeue microtask'),
    s(2, ['then1'], [], 'chamar inner()'),
    s(
      3,
      ['then1', 'inner'],
      [],
      'await Promise.resolve()\n→ suspende inner\n→ agenda resume(inner)'
    ),
    s(
      4,
      [],
      ['resume(inner)', 'resolve-derived'],
      'then1 termina\n→ devolve Promise fulfilled'
    ),
    s(5, [], ['resume(inner)', 'resolve-derived'], 'dequeue microtask'),
    s(
      6,
      ['inner'],
      ['resolve-derived'],
      'retoma após await\nconsole.log("X")',
      'X'
    ),
    s(7, [], ['resolve-derived'], 'dequeue microtask'),
    s(
      8,
      ['resolve-derived'],
      [],
      'resolve promise derivada\n→ agenda reaction(then2)'
    ),
    s(9, [], ['reaction(then2)'], 'dequeue microtask'),
    s(10, ['then2'], [], 'console.log("Y")', 'Y'),
    s(11, [], [], 'fim')
  ]
};
