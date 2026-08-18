import prisma from '../config/database';
import { getApprovalReadiness } from '../services/approvalReadinessService';
import { validateMultiMpoAllocations } from '../services/multiMpoControlService';
import { nextGenService } from '../services/nextGenService';
import { runAnomalyScan, runFourWayReconciliation } from '../services/financeControlRunService';

async function main() {
  if (!/ap_invoice_staging_/i.test(process.env.DATABASE_URL || '')) throw new Error('Refusing UAT: DATABASE_URL is not an isolated staging database');
  const invoiceCount = await prisma.invoice.count();
  const columns = await prisma.$queryRaw<Array<{ column_name: string }>>`
    SELECT column_name FROM information_schema.columns
    WHERE table_schema = 'AP_Invoice' AND table_name = 'APInvoice_InvoiceLine'
  `;
  const names = new Set(columns.map(c => c.column_name));
  for (const required of ['nextgen_unit_price', 'remaining_invoiceable_amount', 'previously_invoiced_amount']) {
    if (!names.has(required)) throw new Error(`Missing migrated column ${required}`);
  }

  const readiness = getApprovalReadiness({ vendor_id: 'uat-vendor', invoice_number: 'UAT-MULTI', invoice_date: new Date(), currency: 'USD', total_amount: 35, brand: 'UAT', season: 'UAT', due_date: new Date(), pdf_path: 'uat.pdf', mpo_number: 'MPO001', invoice_lines: [
    { line_number: 1, mpo_base_number: 'MPO001', material_code: 'MAT1', quantity: 2, unit_price: 10, line_amount: 20 },
    { line_number: 2, mpo_base_number: 'MPO002', material_code: 'MAT2', quantity: 3, unit_price: 5, line_amount: 15 },
  ] });
  if (!readiness.ready) throw new Error(`Required-field UAT failed: ${JSON.stringify(readiness.missing)}`);
  const mpo = validateMultiMpoAllocations({ invoice_lines: [
    { line_number: 1, mpo_base_number: 'MPO001', mpo_order_sequence: '1', material_code: 'MAT1', matched_nextgen_line_id: '1', match_status: 'MATCHED', quantity: 2, unit_price: 10, nextgen_unit_price: 10, line_amount: 20 },
    { line_number: 2, mpo_base_number: 'MPO002', mpo_order_sequence: '1', material_code: 'MAT2', matched_nextgen_line_id: '2', match_status: 'MATCHED', quantity: 3, unit_price: 5, nextgen_unit_price: 5, line_amount: 15 },
  ] });
  if (mpo.issues.length || mpo.subtotals.length !== 2) throw new Error('Multi-MPO subtotal UAT failed');

  const candidate = await prisma.invoiceLine.findFirst({ where: { mpo_base_number: { not: null }, material_code: { not: null } }, include: { invoice: { include: { vendor: true } } } });
  let nextGen = { attempted: false, found: false, lineItems: 0 };
  if (candidate?.mpo_base_number) {
    const po = await nextGenService.fetchPOByMPO(candidate.mpo_base_number, { vendor_name: candidate.invoice.vendor.name, material_code: candidate.material_code || undefined });
    nextGen = { attempted: true, found: Boolean(po), lineItems: po?.line_items?.length || 0 };
  }

  const anomaly = await runAnomalyScan('staging-uat');
  const reconciliation = await runFourWayReconciliation('staging-uat');
  console.log(JSON.stringify({ status: 'PASS', invoiceCount, migratedColumns: true, requiredFieldGate: true, multiMpoSubtotals: mpo.subtotals, nextGen, anomalyFindings: anomaly.findings.length, reconciliationFindings: reconciliation.findings.length }, null, 2));
}

main().catch(error => { console.error(JSON.stringify({ status: 'FAIL', error: error.message })); process.exitCode = 1; }).finally(() => prisma.$disconnect());
