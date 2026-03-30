import { describe, expect, it } from 'vitest';
import { simulateCase } from './simulator';
import { EXPECTED } from './dataset/expected';

describe('dataset — todos os casos (1..6)', () => {
  it('caso 1', () => expect(simulateCase(1).steps).toEqual(EXPECTED[1]));
  it('caso 2', () => expect(simulateCase(2).steps).toEqual(EXPECTED[2]));
  it('caso 3', () => expect(simulateCase(3).steps).toEqual(EXPECTED[3]));
  it('caso 4', () => expect(simulateCase(4).steps).toEqual(EXPECTED[4]));
  it('caso 5', () => expect(simulateCase(5).steps).toEqual(EXPECTED[5]));
  it('caso 6', () => expect(simulateCase(6).steps).toEqual(EXPECTED[6]));
});
