import type { TimelineStep } from '../types';

export type Label = string;

export type EnqueueSpec =
  | { kind: 'resume'; label: Label }
  | {
      /**
       * PromiseReactionJob.
       *
       * - `trigger` representa o estado da promise observada (fulfilled/rejected).
       * - escolhe-se o handler com base no trigger.
       * - se não houver handler aplicável, propaga-se o estado (passthrough).
       * - se houver handler e este lançar, a derivada fica rejected.
       */
      kind: 'reaction';
      label: Label;
      trigger: 'fulfilled' | 'rejected';
      onFulfilledHandler?: Label;
      onRejectedHandler?: Label;
      onFulfilled: EnqueueSpec[];
      onRejected: EnqueueSpec[];
    }
  | {
      kind: 'resolveDerived';
      label: Label;
      /** Texto do evento (obrigatório) para evitar special-cases no engine. */
      eventText: string;
      onRunEnqueue: EnqueueSpec[];
    };

export type Instr =
  | { kind: 'log'; text: string; output: string }
  | { kind: 'awaitResolved'; text: string; resumeLabel: Label }
  | { kind: 'callAsync'; text: string; callee: Label }
  | {
      /**
       * await <asyncFn>()
       *
       * Semântica (subset): suspende a frame actual e só retoma quando a função async chamada terminar.
       */
      kind: 'awaitCallAsync';
      text: string;
      callee: Label;
      resumeLabel: Label;
    }
  | {
      /**
       * Lançar erro (completion abrupto).
       * Por agora não modelamos try/catch dentro da mesma stack: o throw termina a microtask.
       */
      kind: 'throw';
      text: string;
      /** Opcional: enfileirar microtasks após o throw (útil p/ modelar rejeições/continuações). */
      enqueueAfterSnapshot?: EnqueueSpec[];
    }
  | {
      kind: 'end';
      text: string;
      /** Se true, termina a frame sem adicionar step (útil para bater certo com o dataset). */
      suppressSnapshot?: boolean;
      /**
       * Permite reproduzir a apresentação do dataset, que por vezes mostra
       * microtasks já na fila no step de "termina".
       */
      enqueueBeforeSnapshot?: EnqueueSpec[];
      enqueueAfterSnapshot?: EnqueueSpec[];
    };

export interface FunctionDef {
  label: Label;
  body: Instr[];
}

export interface Program {
  /** Top-level actions are executed synchronously, in order, until exhausted. */
  topLevel: TopAction[];
  functions: Record<Label, FunctionDef>;
}

export type TopAction =
  | { kind: 'callAsync'; text: string; fn: Label }
  | { kind: 'promiseThenStart'; text: string; enqueue: EnqueueSpec }
  | { kind: 'attachThen'; text: string };

export interface Frame {
  fn: Label;
  ip: number;
  /** When true, the next log should be prefixed with "retoma após await". */
  justResumed: boolean;

  /**
   * Quando definido, esta frame foi criada por um `await <asyncFn>()`.
   * Ao terminar (normalmente), o engine enfileira um `resume` para retomar a frame guardada.
   */
  onReturnResume?: { label: Label; frame: { fn: Label; ip: number; justResumed: boolean } };
}

export type Microtask =
  | { kind: 'resume'; label: Label; frame: Frame }
  | {
      kind: 'reaction';
      label: Label;
      trigger: 'fulfilled' | 'rejected';
      onFulfilledHandler?: Label;
      onRejectedHandler?: Label;
      onFulfilled: EnqueueSpec[];
      onRejected: EnqueueSpec[];
    }
  | { kind: 'resolveDerived'; label: Label; eventText: string; onRunEnqueue: EnqueueSpec[] };

export interface SimState {
  callStack: Frame[];
  microtasks: Microtask[];
  timeline: TimelineStep[];

  /** True se houve um throw durante a execução da microtask actual. */
  threw: boolean;
}
