import type { EnqueueSpec, Program } from './types';

const reaction = (
  label: string,
  trigger: 'fulfilled' | 'rejected',
  handlers: { onFulfilledHandler?: string; onRejectedHandler?: string },
  onFulfilled: EnqueueSpec[] = [],
  onRejected: EnqueueSpec[] = []
): EnqueueSpec => ({
  kind: 'reaction',
  label,
  trigger,
  onFulfilledHandler: handlers.onFulfilledHandler,
  onRejectedHandler: handlers.onRejectedHandler,
  onFulfilled,
  onRejected,
});

const resolveDerived = (label: string, eventText: string, onRunEnqueue: EnqueueSpec[]): EnqueueSpec => ({
  kind: 'resolveDerived',
  label,
  eventText,
  onRunEnqueue,
});

/**
 * Programas P1: modelo executável para os 6 casos do dataset.
 */
export const PROGRAMS: Record<1 | 2 | 3 | 4 | 5 | 6, Program> = {
  1: {
    topLevel: [{ kind: 'callAsync', text: 'chamar example()', fn: 'example' }],
    functions: {
      example: {
        label: 'example',
        body: [
          { kind: 'log', text: 'console.log("start")', output: 'start' },
          {
            kind: 'awaitResolved',
            text: 'await Promise.resolve(42)\n→ suspende função\n→ agenda continuação',
            resumeLabel: 'resume(example)',
          },
          { kind: 'log', text: 'console.log(42)', output: '42' },
          { kind: 'end', text: 'return 42\n→ resolve promise' },
        ],
      },
    },
  },

  2: {
    topLevel: [
      { kind: 'callAsync', text: 'chamar example()', fn: 'example' },
      {
        kind: 'promiseThenStart',
        text: 'Promise.resolve().then(...)\n→ agenda reaction(B)',
        enqueue: reaction('reaction(B)', 'fulfilled', { onFulfilledHandler: 'then callback' }),
      },
    ],
    functions: {
      example: {
        label: 'example',
        body: [
          {
            kind: 'awaitResolved',
            text: 'await Promise.resolve()\n→ suspende função\n→ agenda continuação',
            resumeLabel: 'resume(example)',
          },
          { kind: 'log', text: 'console.log("A")', output: 'A' },
          // No dataset não existe step separado para o fim do example().
          { kind: 'end', text: 'fim', suppressSnapshot: true },
        ],
      },
      'then callback': {
        label: 'then callback',
        body: [{ kind: 'log', text: 'console.log("B")', output: 'B' }, { kind: 'end', text: 'fim' }],
      },
    },
  },

  3: {
    topLevel: [
      {
        kind: 'promiseThenStart',
        text: 'Promise.resolve().then(...)\n→ agenda reaction(then1)',
        enqueue: reaction('reaction(then1)', 'fulfilled', { onFulfilledHandler: 'then1' }, [reaction('reaction(then2)', 'fulfilled', { onFulfilledHandler: 'then2' })]),
      },
      {
        kind: 'attachThen',
        text: 'anexar segundo .then\n→ fica pendente da promise derivada',
      },
    ],
    functions: {
      then1: {
        label: 'then1',
        body: [
          { kind: 'log', text: 'console.log("A")', output: 'A' },
          {
            kind: 'end',
            text: 'then1 termina\n→ resolve promise derivada\n→ agenda reaction(then2)',
          },
        ],
      },
      then2: {
        label: 'then2',
        body: [{ kind: 'log', text: 'console.log("B")', output: 'B' }, { kind: 'end', text: 'fim' }],
      },
    },
  },

  4: {
    topLevel: [
      {
        kind: 'promiseThenStart',
        text: 'Promise.resolve().then(...)\n→ agenda reaction(asyncThen1)',
        enqueue: reaction(
          'reaction(asyncThen1)',
          'fulfilled',
          { onFulfilledHandler: 'asyncThen1' },
          [
            resolveDerived(
              'resolve-derived',
              'resolve promise derivada\n→ agenda reaction(then2)',
              [reaction('reaction(then2)', 'fulfilled', { onFulfilledHandler: 'then2' })]
            ),
          ]
        ),
      },
      {
        kind: 'attachThen',
        text: 'anexar segundo .then\n→ fica pendente da promise derivada',
      },
    ],
    functions: {
      asyncThen1: {
        label: 'asyncThen1',
        body: [
          { kind: 'log', text: 'console.log("A")', output: 'A' },
          {
            kind: 'end',
            text: 'asyncThen1 termina\n→ devolve Promise fulfilled\n→ agenda resolve-derived',
          },
        ],
      },
      then2: {
        label: 'then2',
        body: [{ kind: 'log', text: 'console.log("B")', output: 'B' }, { kind: 'end', text: 'fim' }],
      },
    },
  },

  5: {
    topLevel: [{ kind: 'callAsync', text: 'chamar f()', fn: 'f' }],
    functions: {
      f: {
        label: 'f',
        body: [
          { kind: 'log', text: 'console.log("A")', output: 'A' },
          {
            kind: 'awaitResolved',
            text: 'await Promise.resolve()\n→ suspende função\n→ agenda resume#1',
            resumeLabel: 'resume#1',
          },
          { kind: 'log', text: 'console.log("B")', output: 'B' },
          {
            kind: 'awaitResolved',
            text: 'await Promise.resolve()\n→ suspende função\n→ agenda resume#2',
            resumeLabel: 'resume#2',
          },
          { kind: 'log', text: 'console.log("C")', output: 'C' },
          { kind: 'end', text: 'fim' },
        ],
      },
    },
  },

  6: {
    topLevel: [
      {
        kind: 'promiseThenStart',
        text: 'Promise.resolve().then(...)\n→ agenda reaction(then1)',
        // importante: NÃO enfileirar resolve-derived via onEnd, porque neste caso
        // a timeline do dataset mostra resolve-derived já na fila no step de "termina".
        enqueue: reaction('reaction(then1)', 'fulfilled', { onFulfilledHandler: 'then1' }, []),
      },
    ],
    functions: {
      then1: {
        label: 'then1',
        body: [
          { kind: 'callAsync', text: 'chamar inner()', callee: 'inner' },
          {
            kind: 'end',
            text: 'then1 termina\n→ devolve Promise fulfilled',
            enqueueBeforeSnapshot: [
              resolveDerived(
              'resolve-derived',
              'resolve promise derivada\n→ agenda reaction(then2)',
              [reaction('reaction(then2)', 'fulfilled', { onFulfilledHandler: 'then2' })]
            ),
            ],
          },
        ],
      },
      inner: {
        label: 'inner',
        body: [
          {
            kind: 'awaitResolved',
            text: 'await Promise.resolve()\n→ suspende inner\n→ agenda resume(inner)',
            resumeLabel: 'resume(inner)',
          },
          { kind: 'log', text: 'console.log("X")', output: 'X' },
          // No dataset não existe step separado para o fim do inner.
          { kind: 'end', text: 'fim', suppressSnapshot: true },
        ],
      },
      then2: {
        label: 'then2',
        body: [{ kind: 'log', text: 'console.log("Y")', output: 'Y' }, { kind: 'end', text: 'fim' }],
      },
    },
  },
};
