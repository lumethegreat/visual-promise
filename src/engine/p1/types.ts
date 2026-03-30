import type { TimelineStep } from '../types';

export type Label = string;

export type EnqueueSpec =
  | { kind: 'resume'; label: Label }
  | { kind: 'reaction'; label: Label; handlerFn: Label; onEnd: EnqueueSpec[] }
  | { kind: 'resolveDerived'; label: Label; onRunEnqueue: EnqueueSpec[] };

export type Instr =
  | { kind: 'log'; text: string; output: string }
  | { kind: 'awaitResolved'; text: string; resumeLabel: Label }
  | { kind: 'callAsync'; text: string; callee: Label }
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
}

export type Microtask =
  | { kind: 'resume'; label: Label; frame: Frame }
  | { kind: 'reaction'; label: Label; frame: Frame; onEnd: EnqueueSpec[] }
  | { kind: 'resolveDerived'; label: Label; onRunEnqueue: EnqueueSpec[] };

export interface SimState {
  callStack: Frame[];
  microtasks: Microtask[];
  timeline: TimelineStep[];
}
