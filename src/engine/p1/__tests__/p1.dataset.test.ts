import { describe, expect, it } from 'vitest';
import { EXPECTED } from '../../dataset/expected';
import { simulateCaseP1 } from '../index';

/**
 * P1 goal: o motor real deve reproduzir EXACTAMENTE o dataset.
 *
 * Enquanto o P0 usa fixtures (EXPECTED) directamente, estes testes validam que o
 * motor P1 gera a mesma timeline a partir de um modelo executável.
 */
describe('P1 engine — reproduzir dataset', () => {
  it('case 1', () => expect(simulateCaseP1(1)).toEqual(EXPECTED[1]));
  it('case 2', () => expect(simulateCaseP1(2)).toEqual(EXPECTED[2]));
  it('case 3', () => expect(simulateCaseP1(3)).toEqual(EXPECTED[3]));
  it('case 4', () => expect(simulateCaseP1(4)).toEqual(EXPECTED[4]));
  it('case 5', () => expect(simulateCaseP1(5)).toEqual(EXPECTED[5]));
  it('case 6', () => expect(simulateCaseP1(6)).toEqual(EXPECTED[6]));
});
