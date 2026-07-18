import { Response, NextFunction } from 'express';
import { AuthRequest } from '../middleware/auth';
import prisma from '../config/database';
import { AppError } from '../middleware/errorHandler';
import { logAudit } from '../services/auditLogService';
import { fieldDecisionEngine } from '../services/fieldDecisionEngine';
import { correctionLogService } from '../services/correctionLogService';

const invoiceInclude = { vendor: true, invoice_lines: true, parent_invoice: true, child_invoices: true } as const;

export async function queue(_req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const invoices = await prisma.invoice.findMany({ include: invoiceInclude, orderBy: { created_at: 'desc' }, take: 200 });
    const effectiveLines = invoices.flatMap(i => i.invoice_lines.length ? i.invoice_lines : [{ id: `invoice:${i.id}`, invoice_id: i.id, line_number: 1, description: i.material_name, mpo_base_number: i.mpo_base_number, mpo_order_sequence: i.mpo_order_sequence, material_code: i.material_code, material_name: i.material_name, quantity: i.qty_shipped, selling_quantity: null, unit_price: i.qty_shipped ? Number(i.total_amount) / i.qty_shipped : null, line_amount: i.total_amount, match_status: 'HEADER_FALLBACK' } as any]);
    const lines = effectiveLines;
    const consumption = new Map<string, number>();
    const amountConsumption = new Map<string, number>();
    for (const line of lines) {
      const key = [line.mpo_base_number, line.mpo_order_sequence, line.material_code].join('|');
      consumption.set(key, (consumption.get(key) || 0) + Number(line.quantity || 0));
      amountConsumption.set(key, (amountConsumption.get(key) || 0) + Number(line.line_amount || 0));
    }
    res.json(invoices.map(invoice => ({
      ...invoice,
      field_confidence: (invoice.ocr_raw_data as any)?.field_decision?.fields || (invoice.ocr_raw_data as any)?.field_confidence || {},
      invoice_lines: effectiveLines.filter(line => line.invoice_id === invoice.id).map(line => {
        const key = [line.mpo_base_number, line.mpo_order_sequence, line.material_code].join('|');
        const ordered = Number((invoice.po_validation as any)?.nextgen_data?.line_items?.find((x: any) =>
          (!line.material_code || [x.material_code, x.item_code].includes(line.material_code)))?.quantity || 0);
        const nextgenLine = (invoice.po_validation as any)?.nextgen_data?.line_items?.find((x: any) =>
          (!line.material_code || [x.material_code, x.item_code].includes(line.material_code)));
        const orderedAmount = Number(nextgenLine?.amount || nextgenLine?.total_amount || nextgenLine?.line_amount || 0);
        const invoiced = consumption.get(key) || 0;
        const invoicedAmount = amountConsumption.get(key) || 0;
        const currentQuantity = Number(line.quantity || 0);
        const previouslyInvoiced = Math.max(0, invoiced - currentQuantity);
        const received = Number(line.received_quantity ?? nextgenLine?.received_quantity ?? nextgenLine?.quantity_received ?? 0);
        const accepted = Number(line.accepted_quantity ?? nextgenLine?.accepted_quantity ?? nextgenLine?.quantity_accepted ?? received);
        const receivableLimit = accepted || received || ordered;
        const remainingBeforeInvoice = receivableLimit ? receivableLimit - previouslyInvoiced : null;
        const alerts = [
          ordered && invoiced > ordered ? {
            type: 'QUANTITY_EXCEEDS_MPO',
            severity: 'error',
            message: `Invoiced quantity ${invoiced} exceeds ordered quantity ${ordered}.`,
          } : null,
          ordered && invoiced > ordered * 0.95 && invoiced <= ordered ? {
            type: 'QUANTITY_NEAR_FULLY_CONSUMED',
            severity: 'warning',
            message: `MPO/material is ${Math.round((invoiced / ordered) * 100)}% consumed.`,
          } : null,
          orderedAmount && invoicedAmount > orderedAmount ? {
            type: 'AMOUNT_EXCEEDS_MPO',
            severity: 'error',
            message: `Invoiced amount ${invoicedAmount.toFixed(2)} exceeds ordered amount ${orderedAmount.toFixed(2)}.`,
          } : null,
          line.mpo_base_number && !line.material_code ? {
            type: 'MATERIAL_MISSING',
            severity: 'warning',
            message: 'MPO was detected but no material code is available for line-level matching.',
          } : null,
          line.material_code && !nextgenLine && (invoice.po_validation as any)?.nextgen_data?.line_items?.length ? {
            type: 'MATERIAL_NOT_FOUND_IN_MPO',
            severity: 'error',
            message: `Material ${line.material_code} was not found in the NextGen MPO line list.`,
          } : null,
          ordered && !received ? {
            type: 'RECEIPT_NOT_AVAILABLE',
            severity: 'warning',
            message: 'No goods receipt or accepted quantity is available; three-way match requires manual confirmation.',
          } : null,
          remainingBeforeInvoice != null && currentQuantity > remainingBeforeInvoice ? {
            type: 'QUANTITY_EXCEEDS_RECEIVED_BALANCE',
            severity: 'error',
            message: `Invoice quantity ${currentQuantity} exceeds remaining received/accepted balance ${remainingBeforeInvoice}.`,
          } : null,
        ].filter(Boolean);
        return {
          ...line,
          ordered_quantity: ordered || null,
          invoiced_quantity: invoiced,
          remaining_quantity: ordered ? ordered - invoiced : null,
          ordered_amount: orderedAmount || null,
          invoiced_amount: invoicedAmount,
          remaining_amount: orderedAmount ? orderedAmount - invoicedAmount : null,
          received_quantity: received || null,
          accepted_quantity: accepted || null,
          previously_invoiced_quantity: previouslyInvoiced,
          remaining_receivable_quantity: receivableLimit ? receivableLimit - invoiced : null,
          three_way_match_status: !ordered
            ? 'NO_PO'
            : !received ? 'RECEIPT_REQUIRED'
            : remainingBeforeInvoice != null && currentQuantity > remainingBeforeInvoice ? 'OVER_RECEIPT'
            : 'MATCHED',
          tolerance_alerts: alerts,
        };
      }),
    })));
  } catch (e) { next(e); }
}

