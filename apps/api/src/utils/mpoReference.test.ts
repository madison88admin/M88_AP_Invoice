import { describe, expect, it } from 'vitest';
import { parseMPOReference } from './mpoReference';
import { extractMPONumber } from '../services/madisonInvoiceExtractor';

describe('parseMPOReference', () => {
  it('splits a combined MPO line and material reference', () => {
    expect(parseMPOReference('mpo015958-1-zvt000123')).toEqual({
      raw: 'MPO015958-1-ZVT000123',
      baseMpo: 'MPO015958',
      orderSequence: '1',
      materialCode: 'ZVT000123',
    });
  });

  it('preserves a base-only MPO reference', () => {
    expect(parseMPOReference('MPO015958')).toEqual({
      raw: 'MPO015958',
      baseMpo: 'MPO015958',
      orderSequence: undefined,
      materialCode: undefined,
    });
  });

  it('extracts the complete combined reference from invoice text', () => {
    expect(extractMPONumber('Order reference: MPO015958-1-ZVT000123').value)
      .toBe('MPO015958-1-ZVT000123');
  });

  it('accepts material-before-line references', () => {
    expect(parseMPOReference('MPO00121-ZVT-2')).toEqual({
      raw: 'MPO00121-ZVT-2',
      baseMpo: 'MPO00121',
      orderSequence: '2',
      materialCode: 'ZVT',
    });
  });

  it('normalizes underscore and whitespace separators', () => {
    expect(parseMPOReference(' mpo00121 _ zvt _ 2 ')).toEqual({
      raw: 'MPO00121-ZVT-2',
      baseMpo: 'MPO00121',
      orderSequence: '2',
      materialCode: 'ZVT',
    });
  });

  it('extracts reversed suffixes and returns the canonical line-material order', () => {
    expect(extractMPONumber('Customer PO: MPO00121-ZVT-2').value)
      .toBe('MPO000121-2-ZVT');
  });

  it.each([
    ['MPO15956_PHIL', 'MPO015956-PHIL'],
    ['MPO015954_INDO', 'MPO015954-INDO'],
    ['MPO15079-1', 'MPO015079-1'],
    ['MPO15786-LABELS', 'MPO015786-LABELS'],
    ['MPO015301-ML', 'MPO015301-ML'],
  ])('replays live OCR reference %s', (reference, expected) => {
    expect(extractMPONumber(`Customer PO: ${reference}`).value).toBe(expected);
  });
});
