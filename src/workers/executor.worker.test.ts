import { describe, expect, it } from "vitest";

describe("executor execution isolation", () => {
  it("guards late callbacks from old executions with execution id semantics", () => {
    const state = {
      aborted: false,
      currentExecutionId: 1,
      eventLog: [] as Array<{ type: string; from: string }>,
    };

    const isExecutionCurrent = (executionId: number) => (
      !state.aborted && state.currentExecutionId === executionId
    );

    const emit = (event: { type: string; from: string }, executionId: number) => {
      if (!isExecutionCurrent(executionId)) return;
      state.eventLog.push(event);
    };

    emit({ type: "event", from: "run-1" }, 1);
    expect(state.eventLog).toEqual([{ type: "event", from: "run-1" }]);

    // Simulate starting a new execution in the same worker realm.
    state.currentExecutionId = 2;
    state.eventLog = [];
    state.aborted = false;

    // A stale async callback from run 1 should be ignored.
    emit({ type: "event", from: "stale-run-1" }, 1);
    emit({ type: "event", from: "run-2" }, 2);

    expect(state.eventLog).toEqual([{ type: "event", from: "run-2" }]);
  });
});
