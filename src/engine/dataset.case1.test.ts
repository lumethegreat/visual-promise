import { describe, expect, it } from 'vitest';
import { simulateCase } from './simulator';
import { EXPECTED } from './dataset/expected';

describe('dataset — caso 1 (async/await basic)', () => {
  it('deve bater certo com o dataset', () => {
    expect(simulateCase(1).steps).toEqual(EXPECTED[1]);
  });
});
