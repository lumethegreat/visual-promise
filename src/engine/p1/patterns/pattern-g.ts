import type { EnqueueSpec, Program } from '../types';

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

/**
 * Padrão G — erro lançado em handler
 *
 * JS:
 * Promise.resolve()
 *   .then(() => { throw new Error('boom') })
 *   .catch(() => console.log('caught'))
 */
export const PATTERN_G: Program = {
  topLevel: [
    {
      kind: 'promiseThenStart',
      text: 'Promise.resolve().then(...)\n→ agenda reaction(then1)',
      enqueue: reaction('reaction(then1)', 'fulfilled', { onFulfilledHandler: 'then1' }, [], [reaction('reaction(catch1)', 'rejected', { onRejectedHandler: 'catch1' })]),
    },
    {
      kind: 'attachThen',
      text: 'anexar .catch(...)\n→ fica pendente da promise derivada',
    },
  ],
  functions: {
    then1: {
      label: 'then1',
      body: [
        {
          kind: 'throw',
          text: 'throw new Error("boom")\n→ reject promise derivada\n→ agenda reaction(catch1)',
        },
      ],
    },
    catch1: {
      label: 'catch1',
      body: [{ kind: 'log', text: 'console.log("caught")', output: 'caught' }, { kind: 'end', text: 'fim' }],
    },
  },
};
