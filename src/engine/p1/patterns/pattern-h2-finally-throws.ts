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
 * Padrão H2 — finally que lança erro
 *
 * JS (conceito):
 * Promise.resolve("x")
 *   .finally(() => { throw new Error('boom') })
 *   .then(v => console.log(v))
 *   .catch(() => console.log('caught'))
 *
 * Regra: se o finally lançar, a chain fica rejected e segue para catch.
 */
export const PATTERN_H2_FINALLY_THROWS: Program = {
  topLevel: [
    {
      kind: 'promiseThenStart',
      text: 'Promise.resolve("x").finally(...)\n→ agenda reaction(finally1)',
      enqueue: reaction(
        'reaction(finally1)',
        'finally1',
        // normal path
        [reaction('reaction(then1)', 'then1')],
        // error path
        [reaction('reaction(catch1)', 'catch1')]
      ),
    },
    {
      kind: 'attachThen',
      text: 'anexar .then(...)\n→ fica pendente da promise derivada',
    },
    {
      kind: 'attachThen',
      text: 'anexar .catch(...)\n→ fica pendente da promise derivada',
    },
  ],
  functions: {
    finally1: {
      label: 'finally1',
      body: [
        {
          kind: 'throw',
          text: 'throw new Error("boom")\n→ reject promise derivada\n→ agenda reaction(catch1)',
        },
      ],
    },
    then1: {
      label: 'then1',
      body: [{ kind: 'log', text: 'console.log("x")', output: 'x' }, { kind: 'end', text: 'fim' }],
    },
    catch1: {
      label: 'catch1',
      body: [{ kind: 'log', text: 'console.log("caught")', output: 'caught' }, { kind: 'end', text: 'fim' }],
    },
  },
};
