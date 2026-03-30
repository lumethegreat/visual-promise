import { describe, expect, it } from 'vitest';
import { SNIPPETS } from '../dataset/snippets';
import { EXPECTED } from '../dataset/expected';
import { simulateFromCode } from './simulate-from-code';

describe('P2.1 simulateFromCode — dataset-first', () => {
  it('case 1', () => {
    const r = simulateFromCode(SNIPPETS[1]);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.steps).toEqual(EXPECTED[1]);
  });

  it('case 6', () => {
    const r = simulateFromCode(SNIPPETS[6]);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.steps).toEqual(EXPECTED[6]);
  });
});
