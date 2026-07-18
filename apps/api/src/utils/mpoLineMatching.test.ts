import { describe, expect, it } from 'vitest';
import { matchMPOLines } from './mpoLineMatching';

const lines = [
  {
    line_reference: '1',
    material_id: 17873,
    item_code: 'ZVT000123',
    material_name: 'HH AIR ZERMATT WOVEN CLIP LABEL',
    description: 'Woven Tab Label',
    quantity: 1050,
    unit_price: 0.05,
    total_amount: 52.5,
  },
  {
    line_reference: '2',
    material_id: 17874,
    item_code: 'OTHER001',
    material_name: 'OTHER LABEL',
    description: 'Other label',
    quantity: 500,
    unit_price: 0.1,
    total_amount: 50,
  },
];

describe('matchMPOLines', () => {
  it('resolves the exact line and material under one base MPO', () => {
    const result = matchMPOLines(lines, { orderSequence: '1', materialCode: 'zvt000123' });
    expect(result.error).toBeUndefined();
    expect(result.matchLevel).toBe('MATERIAL_LINE');
    expect(result.lines).toHaveLength(1);
    expect(result.lines[0].material_id).toBe(17873);
  });

  it('uses the material name when the invoice has no material code', () => {
    const result = matchMPOLines(lines, { materialName: 'HH Air Zermatt Woven Clip Label' });
    expect(result.error).toBeUndefined();
    expect(result.lines[0].line_reference).toBe('1');
  });

  it('does not fall back to the whole MPO when the requested line is absent', () => {
    const result = matchMPOLines(lines, { orderSequence: '3', materialCode: 'ZVT000123' });
    expect(result.error).toBe('LINE_NOT_FOUND');
    expect(result.lines).toEqual([]);
  });
});
