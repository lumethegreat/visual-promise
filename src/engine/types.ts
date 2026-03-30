export type StackFrameLabel = string;
export type MicrotaskLabel = string;

export interface CodeHighlight {
  startLine: number;
  endLine: number;
}

export interface TimelineStep {
  /** 0 => T0, 1 => T1, etc. */
  step: number;
  callStack: StackFrameLabel[];
  microtaskQueue: MicrotaskLabel[];
  event: string;
  output?: string;
  codeHighlight?: CodeHighlight;
}

export interface SimulationResult {
  steps: TimelineStep[];
}
