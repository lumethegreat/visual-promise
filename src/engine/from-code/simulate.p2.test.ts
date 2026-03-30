import { describe, expect, it } from 'vitest';
import { simulate } from './simulate';

function outputs(steps: Array<{ output?: string }>) {
  return steps.flatMap((s) => (s.output ? [s.output] : []));
}

describe('P2.2 simulate(code) — subset (Promise chains)', () => {
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
});
