import { describe, expect, it } from 'vitest';
import { simulate } from './simulate';

function outputs(steps: Array<{ output?: string }>) {
  return steps.flatMap((s) => (s.output ? [s.output] : []));
}

describe('P2.2 simulate(code) — subset (chains + multi-statement + async fn calls)', () => {
  it('Promise.resolve().then(A).then(B) => A,B', () => {
    const r = simulate(`Promise.resolve().then(() => console.log("A")).then(() => console.log("B"));`);
    expect(r.ok).toBe(true);
    if (r.ok) expect(outputs(r.steps)).toEqual(['A', 'B']);
  });

  it('Promise.reject().then(A).catch(B) => B', () => {
    const r = simulate(`Promise.reject().then(() => console.log("A")).catch(() => console.log("B"));`);
    expect(r.ok).toBe(true);
    if (r.ok) expect(outputs(r.steps)).toEqual(['B']);
  });

  it('Promise.resolve().finally(F).then(T) => F,T', () => {
    const r = simulate(`Promise.resolve("x").finally(() => console.log("F")).then(() => console.log("T"));`);
    expect(r.ok).toBe(true);
    if (r.ok) expect(outputs(r.steps)).toEqual(['F', 'T']);
  });

  it('multi-statement: async fn call + Promise.then ordering (like case2, but different names)', () => {
    const code = `async function foo() {
  await Promise.resolve();
  console.log("A1");
}

foo();
Promise.resolve().then(() => console.log("B1"));
`;
    const r = simulate(code);
    expect(r.ok).toBe(true);
    if (r.ok) expect(outputs(r.steps)).toEqual(['A1', 'B1']);
  });

  it('async function with multiple awaits (subset)', () => {
    const code = `async function f2() {
  console.log("A");
  await Promise.resolve();
  console.log("B");
}

f2();
`;
    const r = simulate(code);
    expect(r.ok).toBe(true);
    if (r.ok) expect(outputs(r.steps)).toEqual(['A', 'B']);
  });

  it('handler calls inner async (subset; like case6 but different names)', () => {
    const code = `const inner2 = async () => {
  await Promise.resolve();
  console.log("X1");
};

Promise.resolve()
  .then(async () => {
    inner2();
  })
  .then(() => {
    console.log("Y1");
  });
`;

    const r = simulate(code);
    expect(r.ok).toBe(true);
    if (r.ok) expect(outputs(r.steps)).toEqual(['X1', 'Y1']);
  });

  it('handler awaits inner async (subset; await inner2() changes ordering)', () => {
    const code = `const inner2 = async () => {
  await Promise.resolve();
  console.log("X1");
};

Promise.resolve()
  .then(async () => {
    await inner2();
    console.log("Z1");
  })
  .then(() => {
    console.log("Y1");
  });
`;

    const r = simulate(code);
    expect(r.ok).toBe(true);
    if (r.ok) expect(outputs(r.steps)).toEqual(['X1', 'Z1', 'Y1']);
  });

  it('handler returns inner async (subset; return inner2() behaves like awaiting for chain)', () => {
    const code = `const inner2 = async () => {
  await Promise.resolve();
  console.log("X1");
};

Promise.resolve()
  .then(async () => {
    return inner2();
    console.log("Z1");
  })
  .then(() => {
    console.log("Y1");
  });
`;

    const r = simulate(code);
    expect(r.ok).toBe(true);
    if (r.ok) expect(outputs(r.steps)).toEqual(['X1', 'Y1']);
  });
});
