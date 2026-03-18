/**
 * Replay Reducer Tests — Visual Promise
 * ======================================
 *
 * Unit tests for replayReducer covering every event type.
 * Tests are organised by domain: promise lifecycle, reaction lifecycle,
 * frame stack, microtask queue, console, errors, and edge cases.
 */

import { describe, it, expect } from "vitest";
import { replayReducer } from "./replay-reducer";
import { createInitialReplayState } from "../../docs/replay-state";
import type { ReplayState, VPPEvent } from "../../docs/replay-state";

// ─── Test helpers ───────────────────────────────────────────────────────────

function makeEvent(
  partial: Partial<VPPEvent> & { type: string; seq: number; timestamp: string },
): VPPEvent {
  return partial as VPPEvent;
}

function baseEvent(seq = 1): { seq: number; timestamp: string } {
  return { seq, timestamp: "2026-03-18T00:00:00.000Z" };
}

function initialState(events: VPPEvent[] = []): ReplayState {
  return createInitialReplayState(events);
}

// ─── Promise lifecycle ─────────────────────────────────────────────────────

describe("promise.create", () => {
  it("adds a pending promise to the map", () => {
    const state = initialState();
    const event = makeEvent({
      ...baseEvent(1),
      type: "promise.create",
      data: { promiseId: "p1", constructor: "Promise" },
    });

    const next = replayReducer(state, event);

    expect(next.promises.has("p1")).toBe(true);
    expect(next.promises.get("p1")!.state).toBe("pending");
    expect(next.promises.get("p1")!.createSeq).toBe(1);
    expect(next.promises.get("p1")!.settleSeq).toBeNull();
    expect(next.promises.get("p1")!.constructor).toBe("Promise");
  });

  it("preserves existing promises when adding a new one", () => {
    const state = initialState();
    const e1 = makeEvent({
      ...baseEvent(1),
      type: "promise.create",
      data: { promiseId: "p1", constructor: "Promise" },
    });
    const e2 = makeEvent({
      ...baseEvent(2),
      type: "promise.create",
      data: { promiseId: "p2", constructor: "AsyncFunction" },
    });

    const s1 = replayReducer(state, e1);
    const s2 = replayReducer(s1, e2);

    expect(s2.promises.has("p1")).toBe(true);
    expect(s2.promises.has("p2")).toBe(true);
    expect(s2.promises.get("p2")!.constructor).toBe("AsyncFunction");
  });

  it("sets lastEvent to the create event", () => {
    const state = initialState();
    const event = makeEvent({
      ...baseEvent(1),
      type: "promise.create",
      data: { promiseId: "p1", constructor: "Promise" },
    });

    const next = replayReducer(state, event);
    expect(next.lastEvent).toBe(event);
  });
});

describe("promise.settle", () => {
  it("transitions promise from pending to fulfilled with value", () => {
    const state = initialState();
    const create = makeEvent({
      ...baseEvent(1),
      type: "promise.create",
      data: { promiseId: "p1", constructor: "Promise" },
    });
    const settle = makeEvent({
      ...baseEvent(2),
      type: "promise.settle",
      data: { promiseId: "p1", state: "fulfilled", value: 42 },
    });

    const s1 = replayReducer(state, create);
    const s2 = replayReducer(s1, settle);

    expect(s2.promises.get("p1")!.state).toBe("fulfilled");
    expect(s2.promises.get("p1")!.value).toBe(42);
    expect(s2.promises.get("p1")!.settleSeq).toBe(2);
  });

  it("transitions promise from pending to rejected with reason", () => {
    const state = initialState();
    const create = makeEvent({
      ...baseEvent(1),
      type: "promise.create",
      data: { promiseId: "p1", constructor: "Promise" },
    });
    const settle = makeEvent({
      ...baseEvent(2),
      type: "promise.settle",
      data: { promiseId: "p1", state: "rejected", reason: new Error("boom") },
    });

    const s1 = replayReducer(state, create);
    const s2 = replayReducer(s1, settle);

    expect(s2.promises.get("p1")!.state).toBe("rejected");
    expect((s2.promises.get("p1") as any).reason).toBeInstanceOf(Error);
  });
});

// ─── Reaction lifecycle ────────────────────────────────────────────────────

