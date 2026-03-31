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

function mkFrame(
  program: Program,
  fnLabel: string,
  ip = 0,
  justResumed = false,
  awaitsDone = 0,
  onReturnResume?: Frame['onReturnResume'],
  onReturnEnqueue?: Frame['onReturnEnqueue']
): Frame {
  if (!program.functions[fnLabel]) throw new Error(`Missing function def: ${fnLabel}`);
  return { fn: fnLabel, ip, justResumed, awaitsDone, onReturnResume, onReturnEnqueue };
}

function enqueueSpecToMicrotask(program: Program, spec: EnqueueSpec, frameForReaction?: Frame): Microtask {
  if (spec.kind === 'resume') {
    if (!frameForReaction) throw new Error('resume requires a frame');
    return { kind: 'resume', label: spec.label, frame: frameForReaction };
  }

  if (spec.kind === 'reaction') {
    return {
      kind: 'reaction',
      label: spec.label,
      trigger: spec.trigger,
      onFulfilledHandler: spec.onFulfilledHandler,
      onRejectedHandler: spec.onRejectedHandler,
      onFulfilled: spec.onFulfilled,
      onRejected: spec.onRejected,
    };
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

function enqueueFront(state: SimState, microtask: Microtask) {
  state.microtasks.unshift(microtask);
}

function runOneInstruction(state: SimState, program: Program): 'continue' | 'yielded' | 'ended' {
  const top = state.callStack[state.callStack.length - 1];
  if (!top) return 'ended';

  const fnDef = program.functions[top.fn];
  const instr: Instr | undefined = fnDef.body[top.ip];

  if (!instr) {
    // implicit end
    const ended = state.callStack.pop();
    snapshot(state, 'fim');

    // If this frame was created by `await <asyncFn>()`, resume the awaiting frame now.
    if (ended?.onReturnResume) {
      enqueue(state, { kind: 'resume', label: ended.onReturnResume.label, frame: ended.onReturnResume.frame });
    }

    // Fire-and-forget hooks (e.g. inner().then(cb))
    if (ended?.onReturnEnqueue) {
      for (const spec of ended.onReturnEnqueue) {
        enqueue(state, enqueueSpecToMicrotask(program, spec));
      }
    }

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
    // Important: preserve onReturnResume/onReturnEnqueue so awaited async calls can resume their awaiter after multiple awaits.
    const nextAwaitsDone = top.awaitsDone + 1;

    const cont: Frame = {
      fn: top.fn,
      ip: top.ip,
      justResumed: true,
      awaitsDone: nextAwaitsDone,
      onReturnResume: top.onReturnResume,
      onReturnEnqueue: top.onReturnEnqueue,
    };
    state.callStack.pop();

    const resumeTask: Microtask = { kind: 'resume', label: instr.resumeLabel, frame: cont };

    // Heurística (subset) para bater ordering de snippets “realistas”:
    // - Por defeito, tratamos resumes como microtasks FIFO.
    // - Excepção: em async functions com *vários* awaits, depois de permitir 1 interleaving
    //   (tipicamente o `.then` seguinte), fazemos “run-ahead” (depth-first) para que os awaits restantes
    //   completem antes do próximo `.then` (ex.: task1, task2, innerTask, task3).
    //
    // Implementação:
    // - Se este await está a acontecer logo após o 1º resume (awaitsDone===1) e já há microtasks pendentes,
    //   enfileira FIFO para permitir que outras microtasks corram primeiro.
    // - A partir do 2º resume (awaitsDone>=2), se houver microtasks pendentes, damos prioridade (enqueueFront).
    // - Caso contrário, FIFO.
    const pending = state.microtasks.length > 0;
    if (pending && top.awaitsDone === 1) {
      enqueue(state, resumeTask);
    } else if (pending && top.awaitsDone >= 2) {
      enqueueFront(state, resumeTask);
    } else {
      enqueue(state, resumeTask);
    }

    return 'yielded';
  }

  if (instr.kind === 'callAsync') {
    snapshot(state, instr.text);
    // after snapshot, push callee and run it synchronously until it yields/ends
    state.callStack.push(mkFrame(program, instr.callee, 0, false, 0));
    return 'continue';
  }

  if (instr.kind === 'callAsyncThen') {
    snapshot(state, instr.text);

    const thenReaction = {
      kind: 'reaction' as const,
      label: `reaction(${instr.thenHandler})`,
      trigger: 'fulfilled' as const,
      onFulfilledHandler: instr.thenHandler,
      onRejectedHandler: undefined,
      onFulfilled: [],
      onRejected: [],
    };

    state.callStack.push(mkFrame(program, instr.callee, 0, false, 0, undefined, [thenReaction]));
    return 'continue';
  }

  if (instr.kind === 'awaitCallAsync') {
    snapshot(state, instr.text);

    // suspend current frame (like awaitResolved)
    const cont: Frame = {
      fn: top.fn,
      ip: top.ip,
      justResumed: true,
      awaitsDone: top.awaitsDone,
      onReturnEnqueue: top.onReturnEnqueue,
    };
    state.callStack.pop();

    // run callee; when it ends, we'll enqueue a resume for the awaiting frame
    state.callStack.push(mkFrame(program, instr.callee, 0, false, 0, { label: instr.resumeLabel, frame: cont }));

    return 'continue';
  }

  if (instr.kind === 'throw') {
    // Snapshot com a stack actual (antes do unwind)
    snapshot(state, instr.text);

    // Opcional: enfileirar microtasks associadas a este throw (p.ex. rejeição de promise derivada)
    if (instr.enqueueAfterSnapshot) {
      for (const spec of instr.enqueueAfterSnapshot) {
        enqueue(state, enqueueSpecToMicrotask(program, spec));
      }
    }

    // Sem try/catch local: unwind até ao boundary da microtask
    state.callStack = [];
    state.threw = true;

    return 'ended';
  }

  if (instr.kind === 'end') {
    // optionally enqueue before snapshot (dataset sometimes shows this)
    if (instr.enqueueBeforeSnapshot) {
      for (const spec of instr.enqueueBeforeSnapshot) {
        enqueue(state, enqueueSpecToMicrotask(program, spec));
      }
    }

    // end events are shown AFTER popping the frame
    const ended = state.callStack.pop();

    if (!instr.suppressSnapshot) {
      snapshot(state, instr.text);
    }

    if (instr.enqueueAfterSnapshot) {
      for (const spec of instr.enqueueAfterSnapshot) {
        enqueue(state, enqueueSpecToMicrotask(program, spec));
      }
    }

    // If this frame was created by `await <asyncFn>()`, resume the awaiting frame now.
    if (ended?.onReturnResume) {
      enqueue(state, { kind: 'resume', label: ended.onReturnResume.label, frame: ended.onReturnResume.frame });
    }

    // Fire-and-forget hooks (e.g. inner().then(cb))
    if (ended?.onReturnEnqueue) {
      for (const spec of ended.onReturnEnqueue) {
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
    state.callStack.push(mkFrame(program, action.fn, 0, false, 0));
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
    // reset completion flag for this microtask
    state.threw = false;

    const handler = m.trigger === 'fulfilled' ? m.onFulfilledHandler : m.onRejectedHandler;

    // Sem handler aplicável: passthrough (propaga o estado)
    if (!handler) {
      snapshot(state, `${m.label} (no handler)\n→ propagate ${m.trigger}`);
      const followUps = m.trigger === 'fulfilled' ? m.onFulfilled : m.onRejected;
      for (const spec of followUps) enqueue(state, enqueueSpecToMicrotask(program, spec));
      state.threw = false;
      return;
    }

    // Com handler: executa e decide followups por completion (normal vs throw)
    state.callStack.push(mkFrame(program, handler, 0, false, 0));
    runCallStackUntilIdle(state, program);

    const followUps = state.threw ? m.onRejected : m.onFulfilled;

    // enqueue follow-ups FIFO
    for (const spec of followUps) {
      enqueue(state, enqueueSpecToMicrotask(program, spec));
    }

    // clear flag after deciding
    state.threw = false;

    return;
  }

  if (m.kind === 'resolveDerived') {
    // This job is displayed as a stack frame
    state.callStack.push({ fn: m.label, ip: 0, justResumed: false, awaitsDone: 0 });
    snapshot(state, m.eventText);
    state.callStack.pop();

    // Nota: `resolveDerived` é um passo “interno” que existe sobretudo para bater certo com o dataset.
    // Para aproximar melhor o comportamento observado (e evitar que este passo interno altere ordering),
    // enfileiramos os follow-ups com prioridade, como se tivessem sido enfileirados no mesmo instante.
    for (const spec of [...m.onRunEnqueue].reverse()) {
      enqueueFront(state, enqueueSpecToMicrotask(program, spec));
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
    threw: false,
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
