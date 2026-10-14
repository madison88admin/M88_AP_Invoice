import crypto from 'crypto';
import prisma from '../config/database';

type PrismaLike = any;

function bankSnapshotHash(input: Record<string, unknown>): string {
  return crypto.createHash('sha256').update(JSON.stringify(input)).digest('hex');
}

async function loadInvoiceBankValues(invoiceId: string, client: PrismaLike) {
  const invoice = await client.invoice.findUnique({
    where: { id: invoiceId },
    include: { vendor: true },
  });
  if (!invoice) return null;
  const values = {
    vendor_id: invoice.vendor_id || null,
    vendor_bank_version_id: null as string | null,
    beneficiary_name: invoice.beneficiary_name || invoice.vendor?.beneficiary_name || invoice.vendor?.name || null,
    bank_name: invoice.bank_name || invoice.vendor?.bank_name || null,
    bank_address: invoice.vendor?.bank_address || null,
    account_number: invoice.account_number || invoice.vendor?.account_number || null,
    swift_code: invoice.swift_code || invoice.vendor?.swift_code || null,
    iban: invoice.vendor?.iban || null,
    sort_code: invoice.vendor?.sort_code || null,
    aba_routing_number: invoice.vendor?.aba_routing_number || null,
    intermediary_bank_name: invoice.vendor?.intermediary_bank_name || null,
    intermediary_bank_swift: invoice.vendor?.intermediary_bank_swift || null,
  };
  if (invoice.vendor_id && client.vendorBankVersion?.findFirst) {
    const version = await client.vendorBankVersion.findFirst({
      where: { vendor_id: invoice.vendor_id, status: 'ACTIVE' },
      orderBy: { version: 'desc' },
      select: { id: true },
    });
    values.vendor_bank_version_id = version?.id || null;
  }
  return { invoice, values };
}

async function appendSnapshotRevision(invoiceId: string, values: Record<string, unknown>, capturedBy: string | undefined, source: string, client: PrismaLike) {
  const revisions = client.invoiceBankSnapshotRevision;
  if (!revisions?.create || !revisions?.findFirst) return;
  const snapshotHash = bankSnapshotHash(values);
  const latest = await revisions.findFirst({ where: { invoice_id: invoiceId }, orderBy: { revision: 'desc' }, select: { revision: true, snapshot_hash: true } });
  if (latest?.snapshot_hash === snapshotHash) return;
  // InvoiceBankSnapshot stores vendor_id, but the append-only revision table
  // intentionally stores only the bank snapshot fields. Do not spread
  // vendor_id into the revision create payload; older Prisma clients correctly
  // reject that unknown column and would otherwise fail the entire intake after
  // OCR had already succeeded.
  const { vendor_id: _vendorId, ...revisionValues } = values;
  await revisions.create({
    data: {
      invoice_id: invoiceId,
      revision: (latest?.revision || 0) + 1,
      ...revisionValues,
      snapshot_hash: snapshotHash,
      captured_by: capturedBy || null,
      source,
    },
  });
}

/**
 * Capture the invoice's confirmed bank details once.  This is intentionally
 * idempotent: later vendor-master edits can trigger a reassessment, but never
 * rewrite the invoice-level snapshot.
 */
export async function ensureInvoiceBankSnapshot(
  invoiceId: string,
  capturedBy?: string,
  client: PrismaLike = prisma,
  source = 'INVOICE_INTAKE',
) {
  // Keep lightweight service doubles/backfills compatible while the generated
  // Prisma client rolls out; production clients always expose this model.
  if (!(client as any).invoiceBankSnapshot) return null;
  const existing = await client.invoiceBankSnapshot.findUnique({ where: { invoice_id: invoiceId } });
  if (existing) return existing;

  const loaded = await loadInvoiceBankValues(invoiceId, client);
  if (!loaded) return null;
  const { values } = loaded;

  const snapshot = await client.invoiceBankSnapshot.create({
    data: {
      invoice_id: invoiceId,
      ...values,
      snapshot_hash: bankSnapshotHash(values),
      captured_by: capturedBy || null,
      source,
    },
  });
  await appendSnapshotRevision(invoiceId, values, capturedBy, source, client);
  return snapshot;
}

/** Capture an authorized invoice-level bank correction while retaining the
 * previous snapshot in the append-only revision table. */
export async function captureInvoiceBankSnapshotRevision(invoiceId: string, capturedBy?: string, source = 'AUTHORIZED_INVOICE_BANK_UPDATE', client: PrismaLike = prisma) {
  if (!(client as any).invoiceBankSnapshot) return null;
  const loaded = await loadInvoiceBankValues(invoiceId, client);
  if (!loaded) return null;
  const { values } = loaded;
  const snapshotHash = bankSnapshotHash(values);
  const current = await client.invoiceBankSnapshot.findUnique({ where: { invoice_id: invoiceId } });
  if (!current) return ensureInvoiceBankSnapshot(invoiceId, capturedBy, client, source);
  if (current.snapshot_hash === snapshotHash) return current;
  await appendSnapshotRevision(invoiceId, values, capturedBy, source, client);
  return client.invoiceBankSnapshot.update({
    where: { invoice_id: invoiceId },
    data: { ...values, snapshot_hash: snapshotHash, captured_by: capturedBy || null, captured_at: new Date(), source },
  });
}

export async function getInvoiceBankSnapshot(invoiceId: string, client: PrismaLike = prisma) {
  return client.invoiceBankSnapshot.findUnique({ where: { invoice_id: invoiceId } });
}