describe("reaction.register", () => {
  it("adds a reaction to the map with status registered", () => {
    const state = initialState();
    const event = makeEvent({
      ...baseEvent(1),
      type: "reaction.register",
      data: { reactionId: "r1", promiseId: "p1", handlerType: "then", index: 0 },
    });

    const next = replayReducer(state, event);

    expect(next.reactions.has("r1")).toBe(true);
    expect(next.reactions.get("r1")!.status).toBe("registered");
    expect(next.reactions.get("r1")!.registerSeq).toBe(1);
    expect(next.reactions.get("r1")!.enqueueSeq).toBeNull();
  });

  it("registers catch and finally handler types", () => {
    const state = initialState();
    const catchEv = makeEvent({
      ...baseEvent(1),
      type: "reaction.register",
      data: { reactionId: "r2", promiseId: "p1", handlerType: "catch", index: 0 },
    });
    const finallyEv = makeEvent({
      ...baseEvent(2),
      type: "reaction.register",
      data: { reactionId: "r3", promiseId: "p1", handlerType: "finally", index: 0 },
    });

    const s1 = replayReducer(state, catchEv);
    const s2 = replayReducer(s1, finallyEv);

    expect(s2.reactions.get("r2")!.handlerType).toBe("catch");
    expect(s2.reactions.get("r3")!.handlerType).toBe("finally");
  });
});

describe("reaction.enqueue", () => {
  it("updates reaction status to enqueued and adds to microtask queue", () => {
    const state = initialState();
    const reg = makeEvent({
      ...baseEvent(1),
      type: "reaction.register",
      data: { reactionId: "r1", promiseId: "p1", handlerType: "then", index: 0 },
    });
    const enq = makeEvent({
      ...baseEvent(2),
      type: "reaction.enqueue",
      data: { reactionId: "r1", promiseId: "p1", queuePosition: 0, queueDepth: 1 },
    });

    const s1 = replayReducer(state, reg);
    const s2 = replayReducer(s1, enq);

    expect(s2.reactions.get("r1")!.status).toBe("enqueued");
    expect(s2.reactions.get("r1")!.enqueueSeq).toBe(2);
    expect(s2.microtaskQueue.entries).toHaveLength(1);
    expect(s2.microtaskQueue.entries[0]!.reactionId).toBe("r1");
    expect(s2.microtaskQueue.entries[0]!.label).toBe("then #1");
    expect(s2.microtaskQueue.totalEnqueued).toBe(1);
  });

  it("increments queue position for subsequent enqueues", () => {
    const state = initialState();
    const reg1 = makeEvent({
      ...baseEvent(1),
      type: "reaction.register",
      data: { reactionId: "r1", promiseId: "p1", handlerType: "then", index: 0 },
    });
    const reg2 = makeEvent({
      ...baseEvent(2),
      type: "reaction.register",
      data: { reactionId: "r2", promiseId: "p1", handlerType: "catch", index: 1 },
    });
    const enq1 = makeEvent({
      ...baseEvent(3),
      type: "reaction.enqueue",
      data: { reactionId: "r1", promiseId: "p1", queuePosition: 0, queueDepth: 2 },
    });
    const enq2 = makeEvent({
      ...baseEvent(4),
      type: "reaction.enqueue",
      data: { reactionId: "r2", promiseId: "p1", queuePosition: 1, queueDepth: 2 },
    });

    const s1 = replayReducer(state, reg1);
    const s2 = replayReducer(s1, reg2);
    const s3 = replayReducer(s2, enq1);
    const s4 = replayReducer(s3, enq2);

    expect(s4.microtaskQueue.entries).toHaveLength(2);
    expect(s4.microtaskQueue.entries[0]!.label).toBe("then #1");
    expect(s4.microtaskQueue.entries[1]!.label).toBe("catch #2");
    expect(s4.microtaskQueue.totalEnqueued).toBe(2);
  });
});

