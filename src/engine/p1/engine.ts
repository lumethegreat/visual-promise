import type { TimelineStep } from '../types';
import type { EnqueueSpec, Frame, Instr, Microtask, Program, SimState, TopAction } from './types';

function labelsFromFrames(frames: Frame[]) {
  return frames.map((f) => f.fn);
}

function labelsFromMicrotasks(microtasks: Microtask[]) {
  return microtasks.map((m) => m.label);
}

function snapshot(state: SimState, event: string, output?: string) {
  const step = state.timeline.length;

  const s: TimelineStep = {
    step,
    callStack: labelsFromFrames(state.callStack),
    microtaskQueue: labelsFromMicrotasks(state.microtasks),
    event,
  };

  if (typeof output === 'string') s.output = output;

  state.timeline.push(s);
}

function mkFrame(program: Program, fnLabel: string, ip = 0, justResumed = false): Frame {
  if (!program.functions[fnLabel]) throw new Error(`Missing function def: ${fnLabel}`);
  return { fn: fnLabel, ip, justResumed };
}

function enqueueSpecToMicrotask(program: Program, spec: EnqueueSpec, frameForReaction?: Frame): Microtask {
  if (spec.kind === 'resume') {
    if (!frameForReaction) throw new Error('resume requires a frame');
    return { kind: 'resume', label: spec.label, frame: frameForReaction };
  }

  if (spec.kind === 'reaction') {
    const frame = mkFrame(program, spec.handlerFn, 0, false);
    return { kind: 'reaction', label: spec.label, frame, onEnd: spec.onEnd };
  }

  if (spec.kind === 'resolveDerived') {
    return {
      kind: 'resolveDerived',
      label: spec.label,
      eventText: spec.eventText,
      onRunEnqueue: spec.onRunEnqueue,
    };
  }

  // exhaustiveness
  const _never: never = spec;
  throw new Error(`Unknown EnqueueSpec: ${_never}`);
}

function enqueue(state: SimState, microtask: Microtask) {
  state.microtasks.push(microtask);
}

function runOneInstruction(state: SimState, program: Program): 'continue' | 'yielded' | 'ended' {
  const top = state.callStack[state.callStack.length - 1];
  if (!top) return 'ended';

  const fnDef = program.functions[top.fn];
  const instr: Instr | undefined = fnDef.body[top.ip];

  if (!instr) {
    // implicit end
    state.callStack.pop();
    snapshot(state, 'fim');
    return 'ended';
  }

  // advance ip by default
  top.ip += 1;

  if (instr.kind === 'log') {
    const prefix = top.justResumed ? 'retoma após await\n' : '';
    top.justResumed = false;
    snapshot(state, `${prefix}${instr.text}`, instr.output);
    return 'continue';
  }

  if (instr.kind === 'awaitResolved') {
    snapshot(state, instr.text);

    // suspend: pop frame and enqueue resume with continuation frame
    const cont: Frame = { fn: top.fn, ip: top.ip, justResumed: true };
    state.callStack.pop();
    enqueue(state, { kind: 'resume', label: instr.resumeLabel, frame: cont });

    return 'yielded';
  }

  if (instr.kind === 'callAsync') {
    snapshot(state, instr.text);
    // after snapshot, push callee and run it synchronously until it yields/ends
    state.callStack.push(mkFrame(program, instr.callee));
    return 'continue';
  }

  if (instr.kind === 'end') {
    // optionally enqueue before snapshot (dataset sometimes shows this)
    if (instr.enqueueBeforeSnapshot) {
      for (const spec of instr.enqueueBeforeSnapshot) {
        enqueue(state, enqueueSpecToMicrotask(program, spec));
      }
    }

    // end events are shown AFTER popping the frame
    state.callStack.pop();

    if (!instr.suppressSnapshot) {
      snapshot(state, instr.text);
    }

    if (instr.enqueueAfterSnapshot) {
      for (const spec of instr.enqueueAfterSnapshot) {
        enqueue(state, enqueueSpecToMicrotask(program, spec));
      }
    }

    return 'ended';
  }

  const _never: never = instr;
  throw new Error(`Unknown instruction: ${_never}`);
}

function runCallStackUntilIdle(state: SimState, program: Program) {
  // Corre execução síncrona enquanto houver frames.
  // Importante: um `await` suspende apenas a frame actual e devolve controlo ao caller.
  // Portanto, não “pára o mundo”: continuamos a executar enquanto existir call stack.
  while (state.callStack.length > 0) {
    runOneInstruction(state, program);
  }
}

function runTopAction(state: SimState, program: Program, action: TopAction) {
  if (action.kind === 'callAsync') {
    snapshot(state, action.text);
    state.callStack.push(mkFrame(program, action.fn));
    runCallStackUntilIdle(state, program);
    return;
  }

  if (action.kind === 'promiseThenStart') {
    snapshot(state, action.text);
    enqueue(state, enqueueSpecToMicrotask(program, action.enqueue));
    return;
  }

  if (action.kind === 'attachThen') {
    snapshot(state, action.text);
    return;
  }

  const _never: never = action;
  throw new Error(`Unknown top action: ${_never}`);
}

function dequeueWithSnapshot(state: SimState): Microtask {
  snapshot(state, 'dequeue microtask');
  const m = state.microtasks.shift();
  if (!m) throw new Error('dequeue on empty queue');
  return m;
}

function runMicrotask(state: SimState, program: Program, m: Microtask) {
  if (m.kind === 'resume') {
    state.callStack.push(m.frame);
    runCallStackUntilIdle(state, program);
    return;
  }

  if (m.kind === 'reaction') {
    state.callStack.push(m.frame);
    runCallStackUntilIdle(state, program);

    // after handler finishes (in sync), enqueue follow-ups
    for (const spec of m.onEnd) {
      enqueue(state, enqueueSpecToMicrotask(program, spec));
    }

    return;
  }

  if (m.kind === 'resolveDerived') {
    // This job is displayed as a stack frame
    state.callStack.push({ fn: m.label, ip: 0, justResumed: false });
    snapshot(state, m.eventText);
    state.callStack.pop();

    for (const spec of m.onRunEnqueue) {
      enqueue(state, enqueueSpecToMicrotask(program, spec));
    }

    return;
  }

  const _never: never = m;
  throw new Error(`Unknown microtask: ${_never}`);
}

export function simulateProgram(program: Program): TimelineStep[] {
  const state: SimState = {
    callStack: [],
    microtasks: [],
    timeline: [],
  };

  // Phase A: run all top-level sync actions
  for (const act of program.topLevel) {
    runTopAction(state, program, act);
  }

  // Phase B: drain microtasks FIFO
  while (state.microtasks.length > 0) {
    if (state.callStack.length !== 0) {
      throw new Error('Invariant violated: callstack should be empty when draining microtasks');
    }

    const m = dequeueWithSnapshot(state);
    runMicrotask(state, program, m);
  }

  return state.timeline;
}
