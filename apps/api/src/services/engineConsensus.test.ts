import { describe, expect, it } from 'vitest';
import { mergeEngineResults } from './engineConsensus';

describe('mergeEngineResults', () => {
  it('returns empty output for no usable engines', () => {
    const out = mergeEngineResults([]);
    expect(out.data).toEqual({});
    expect(out.base_engine).toBeNull();
    expect(out.engines_used).toEqual([]);
  });

  it('uses the majority value when two engines agree', () => {
    const out = mergeEngineResults([
      { engine: 'groq', data: { invoice_number: 'PCI-26031836', vendor_name: 'PT. PAXAR INDONESIA', total_amount: 54.82 } },
      { engine: 'openrouter', data: { invoice_number: 'PCI-26031836', vendor_name: 'PT. PAXAR INDONESIA', total_amount: 54.82 } },
      { engine: 'regex', data: { invoice_number: 'PCI-26031836', vendor_name: 'PT PAXAR INDONESIA', total_amount: 54.82 } },
    ]);
    expect(out.data.invoice_number).toBe('PCI-26031836');
    expect(out.per_field.invoice_number.consensus).toBe('MAJORITY');
    expect(out.per_field.invoice_number.agreement).toBe(3);
  });

  it('resolves disagreement by deferring to the base (most complete) engine', () => {
    const out = mergeEngineResults([
      { engine: 'groq', data: { invoice_number: 'INV-1', total_amount: 100, brand_code: 'TNF' } },
      { engine: 'openrouter', data: { invoice_number: 'INV-1', total_amount: 100.05, brand_code: 'TNF' } },
    ]);
    expect(out.data.invoice_number).toBe('INV-1');
    expect(out.data.total_amount).toBe(100);
    expect(out.per_field.total_amount.consensus).toBe('TIE');
    expect(out.base_engine).toBe('groq');
  });

  it('normalizes MPO, dates and amounts before comparing', () => {
    const out = mergeEngineResults([
      { engine: 'groq', data: { mpo_number: 'MPO15371', invoice_date: '2026-05-07', total_amount: 37.94 } },
      { engine: 'openrouter', data: { mpo_number: 'MPO015371', invoice_date: '05/07/2026', total_amount: '37.9400' } },
    ]);
    expect(out.per_field.mpo_number.consensus).toBe('MAJORITY');
    expect(out.per_field.invoice_date.consensus).toBe('MAJORITY');
    expect(out.per_field.total_amount.consensus).toBe('MAJORITY');
    // Original (first-provided) value is preserved
    expect(out.data.mpo_number).toBe('MPO15371');
    expect(out.data.invoice_date).toBe('2026-05-07');
    expect(out.data.total_amount).toBe(37.94);
  });

  it('marks fields as SINGLE when only one engine provides them', () => {
    const out = mergeEngineResults([
      { engine: 'groq', data: { invoice_number: 'INV-1' } },
      { engine: 'openrouter', data: { invoice_number: 'INV-1' } },
    ]);
    expect(out.per_field.season.consensus).toBe('MISSING');
    expect(out.per_field.invoice_number.consensus).toBe('MAJORITY');
  });

  it('carries extended fields from the base engine', () => {
    const out = mergeEngineResults([
      { engine: 'openrouter', data: { invoice_number: 'INV-9', swift_code: 'SCBLHKHHXXX', bank_name: 'SCB' } },
      { engine: 'groq', data: { invoice_number: 'INV-9' } },
    ]);
    expect(out.base_engine).toBe('openrouter');
    expect(out.data.swift_code).toBe('SCBLHKHHXXX');
    expect(out.data.bank_name).toBe('SCB');
  });

  it('prefers the engine with the most line items', () => {
    const out = mergeEngineResults([
      { engine: 'groq', data: { invoice_number: 'INV-1', line_items: [{ description: 'A' }] } },
      { engine: 'openrouter', data: { invoice_number: 'INV-1', line_items: [{ description: 'A' }, { description: 'B' }, { description: 'C' }] } },
    ]);
    expect(out.data.line_items).toHaveLength(3);
  });

  it('normalizes vendor names by case and whitespace', () => {
    const out = mergeEngineResults([
      { engine: 'groq', data: { vendor_name: '  PT.   PAXAR INDONESIA ' } },
      { engine: 'openrouter', data: { vendor_name: 'pt. paxar indonesia' } },
    ]);
    expect(out.per_field.vendor_name.consensus).toBe('MAJORITY');
    expect(out.data.vendor_name).toBe('  PT.   PAXAR INDONESIA ');
  });
});