describe("reaction.run", () => {
  it("updates reaction status to running and removes it from the queue", () => {
    const state = initialState();
    const reg = makeEvent({
      ...baseEvent(1),
      type: "reaction.register",
      data: { reactionId: "r1", promiseId: "p1", handlerType: "then", index: 0 },
    });
    const enq = makeEvent({
      ...baseEvent(2),
      type: "reaction.enqueue",
      data: { reactionId: "r1", promiseId: "p1", queuePosition: 0, queueDepth: 1 },
    });
    const run = makeEvent({
      ...baseEvent(3),
      type: "reaction.run",
      data: { reactionId: "r1", settlementType: "fulfilled", settlementValue: 42 },
    });

    const s1 = replayReducer(state, reg);
    const s2 = replayReducer(s1, enq);
    const s3 = replayReducer(s2, run);

    expect(s3.reactions.get("r1")!.status).toBe("running");
    expect(s3.reactions.get("r1")!.runSeq).toBe(3);
    expect(s3.microtaskQueue.entries).toHaveLength(0);
  });

  it("re-indexes remaining queue entries after dequeue", () => {
    const state = initialState();
    // Register and enqueue three reactions
    let s = state;
    for (const [rid, ht] of [["r1", "then"], ["r2", "then"], ["r3", "then"]] as const) {
      s = replayReducer(s, makeEvent({
        ...baseEvent(),
        type: "reaction.register",
        data: { reactionId: rid, promiseId: "p1", handlerType: ht, index: 0 },
      }));
      s = replayReducer(s, makeEvent({
        ...baseEvent(),
        type: "reaction.enqueue",
        data: { reactionId: rid, promiseId: "p1", queuePosition: 0, queueDepth: 3 },
      }));
    }
    // Dequeue the middle one (r2)
    s = replayReducer(s, makeEvent({
      ...baseEvent(),
      type: "reaction.run",
      data: { reactionId: "r2", settlementType: "fulfilled", settlementValue: 42 },
    }));

    expect(s.microtaskQueue.entries).toHaveLength(2);
    expect(s.microtaskQueue.entries[0]!.reactionId).toBe("r1");
    expect(s.microtaskQueue.entries[0]!.position).toBe(0);
    expect(s.microtaskQueue.entries[1]!.reactionId).toBe("r3");
    expect(s.microtaskQueue.entries[1]!.position).toBe(1);
    expect(s.microtaskQueue.totalEnqueued).toBe(3);
  });
});

describe("promise.reaction.fire", () => {
  it("updates reaction status to complete with fireSeq", () => {
    const state = initialState();
    const reg = makeEvent({
      ...baseEvent(1),
      type: "reaction.register",
      data: { reactionId: "r1", promiseId: "p1", handlerType: "then", index: 0 },
    });
    const enq = makeEvent({
      ...baseEvent(2),
      type: "reaction.enqueue",
      data: { reactionId: "r1", promiseId: "p1", queuePosition: 0, queueDepth: 1 },
    });
    const run = makeEvent({
      ...baseEvent(3),
      type: "reaction.run",
      data: { reactionId: "r1", settlementType: "fulfilled", settlementValue: 42 },
    });
    const fire = makeEvent({
      ...baseEvent(4),
      type: "promise.reaction.fire",
      data: {
        reactionId: "r1",
        sourcePromiseId: "p1",
        settlementType: "fulfilled",
        settlementValue: 42,
      },
    });

    let s = replayReducer(state, reg);
    s = replayReducer(s, enq);
    s = replayReducer(s, run);
    s = replayReducer(s, fire);

    expect(s.reactions.get("r1")!.status).toBe("complete");
    expect(s.reactions.get("r1")!.fireSeq).toBe(4);
  });
});

// ─── Frame lifecycle ───────────────────────────────────────────────────────

describe("frame.enter", () => {
  it("pushes a new frame onto the stack", () => {
    const state = initialState();
    const event = makeEvent({
      ...baseEvent(1),
      type: "frame.enter",
      data: {
        frameId: "f1", name: "foo", kind: "function",
        exitSeq: 10, parentSeq: null,
        startColumn: 1, endColumn: 20, startLine: 1, endLine: 5,
      },
    });

    const next = replayReducer(state, event);

    expect(next.frameStack).toHaveLength(1);
    expect(next.frameStack[0]!.frameId).toBe("f1");
    expect(next.frameStack[0]!.status).toBe("active");
    expect(next.frameStack[0]!.enterSeq).toBe(1);
    expect(next.frameStack[0]!.exitSeq).toBeNull();
    expect(next.frameStack[0]!.suspendSeq).toBeNull();
  });

  it("accumulates multiple frames", () => {
    const state = initialState();
    const e1 = makeEvent({
      ...baseEvent(1),
      type: "frame.enter",
      data: { frameId: "f1", name: "outer", kind: "function", exitSeq: 5, parentSeq: null, startColumn: 1, endColumn: 10, startLine: 1, endLine: 10 },
    });
    const e2 = makeEvent({
      ...baseEvent(2),
      type: "frame.enter",
      data: { frameId: "f2", name: "inner", kind: "function", exitSeq: 4, parentSeq: 1, startColumn: 3, endColumn: 8, startLine: 3, endLine: 7 },
    });

    const s1 = replayReducer(state, e1);
    const s2 = replayReducer(s1, e2);

    expect(s2.frameStack).toHaveLength(2);
    expect(s2.frameStack[0]!.frameId).toBe("f1");
    expect(s2.frameStack[1]!.frameId).toBe("f2");
  });
});

