import type { EnqueueSpec, Program } from '../types';

const reaction = (
  label: string,
  handlerFn: string,
  onFulfilled: EnqueueSpec[] = [],
  onRejected: EnqueueSpec[] = []
): EnqueueSpec => ({
  kind: 'reaction',
  label,
  handlerFn,
  onFulfilled,
  onRejected,
});

/**
 * Padrão H — finally
 *
 * JS (conceito):
 * Promise.resolve("x")
 *   .finally(() => console.log("F"))
 *   .then(v => console.log(v))
 *
 * Nota: este simulador ainda não propaga valores; o `then1` faz log directo de "x".
 */
export const PATTERN_H: Program = {
  topLevel: [
    {
      kind: 'promiseThenStart',
      text: 'Promise.resolve("x").finally(...)\n→ agenda reaction(finally1)',
      enqueue: reaction(
        'reaction(finally1)',
        'finally1',
        [reaction('reaction(then1)', 'then1')],
        [reaction('reaction(then1)', 'then1')]
      ),
    },
    {
      kind: 'attachThen',
      text: 'anexar .then(...)\n→ fica pendente da promise derivada',
    },
  ],
  functions: {
    finally1: {
      label: 'finally1',
      body: [{ kind: 'log', text: 'console.log("F")', output: 'F' }, { kind: 'end', text: 'finally1 termina' }],
    },
    then1: {
      label: 'then1',
      body: [{ kind: 'log', text: 'console.log("x")', output: 'x' }, { kind: 'end', text: 'fim' }],
    },
  },
};
