require('dotenv').config({ path: __dirname + '/../../.env' });
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const GARBAGE_VENDOR_NAMES = [
  'account no', 'invoice', 'invoice invoice', 'invoice invoice no',
  'tax invoice', 'bill to', 'ship to', 'sold to', 'total', 'amount',
  'description', 'quantity', 'unit price', 'no.', 'date',
];
const GARBAGE_INVOICE_NUMBERS = [
  'invoice', 'invoice no', 'invoice number', 'no', 'no.', 'number',
  'account no', 'tax invoice',
];

function isGarbageValue(value, garbageList) {
  if (!value || !value.trim()) return true;
  const lower = value.trim().toLowerCase();
  if (garbageList.some(g => lower === g || lower === g + ' no')) return true;
  if (lower.length < 2) return true;
  const words = lower.split(/\s+/);
  if (words.length >= 2 && words.every(w => w === words[0])) return true;
  return false;
}

function isValidAmount(amount) {
  if (!amount || isNaN(amount) || amount <= 0) return false;
  if (amount > 10000000) return false;
  return true;
}

function isValidDate(dateStr) {
  if (!dateStr || !dateStr.trim()) return false;
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return false;
  const year = d.getFullYear();
  return year >= 2010 && year <= 2030;
}

function calculateRealConfidence(extracted) {
  let score = 0;
  if (extracted.vendor_name && !isGarbageValue(extracted.vendor_name, GARBAGE_VENDOR_NAMES)) {
    score += 20;
  } else if (extracted.vendor_name && isGarbageValue(extracted.vendor_name, GARBAGE_VENDOR_NAMES)) {
    score -= 15;
  }
  if (extracted.invoice_number && !isGarbageValue(extracted.invoice_number, GARBAGE_INVOICE_NUMBERS)) {
    score += 15;
  } else if (extracted.invoice_number && isGarbageValue(extracted.invoice_number, GARBAGE_INVOICE_NUMBERS)) {
    score -= 10;
  }
  if (isValidAmount(Number(extracted.total_amount))) score += 20;
  if (isValidDate(extracted.invoice_date)) score += 10;
  if (extracted.po_number || extracted.mpo_number) score += 15;
  if (extracted.currency && extracted.currency.trim().length === 3) score += 5;
  score = Math.max(0, Math.min(100, score));
  return score / 100;
}

async function main() {
  const invoices = await prisma.invoice.findMany({
    select: {
      id: true,
      invoice_number: true,
      vendor_name_raw: true,
      total_amount: true,
      invoice_date: true,
      currency: true,
      customer_po_number: true,
      mpo_number: true,
      ocr_confidence_score: true,
      ocr_raw_data: true,
    },
  });

  console.log(`Updating confidence for ${invoices.length} invoices\n`);

  let updated = 0;
  for (const inv of invoices) {
    const extracted = {
      vendor_name: inv.vendor_name_raw,
      invoice_number: inv.invoice_number,
      total_amount: Number(inv.total_amount),
      invoice_date: inv.invoice_date ? inv.invoice_date.toISOString().split('T')[0] : null,
      currency: inv.currency,
      po_number: inv.customer_po_number,
      mpo_number: inv.mpo_number,
    };

    const newConfidence = calculateRealConfidence(extracted);
    const oldConfidence = Number(inv.ocr_confidence_score || 0);

    if (Math.abs(newConfidence - oldConfidence) > 0.01) {
      await prisma.invoice.update({
        where: { id: inv.id },
        data: { ocr_confidence_score: newConfidence },
      });
      console.log(`  [${inv.invoice_number}] ${oldConfidence.toFixed(2)} → ${newConfidence.toFixed(2)} (vendor: "${inv.vendor_name_raw}")`);
      updated++;
    }
  }

  console.log(`\nUpdated: ${updated}/${invoices.length}`);
}

main().catch(console.error).finally(() => prisma.$disconnect());