describe("frame.exit", () => {
  it("marks frame as exited with exitSeq and keeps it in the stack", () => {
    const state = initialState();
    const enter = makeEvent({
      ...baseEvent(1),
      type: "frame.enter",
      data: { frameId: "f1", name: "foo", kind: "function", exitSeq: 3, parentSeq: null, startColumn: 1, endColumn: 10, startLine: 1, endLine: 10 },
    });
    const exit = makeEvent({
      ...baseEvent(3),
      type: "frame.exit",
      data: { frameId: "f1", normal: true, returnValue: 42 },
    });

    const s1 = replayReducer(state, enter);
    const s2 = replayReducer(s1, exit);

    expect(s2.frameStack[0]!.status).toBe("exited");
    expect(s2.frameStack[0]!.exitSeq).toBe(3);
    expect(s2.frameStack).toHaveLength(1); // not removed
  });
});

describe("frame.suspend", () => {
  it("marks frame as suspended", () => {
    const state = initialState();
    const enter = makeEvent({
      ...baseEvent(1),
      type: "frame.enter",
      data: { frameId: "f1", name: "asyncFoo", kind: "async", exitSeq: 5, parentSeq: null, startColumn: 1, endColumn: 30, startLine: 1, endLine: 15 },
    });
    const suspend = makeEvent({
      ...baseEvent(3),
      type: "frame.suspend",
      data: { frameId: "f1", awaitExpr: "Promise.resolve()", awaitedPromiseId: "p1" },
    });

    const s1 = replayReducer(state, enter);
    const s2 = replayReducer(s1, suspend);

    expect(s2.frameStack[0]!.status).toBe("suspended");
    expect(s2.frameStack[0]!.suspendSeq).toBe(3);
  });
});

describe("frame.resume", () => {
  it("marks frame as active and clears suspendSeq", () => {
    const state = initialState();
    const enter = makeEvent({
      ...baseEvent(1),
      type: "frame.enter",
      data: { frameId: "f1", name: "asyncFoo", kind: "async", exitSeq: 6, parentSeq: null, startColumn: 1, endColumn: 30, startLine: 1, endLine: 15 },
    });
    const suspend = makeEvent({
      ...baseEvent(3),
      type: "frame.suspend",
      data: { frameId: "f1", awaitExpr: "Promise.resolve()", awaitedPromiseId: "p1" },
    });
    const resume = makeEvent({
      ...baseEvent(5),
      type: "frame.resume",
      data: { frameId: "f1", settled: true, value: "resolved!" },
    });

    let s = replayReducer(state, enter);
    s = replayReducer(s, suspend);
    s = replayReducer(s, resume);

    expect(s.frameStack[0]!.status).toBe("active");
    expect(s.frameStack[0]!.suspendSeq).toBeNull();
  });
});

// ─── Await ─────────────────────────────────────────────────────────────────

describe("await.suspend", () => {
  it("suspends the currently-active async frame", () => {
    const state = initialState();
    const enter = makeEvent({
      ...baseEvent(1),
      type: "frame.enter",
      data: { frameId: "f1", name: "run", kind: "async", exitSeq: 10, parentSeq: null, startColumn: 1, endColumn: 20, startLine: 1, endLine: 20 },
    });
    const awaitSuspend = makeEvent({
      ...baseEvent(3),
      type: "await.suspend",
      data: { frameId: "f1", awaitExpr: "fetchData()", awaitedPromiseId: "p1" },
    });

    const s1 = replayReducer(state, enter);
    const s2 = replayReducer(s1, awaitSuspend);

    expect(s2.frameStack[0]!.status).toBe("suspended");
    expect(s2.frameStack[0]!.suspendSeq).toBe(3);
  });
});

