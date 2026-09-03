// Pure selection helpers for the Accounting Payment Queue checkbox flow.
//
// Regression guard: invoices that are AWAITING_POSTING have NO Payment row yet,
// so the queue gives them synthetic `inv-<invoiceId>` ids. Sending those ids to
// the server-side select/deselect endpoints fails with "Some payments are not
// found, already in a batch, or not in SCHEDULED status". Their checkbox
// selection must therefore be LOCAL-only (used for the "Post Selected" bulk
// action), while real payments (SCHEDULED / APPROVED_FOR_PAYMENT / …) keep
// their server-persisted batch selection.

export interface QueueRowLike {
  id: string;
  status: string;
}

export const AWAITING_POSTING = 'AWAITING_POSTING';

/** Awaiting-posting rows are selectable only in local UI state, never server-side. */
export function isLocalOnlySelection(status: string): boolean {
  return status === AWAITING_POSTING;
}

/** Toggle an id inside a Set, returning a fresh Set (React-friendly). */
export function toggleId(prev: ReadonlySet<string>, id: string): Set<string> {
  const next = new Set(prev);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}

/**
 * Partition a selection into ids that must go to the server endpoints
 * (`serverIds` — real payments) and ids kept only in local state
 * (`localIds` — awaiting-posting rows with synthetic ids).
 */
export function splitServerAndLocalSelections(
  rows: QueueRowLike[],
  ids: Iterable<string>
): { serverIds: string[]; localIds: string[] } {
  const wanted = new Set(ids);
  const serverIds: string[] = [];
  const localIds: string[] = [];
  for (const row of rows) {
    if (!wanted.has(row.id)) continue;
    if (isLocalOnlySelection(row.status)) localIds.push(row.id);
    else serverIds.push(row.id);
  }
  return { serverIds, localIds };
}

/**
 * Keep only the local awaiting-posting selections that still exist as
 * AWAITING_POSTING in the freshly reloaded queue. Rows that were posted (and
 * thus dropped out of the awaiting list) are removed automatically — this is
 * what makes the select-then-"Post Selected" flow clean up after reload.
 */
export function retainLocalSelections(
  prev: ReadonlySet<string>,
  rows: QueueRowLike[]
): Set<string> {
  const kept = new Set<string>();
  for (const row of rows) {
    if (row.status === AWAITING_POSTING && prev.has(row.id)) kept.add(row.id);
  }
  return kept;
}

/**
 * Payment ids eligible for server-side batch creation — awaiting-posting
 * invoices are excluded because they have no Payment record to batch yet.
 */
export function toPayableIds(rows: QueueRowLike[], selected: ReadonlySet<string>): string[] {
  const payable: string[] = [];
  for (const row of rows) {
    if (selected.has(row.id) && !isLocalOnlySelection(row.status)) payable.push(row.id);
  }
  return payable;
}
