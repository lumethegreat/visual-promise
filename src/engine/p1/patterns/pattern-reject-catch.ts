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
 * Promise.reject().then(...).catch(...)
 *
 * Objectivo: testar rejeição sem `throw`.
 *
 * A promise inicial está rejected, portanto:
 * - o reaction do `.then` corre com trigger=rejected e sem handler aplicável (passthrough)
 * - isso propaga a rejeição e torna o `.catch` elegível
 */
export const PATTERN_REJECT_THEN_CATCH: Program = {
  topLevel: [
    {
      kind: 'promiseThenStart',
      text: 'Promise.reject().then(...)\n→ agenda reaction(then1) (rejected)',
      enqueue: reaction(
        'reaction(then1)',
        'rejected',
        { onFulfilledHandler: 'then1' },
        [],
        [reaction('reaction(catch1)', 'rejected', { onRejectedHandler: 'catch1' })]
      ),
    },
    {
      kind: 'attachThen',
      text: 'anexar .catch(...)\n→ fica pendente da promise derivada',
    },
  ],
  functions: {
    then1: {
      label: 'then1',
      body: [{ kind: 'log', text: 'console.log("A")', output: 'A' }, { kind: 'end', text: 'fim' }],
    },
    catch1: {
      label: 'catch1',
      body: [{ kind: 'log', text: 'console.log("B")', output: 'B' }, { kind: 'end', text: 'fim' }],
    },
  },
};