describe("await.resume", () => {
  it("resumes the most recently suspended async frame", () => {
    const state = initialState();
    const enter = makeEvent({
      ...baseEvent(1),
      type: "frame.enter",
      data: { frameId: "f1", name: "run", kind: "async", exitSeq: 10, parentSeq: null, startColumn: 1, endColumn: 20, startLine: 1, endLine: 20 },
    });
    const awaitSuspend = makeEvent({
      ...baseEvent(3),
      type: "await.suspend",
      data: { frameId: "f1", awaitExpr: "fetchData()", awaitedPromiseId: "p1" },
    });
    const awaitResume = makeEvent({
      ...baseEvent(6),
      type: "await.resume",
      data: { frameId: "f1", settled: true, value: "data!" },
    });

    let s = replayReducer(state, enter);
    s = replayReducer(s, awaitSuspend);
    s = replayReducer(s, awaitResume);

    expect(s.frameStack[0]!.status).toBe("active");
  });
});

// ─── finally ───────────────────────────────────────────────────────────────

describe("finally.register", () => {
  it("adds a finally reaction to the reaction map", () => {
    const state = initialState();
    const event = makeEvent({
      ...baseEvent(1),
      type: "finally.register",
      data: { reactionId: "r1", promiseId: "p1", passThroughReactionId: "r2" },
    });

    const next = replayReducer(state, event);

    expect(next.reactions.has("r1")).toBe(true);
    expect(next.reactions.get("r1")!.handlerType).toBe("finally");
    expect(next.reactions.get("r1")!.status).toBe("registered");
  });
});

describe("finally.complete", () => {
  it("marks finally reaction as complete", () => {
    const state = initialState();
    const reg = makeEvent({
      ...baseEvent(1),
      type: "finally.register",
      data: { reactionId: "r1", promiseId: "p1", passThroughReactionId: "r2" },
    });
    const comp = makeEvent({
      ...baseEvent(3),
      type: "finally.complete",
      data: { reactionId: "r1", ok: true, returnValue: undefined },
    });

    const s1 = replayReducer(state, reg);
    const s2 = replayReducer(s1, comp);

    expect(s2.reactions.get("r1")!.status).toBe("complete");
    expect(s2.reactions.get("r1")!.fireSeq).toBe(3);
  });
});

// ─── Console ────────────────────────────────────────────────────────────────

describe("console events", () => {
  it("console.output appends a log entry", () => {
    const state = initialState();
    const event = makeEvent({
      ...baseEvent(1),
      type: "console.output",
      data: { method: "log", args: ["hello", 123] },
    });

    const next = replayReducer(state, event);

    expect(next.consoleEntries).toHaveLength(1);
    expect(next.consoleEntries[0]!.method).toBe("log");
    expect(next.consoleEntries[0]!.args).toEqual(["hello", 123]);
    expect(next.consoleEntries[0]!.seq).toBe(1);
  });

  it("console.warn appends a warn entry", () => {
    const state = initialState();
    const event = makeEvent({
      ...baseEvent(2),
      type: "console.warn",
      data: { method: "warn", args: ["something went wrong"] },
    });

    const next = replayReducer(state, event);

    expect(next.consoleEntries).toHaveLength(1);
    expect(next.consoleEntries[0]!.method).toBe("warn");
  });

  it("console.error appends an error entry", () => {
    const state = initialState();
    const event = makeEvent({
      ...baseEvent(3),
      type: "console.error",
      data: { method: "error", args: ["failed!"] },
    });

    const next = replayReducer(state, event);

    expect(next.consoleEntries).toHaveLength(1);
    expect(next.consoleEntries[0]!.method).toBe("error");
  });

  it("accumulates multiple console entries", () => {
    const state = initialState();
    const log = makeEvent({ ...baseEvent(1), type: "console.output", data: { method: "log" as const, args: ["a"] } });
    const warn = makeEvent({ ...baseEvent(2), type: "console.warn", data: { method: "warn" as const, args: ["b"] } });
    const err = makeEvent({ ...baseEvent(3), type: "console.error", data: { method: "error" as const, args: ["c"] } });

    let s = replayReducer(state, log);
    s = replayReducer(s, warn);
    s = replayReducer(s, err);

    expect(s.consoleEntries).toHaveLength(3);
    expect(s.consoleEntries[0]!.method).toBe("log");
    expect(s.consoleEntries[1]!.method).toBe("warn");
    expect(s.consoleEntries[2]!.method).toBe("error");
  });
});

