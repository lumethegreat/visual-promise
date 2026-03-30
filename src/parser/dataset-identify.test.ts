import { describe, expect, it } from 'vitest';
import { identifyDatasetCase } from './identify-dataset-case';
import { SNIPPETS } from '../engine/dataset/snippets';

describe('P2.1 identifyDatasetCase — detecta os 6 snippets', () => {
  it('case 1', () => expect(identifyDatasetCase(SNIPPETS[1])).toEqual({ ok: true, caseId: 1 }));
  it('case 2', () => expect(identifyDatasetCase(SNIPPETS[2])).toEqual({ ok: true, caseId: 2 }));
  it('case 3', () => expect(identifyDatasetCase(SNIPPETS[3])).toEqual({ ok: true, caseId: 3 }));
  it('case 4', () => expect(identifyDatasetCase(SNIPPETS[4])).toEqual({ ok: true, caseId: 4 }));
  it('case 5', () => expect(identifyDatasetCase(SNIPPETS[5])).toEqual({ ok: true, caseId: 5 }));
  it('case 6', () => expect(identifyDatasetCase(SNIPPETS[6])).toEqual({ ok: true, caseId: 6 }));
});