export async function updateLine(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    let line: any = req.params.lineId.startsWith('invoice:') ? null : await prisma.invoiceLine.findUnique({ where: { id: req.params.lineId }, include: { invoice: true } });
    if (!line && req.params.lineId.startsWith('invoice:')) {
      const invoice = await prisma.invoice.findUnique({ where: { id: req.params.lineId.slice(8) } });
      if (invoice) line = await prisma.invoiceLine.create({ data: { invoice_id: invoice.id, line_number: 1, description: invoice.material_name, mpo_base_number: invoice.mpo_base_number, mpo_order_sequence: invoice.mpo_order_sequence, material_code: invoice.material_code, material_name: invoice.material_name, quantity: invoice.qty_shipped, line_amount: invoice.total_amount, match_status: 'PENDING' }, include: { invoice: true } });
    }
    if (!line) throw new AppError('Invoice line not found', 404);
    const allowed = ['description','mpo_base_number','mpo_order_sequence','material_code','material_name','quantity','selling_quantity','unit_price','line_amount','received_quantity','accepted_quantity','match_status'];
    const data = Object.fromEntries(Object.entries(req.body).filter(([k]) => allowed.includes(k)));
    const updated = await prisma.invoiceLine.update({ where: { id: line.id }, data: data as any });
    await correctionLogService.saveCorrection({ invoice_id: line.invoice_id, vendor_name: line.invoice.vendor_name_raw, original_fields: line as any, corrected_fields: data as any, note: req.body.note || 'Line validation correction' });
    await logAudit({ invoice_id: line.invoice_id, performed_by: req.user!.id, action: 'INVOICE_LINE_CORRECTED', note: `Line ${line.line_number} corrected: ${Object.keys(data).join(', ')}` });
    res.json(updated);
  } catch (e) { next(e); }
}