// ─── Errors ────────────────────────────────────────────────────────────────

describe("error.throw", () => {
  it("sets executionFailed to true", () => {
    const state = initialState();
    const event = makeEvent({
      ...baseEvent(1),
      type: "error.throw",
      data: { frameId: "f1", error: new Error("oops"), message: "oops", stack: "Error: oops\n  at foo" },
    });

    const next = replayReducer(state, event);
    expect(next.executionFailed).toBe(true);
  });
});

describe("error.unhandled", () => {
  it("sets executionFailed to true", () => {
    const state = initialState();
    const event = makeEvent({
      ...baseEvent(1),
      type: "error.unhandled",
      data: { promiseId: "p1", reason: new Error("unhandled"), message: "unhandled", stack: "" },
    });

    const next = replayReducer(state, event);
    expect(next.executionFailed).toBe(true);
  });
});

describe("error.reject", () => {
  it("records lastEvent without changing other state", () => {
    const state = initialState();
    const event = makeEvent({
      ...baseEvent(1),
      type: "error.reject",
      data: { promiseId: "p1", reason: "bad", message: "bad" },
    });

    const next = replayReducer(state, event);
    expect(next.lastEvent).toBe(event);
    expect(next.executionFailed).toBe(false);
  });
});

describe("error.catch", () => {
  it("records lastEvent", () => {
    const state = initialState();
    const event = makeEvent({
      ...baseEvent(1),
      type: "error.catch",
      data: { frameId: "f1", error: "err", message: "err" },
    });

    const next = replayReducer(state, event);
    expect(next.lastEvent).toBe(event);
  });
});

// ─── Execution lifecycle ────────────────────────────────────────────────────

describe("execution.start / execution.end", () => {
  it("execution.start tracks the event in eventLog and lastEvent but changes no domain state", () => {
    const state = initialState();
    const event = makeEvent({
      ...baseEvent(1),
      type: "execution.start",
      data: { snippet: "Promise.resolve(1)", entryId: "eval#1" },
    });

    const next = replayReducer(state, event);
    // eventLog and lastEvent change; domain state stays empty
    expect(next.eventLog).toHaveLength(1);
    expect(next.eventLog[0]).toBe(event);
    expect(next.lastEvent).toBe(event);
    expect(next.currentStepIndex).toBe(1);
    expect(next.promises).toEqual(new Map());
    expect(next.frameStack).toHaveLength(0);
    expect(next.reactions).toEqual(new Map());
  });

  it("execution.end tracks the event in eventLog and lastEvent but changes no domain state", () => {
    const state = initialState();
    const event = makeEvent({
      ...baseEvent(10),
      type: "execution.end",
      data: { ok: true },
    });

    const next = replayReducer(state, event);
    expect(next.eventLog).toHaveLength(1);
    expect(next.lastEvent).toBe(event);
    expect(next.currentStepIndex).toBe(1);
    expect(next.executionFailed).toBe(false);
  });

  it("execution.end with ok=false does not set executionFailed (that comes from error.unhandled)", () => {
    const state = initialState();
    const event = makeEvent({
      ...baseEvent(10),
      type: "execution.end",
      data: { ok: false, message: "boom", stack: "" },
    });

    const next = replayReducer(state, event);
    // executionFailed is only set by error.unhandled, not execution.end
    expect(next.executionFailed).toBe(false);
    expect(next.lastEvent).toBe(event);
    expect(next.eventLog).toHaveLength(1);
  });
});

// ─── Immutability ─────────────────────────────────────────────────────────

