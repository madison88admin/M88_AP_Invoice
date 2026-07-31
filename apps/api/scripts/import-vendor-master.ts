/**
 * Import VENDOR MASTER LIST.xlsx into the Vendor table.
 * Updates existing vendors (matched by name) with bank details, beneficiary name, classification, etc.
 * Creates new vendors if they don't exist.
 *
 * Usage: pnpm exec ts-node-dev --transpile-only scripts/import-vendor-master.ts
 */
import * as path from 'path';
import * as fs from 'fs';
import * as dotenv from 'dotenv';

// Find .env file — try multiple locations since compiled JS may be in a different dir
const envCandidates = [
  path.join(__dirname, '..', '..', '.env'),
  path.join(__dirname, '..', '.env'),
  path.join(process.cwd(), '.env'),
];
for (const envPath of envCandidates) {
  if (fs.existsSync(envPath)) {
    dotenv.config({ path: envPath });
    console.log(`Loaded env from: ${envPath}`);
    break;
  }
}

import * as XLSX from 'xlsx';
import prisma from '../src/config/database';

interface VendorRow {
  status: string;
  classification: string;
  otherClassification: string;
  vendorName: string;
  beneficiaryName: string;
  bankName: string;
  bankAccountNumber: string;
  swiftCode: string;
  address: string;
  vendorBankCharge: string;
  terms: string;
  contactDetails: string;
  invPi: string;
  remarks: string;
}

function parseBankName(raw: any): string | null {
  if (!raw) return null;
  const str = String(raw).trim();
  if (!str) return null;
  // Remove prefixes like "BANK:", "Bank:", "BANK NAME:", "ACCOUNT#:" etc.
  return str.replace(/^(BANK\s*(NAME)?\s*[:#]?\s*)/i, '').trim() || null;
}

function parseAccountNumber(raw: any): string | null {
  if (!raw) return null;
  const str = String(raw).trim();
  if (!str) return null;
  // Remove various prefixes: ACC:, ACC#:, ACCOUNT#:, Account #:, ACCOUNT :, IBAN:, etc.
  let cleaned = str
    .replace(/^ACC(?:OUNT)?\s*#?\s*[:#]?\s*/i, '')
    .replace(/^IBAN\s*[:#]?\s*/i, '')
    .replace(/^A\/C\s*[:#]?\s*/i, '')
    .replace(/^NO\.?\s*[:#]?\s*/i, '')
    .trim();
  return cleaned || null;
}

function parseSwiftCode(raw: any): string | null {
  if (!raw) return null;
  const str = String(raw).trim();
  if (!str) return null;
  // Remove prefixes like "SWIFT:", "Swift:", "SWIFT CODE:" etc.
  // Also remove spaces (SWIFT codes are 8 or 11 chars, no spaces)
  const cleaned = str.replace(/^(SWIFT\s*(CODE)?\s*[:#]?\s*)/i, '').replace(/\s+/g, '').trim();
  return cleaned || null;
}

async function main() {
  const filePath = process.argv[2] || 'C:/Users/JC/Downloads/VENDOR MASTER LIST.xlsx';
  console.log(`Reading: ${filePath}`);

  const wb = XLSX.readFile(filePath);
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1 });

  // Skip header row
  const dataRows = rows.slice(1).filter(r => r[0] && r[3]); // must have STATUS and VENDOR NAME

  console.log(`Found ${dataRows.length} vendor rows`);

  let created = 0;
  let updated = 0;
  let skipped = 0;

  for (let i = 0; i < dataRows.length; i++) {
    const row = dataRows[i];
    const vendorName = String(row[3] || '').trim();
    if (!vendorName) { skipped++; continue; }

    const status = String(row[0] || '').trim().toUpperCase();
    const classification = row[1] ? String(row[1]).trim() : null;
    const beneficiaryName = row[4] ? String(row[4]).trim() : null;
    const bankName = parseBankName(row[5]);
    const accountNumber = parseAccountNumber(row[6]);
    const swiftCode = parseSwiftCode(row[7]);
    const address = row[8] ? String(row[8]).trim() : null;
    const terms = row[10] ? String(row[10]).trim() : null;
    const contactDetails = row[11] ? String(row[11]).trim() : null;

    // Check if vendor already exists (by exact name match)
    const existing = await prisma.vendor.findFirst({
      where: { name: { equals: vendorName, mode: 'insensitive' } },
    });

    const vendorData: any = {
      classification,
      beneficiary_name: beneficiaryName,
      bank_name: bankName,
      account_number: accountNumber,
      swift_code: swiftCode,
      supplier_location: address,
      is_active: status === 'ACTIVE',
    };

    if (existing) {
      // Update existing vendor — overwrite with master list data
      const updateData: any = {};
      if (vendorData.classification) updateData.classification = vendorData.classification;
      if (vendorData.beneficiary_name) updateData.beneficiary_name = vendorData.beneficiary_name;
      if (vendorData.bank_name) updateData.bank_name = vendorData.bank_name;
      if (vendorData.account_number) updateData.account_number = vendorData.account_number;
      if (vendorData.swift_code) updateData.swift_code = vendorData.swift_code;
      if (vendorData.supplier_location) updateData.supplier_location = vendorData.supplier_location;
      if (existing.is_active !== vendorData.is_active) updateData.is_active = vendorData.is_active;

      // If we have bank details, mark as bank verified
      if (vendorData.bank_name && vendorData.account_number) {
        updateData.bank_verified_at = new Date();
      }

      if (Object.keys(updateData).length > 0) {
        await prisma.vendor.update({ where: { id: existing.id }, data: updateData });
        updated++;
        console.log(`  [${i + 1}] Updated: ${vendorName}`);
      } else {
        skipped++;
      }
    } else {
      // Create new vendor
      await prisma.vendor.create({
        data: {
          name: vendorName,
          name_aliases: [],
          invoice_template_type: 'INVOICE' as any,
          ...vendorData,
          bank_verified_at: (vendorData.bank_name && vendorData.account_number) ? new Date() : null,
        },
      });
      created++;
      console.log(`  [${i + 1}] Created: ${vendorName}`);
    }
  }

  console.log('');
  console.log('=== Import Summary ===');
  console.log(`Created: ${created}`);
  console.log(`Updated: ${updated}`);
  console.log(`Skipped: ${skipped}`);
  console.log(`Total processed: ${dataRows.length}`);

  await prisma.$disconnect();
}

main().catch(err => {
  console.error('Import failed:', err);
  process.exit(1);
});
