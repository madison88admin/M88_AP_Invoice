import { describe, it, expect } from 'vitest';
import {
  isLocalOnlySelection,
  toggleId,
  splitServerAndLocalSelections,
  retainLocalSelections,
  toPayableIds,
} from './queueSelection';

// Regression: the queue returns AWAITING_POSTING invoices with synthetic
// `inv-<invoiceId>` ids (they have no Payment row yet). Sending those ids to
// the server selectPayments endpoint used to throw "Some payments are not
// found, already in a batch, or not in SCHEDULED status", which made it
// impossible to select-and-bulk-post awaiting invoices. These tests pin the
// local-only selection flow so that regression can never come back.
const rows = [
  // AWAITING_POSTING: invoice without a Payment record → synthetic id
  { id: 'inv-aaaa1111-bbbb-4ccc-8ddd-eeeeeeeeeeee', status: 'AWAITING_POSTING', invoice: { invoice_number: 'INV-1' } },
  { id: 'inv-ffff2222-bbbb-4ccc-8ddd-eeeeeeeeeeee', status: 'AWAITING_POSTING', invoice: { invoice_number: 'INV-2' } },
  // Real payments
  { id: 'pay-11111111-2222-3333-4444-555555555555', status: 'SCHEDULED', invoice: { invoice_number: 'INV-3' } },
  { id: 'pay-66666666-2222-3333-4444-555555555555', status: 'APPROVED_FOR_PAYMENT', invoice: { invoice_number: 'INV-4' } },
  { id: 'pay-99999999-2222-3333-4444-555555555555', status: 'FOR_PAYMENT', invoice: { invoice_number: 'INV-5' } },
  { id: 'pay-aaaaaaaa-2222-3333-4444-555555555555', status: 'HELD_BELOW_100', invoice: { invoice_number: 'INV-6' } },
];

describe('queue selection helpers', () => {
  it('treats only AWAITING_POSTING as local-only (synthetic-id) selection', () => {
    expect(isLocalOnlySelection('AWAITING_POSTING')).toBe(true);
    expect(isLocalOnlySelection('SCHEDULED')).toBe(false);
    expect(isLocalOnlySelection('APPROVED_FOR_PAYMENT')).toBe(false);
  });

  it('splits a mixed selection: awaiting ids stay local, real payments go to the server', () => {
    const selected = ['inv-aaaa1111-bbbb-4ccc-8ddd-eeeeeeeeeeee', 'pay-11111111-2222-3333-4444-555555555555'];
    const { serverIds, localIds } = splitServerAndLocalSelections(rows, selected);
    expect(localIds).toEqual(['inv-aaaa1111-bbbb-4ccc-8ddd-eeeeeeeeeeee']);
    expect(serverIds).toEqual(['pay-11111111-2222-3333-4444-555555555555']);
  });

  it('never sends a synthetic awaiting id to the server select/deselect endpoints', () => {
    const selected = rows.map((r) => r.id); // select-all case
    const { serverIds, localIds } = splitServerAndLocalSelections(rows, selected);
    expect(localIds).toHaveLength(2);
    expect(localIds.every((id) => id.startsWith('inv-'))).toBe(true);
    expect(serverIds.every((id) => !id.startsWith('inv-'))).toBe(true);
    expect(serverIds).toHaveLength(4);
  });

  it('toggleId adds and removes ids without mutating the previous set', () => {
    const prev = new Set(['a']);
    const added = toggleId(prev, 'b');
    expect(Array.from(added)).toEqual(['a', 'b']);
    expect(Array.from(prev)).toEqual(['a']);
    expect(Array.from(toggleId(added, 'a'))).toEqual(['b']);
  });

  it('retains awaiting selections across a queue refresh', () => {
    const prev = new Set(['inv-aaaa1111-bbbb-4ccc-8ddd-eeeeeeeeeeee', 'gone-id']);
    const kept = retainLocalSelections(prev, rows);
    expect(Array.from(kept)).toEqual(['inv-aaaa1111-bbbb-4ccc-8ddd-eeeeeeeeeeee']);
  });

  it('drops an awaiting selection once the invoice is posted and leaves the queue', () => {
    // After posting, the invoice no longer appears as AWAITING_POSTING.
    const afterPost = rows.filter((r) => r.id !== 'inv-aaaa1111-bbbb-4ccc-8ddd-eeeeeeeeeeee');
    const kept = retainLocalSelections(new Set(['inv-aaaa1111-bbbb-4ccc-8ddd-eeeeeeeeeeee']), afterPost);
    expect(kept.size).toBe(0);
  });

  it('excludes awaiting invoices from batch-creation ids', () => {
    const selected = new Set([
      'inv-aaaa1111-bbbb-4ccc-8ddd-eeeeeeeeeeee', // awaiting — not payable
      'pay-11111111-2222-3333-4444-555555555555', // scheduled — payable
    ]);
    expect(toPayableIds(rows, selected)).toEqual(['pay-11111111-2222-3333-4444-555555555555']);
  });

  it('keeps only awaiting rows when awaiting + payments are selected', () => {
    // Post-Selected bulk action must operate on the awaiting subset only
    const awaitingOnly = rows.filter((r) => isLocalOnlySelection(r.status));
    const selected = new Set(['inv-aaaa1111-bbbb-4ccc-8ddd-eeeeeeeeeeee', 'pay-11111111-2222-3333-4444-555555555555']);
    const awaitingInSelection = awaitingOnly.filter((r) => selected.has(r.id)).map((r) => r.id);
    expect(awaitingInSelection).toEqual(['inv-aaaa1111-bbbb-4ccc-8ddd-eeeeeeeeeeee']);
  });
});