describe("immutability", () => {
  it("returns a new state object", () => {
    const state = initialState();
    const event = makeEvent({
      ...baseEvent(1),
      type: "promise.create",
      data: { promiseId: "p1", constructor: "Promise" },
    });

    const next = replayReducer(state, event);
    expect(next).not.toBe(state);
  });

  it("does not mutate the original promises map", () => {
    const state = initialState();
    const event = makeEvent({
      ...baseEvent(1),
      type: "promise.create",
      data: { promiseId: "p1", constructor: "Promise" },
    });

    replayReducer(state, event);
    expect(state.promises.has("p1")).toBe(false);
  });

  it("does not mutate the original frameStack array", () => {
    const state = initialState();
    const event = makeEvent({
      ...baseEvent(1),
      type: "frame.enter",
      data: { frameId: "f1", name: "foo", kind: "function", exitSeq: 5, parentSeq: null, startColumn: 1, endColumn: 10, startLine: 1, endLine: 10 },
    });

    replayReducer(state, event);
    expect(state.frameStack).toHaveLength(0);
  });

  it("does not mutate the original microtaskQueue", () => {
    const state = initialState();
    const reg = makeEvent({
      ...baseEvent(1),
      type: "reaction.register",
      data: { reactionId: "r1", promiseId: "p1", handlerType: "then", index: 0 },
    });
    const enq = makeEvent({
      ...baseEvent(2),
      type: "reaction.enqueue",
      data: { reactionId: "r1", promiseId: "p1", queuePosition: 0, queueDepth: 1 },
    });

    const s1 = replayReducer(state, reg);
    replayReducer(s1, enq);
    expect(s1.microtaskQueue.entries).toHaveLength(0);
  });
});

// ─── Unknown event type ────────────────────────────────────────────────────

describe("unknown event type", () => {
  it("returns state unchanged for unknown event types (forward compatibility)", () => {
    const state = initialState();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const event = { ...baseEvent(1), type: "some.future.event", data: { anything: "goes" } as any } as unknown as VPPEvent;

    const next = replayReducer(state, event);
    expect(next).toBe(state);
  });
});

// ─── Full integration ──────────────────────────────────────────────────────

describe("full integration — typical async function execution", () => {
  it("tracks a complete async function execution from start to finish", () => {
    const events: VPPEvent[] = [
      makeEvent({ ...baseEvent(1), type: "execution.start", data: { snippet: "async function run() {}", entryId: "eval#1" } }),
      makeEvent({ ...baseEvent(2), type: "frame.enter", data: { frameId: "f1", name: "run", kind: "async", exitSeq: 20, parentSeq: null, startColumn: 1, endColumn: 50, startLine: 1, endLine: 5 } }),
      makeEvent({ ...baseEvent(3), type: "promise.create", data: { promiseId: "p1", constructor: "Promise" } }),
      makeEvent({ ...baseEvent(4), type: "promise.settle", data: { promiseId: "p1", state: "fulfilled", value: 1 } }),
      makeEvent({ ...baseEvent(5), type: "await.suspend", data: { frameId: "f1", awaitExpr: "Promise.resolve(1)", awaitedPromiseId: "p1" } }),
      makeEvent({ ...baseEvent(6), type: "reaction.register", data: { reactionId: "r1", promiseId: "p1", handlerType: "then", index: 0 } }),
      makeEvent({ ...baseEvent(7), type: "reaction.enqueue", data: { reactionId: "r1", promiseId: "p1", queuePosition: 0, queueDepth: 1 } }),
      makeEvent({ ...baseEvent(8), type: "reaction.run", data: { reactionId: "r1", settlementType: "fulfilled", settlementValue: 1 } }),
      makeEvent({ ...baseEvent(9), type: "promise.reaction.fire", data: { reactionId: "r1", sourcePromiseId: "p1", settlementType: "fulfilled", settlementValue: 1 } }),
      makeEvent({ ...baseEvent(10), type: "await.resume", data: { frameId: "f1", settled: true, value: 1 } }),
      makeEvent({ ...baseEvent(11), type: "console.output", data: { method: "log", args: ["done"] } }),
      makeEvent({ ...baseEvent(12), type: "frame.exit", data: { frameId: "f1", normal: true } }),
      makeEvent({ ...baseEvent(13), type: "execution.end", data: { ok: true } }),
    ];

    let state = initialState(events);
    for (const event of events) {
      state = replayReducer(state, event);
    }

    expect(state.promises.get("p1")!.state).toBe("fulfilled");
    expect(state.promises.get("p1")!.value).toBe(1);
    expect(state.reactions.get("r1")!.status).toBe("complete");
    expect(state.frameStack[0]!.status).toBe("exited");
    expect(state.microtaskQueue.entries).toHaveLength(0);
    expect(state.consoleEntries).toHaveLength(1);
    expect(state.executionFailed).toBe(false);
  });
});