export async function relate(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { parent_invoice_id, relationship } = req.body;
    if (!parent_invoice_id || !['PROFORMA_TO_FINAL','REVISION_OF'].includes(relationship)) throw new AppError('Valid parent invoice and relationship are required', 400);
    const child = await prisma.invoice.findUnique({ where: { id: req.params.id } });
    if (!child || child.id === parent_invoice_id) throw new AppError('Invalid invoice relationship', 400);
    const updated = await prisma.invoice.update({ where: { id: child.id }, data: { parent_invoice_id, revision: relationship === 'REVISION_OF' ? { increment: 1 } : undefined } });
    await logAudit({ invoice_id: child.id, performed_by: req.user!.id, action: relationship, note: `Linked to ${parent_invoice_id}` });
    res.json(updated);
  } catch (e) { next(e); }
}

export async function duplicates(_req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const flagged = await prisma.invoice.findMany({ where: { is_duplicate: true }, include: invoiceInclude, orderBy: { created_at: 'desc' } });
    const pairs = await Promise.all(flagged.map(async invoice => {
      const match = await prisma.invoice.findFirst({ where: { id: { not: invoice.id }, vendor_id: invoice.vendor_id, OR: [{ invoice_number: invoice.invoice_number }, { total_amount: invoice.total_amount }] }, include: invoiceInclude });
      return { invoice, match };
    }));
    res.json(pairs.filter(x => x.match));
  } catch (e) { next(e); }
}

export async function resolveDuplicate(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { resolution, related_invoice_id, note } = req.body;
    if (!['KEEP_BOTH','MARK_DUPLICATE','PROFORMA_TO_FINAL','REVISION_OF'].includes(resolution)) throw new AppError('Invalid duplicate resolution', 400);
    const data: any = { is_duplicate: resolution === 'MARK_DUPLICATE' };
    if (['PROFORMA_TO_FINAL','REVISION_OF'].includes(resolution)) data.parent_invoice_id = related_invoice_id;
    const invoice = await prisma.invoice.update({ where: { id: req.params.id }, data });
    await logAudit({ invoice_id: invoice.id, performed_by: req.user!.id, action: `DUPLICATE_${resolution}`, note });
    res.json(invoice);
  } catch (e) { next(e); }
}

export async function learningRules(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const status = String(req.query.status || 'pending');
    const where = status === 'approved'
      ? { approved_for_learning: true, disabled_at: null }
      : status === 'disabled'
      ? { disabled_at: { not: null } }
      : { approved_for_learning: false, disabled_at: null };
    const rules = await prisma.correctionLog.findMany({
      where,
      orderBy: { created_at: 'desc' },
      take: 200,
    });
    res.json(rules);
  } catch (e) { next(e); }
}

export async function approveLearningRule(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const rule = await prisma.correctionLog.update({
      where: { id: req.params.id },
      data: {
        approved_for_learning: true,
        approved_by: req.user!.id,
        approved_at: new Date(),
        disabled_at: null,
      },
    });
    fieldDecisionEngine.invalidateLearningCache(rule.vendor_name || undefined);
    await logAudit({ performed_by: req.user!.id, action: 'EXTRACTION_RULE_APPROVED', note: `Approved correction ${rule.id} for vendor ${rule.vendor_name || 'unknown'}` });
    res.json(rule);
  } catch (e) { next(e); }
}

export async function disableLearningRule(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const rule = await prisma.correctionLog.update({
      where: { id: req.params.id },
      data: { approved_for_learning: false, disabled_at: new Date() },
    });
    fieldDecisionEngine.invalidateLearningCache(rule.vendor_name || undefined);
    await logAudit({ performed_by: req.user!.id, action: 'EXTRACTION_RULE_DISABLED', note: req.body.note || `Disabled correction ${rule.id}` });
    res.json(rule);
  } catch (e) { next(e); }
}
