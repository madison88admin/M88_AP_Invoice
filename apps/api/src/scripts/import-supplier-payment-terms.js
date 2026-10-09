/*
 * Import the approved supplier/payment-terms workbook into the Vendor Master.
 *
 * Safety rules:
 *  - existing vendors are matched by normalized name or alias only;
 *  - unknown vendors are reported, never auto-created;
 *  - conflicting terms for one matched vendor are reported and skipped;
 *  - invoice-level payment_terms are not touched;
 *  - --dry-run is the default; pass --apply to write changes.
 */
require('dotenv/config');

const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');
const { PrismaClient } = require('@prisma/client');

const DEFAULT_WORKBOOK = path.resolve(process.cwd(), '../../..', 'Downloads', 'SUPPLIERS AND COURIER LIST.xlsx');
const workbookPath = path.resolve(process.argv[2] || DEFAULT_WORKBOOK);
const shouldApply = process.argv.includes('--apply');
const validateOnly = process.argv.includes('--validate-only');
const repairConflicts = process.argv.includes('--repair-conflicts');

// Existing Vendor Master canonical records. These are aliases already
// approved in the seed, so they are safe overrides when legacy duplicate rows
// make a normalized name ambiguous.
const CANONICAL_VENDOR_BY_SOURCE = new Map([
  [normalize('AMASS INTERNATIONAL LTD'), 'Amass Enterprises'],
  [normalize('Avery Dennison RIS Vietnam CO., Limited'), 'Avery Vietnam'],
  [normalize('AVERY DENNINSON PAXAR (CHINA) LTD'), 'PT Paxar China'],
  [normalize('BO HING LABEL INDUSTRIES CO. LTD.'), 'Bo Hing'],
  [normalize('Brand ID'), 'Brand ID LLC'],
  [normalize('C&T Garment Accessories Co.Ltd'), 'C&T Label'],
  [normalize('C&T LABEL COMPANY LTD.'), 'C&T Label'],
  [normalize('Charming Printing Ltd.'), 'Charming Printing Ltd'],
  [normalize('Checkpoint Apparel Labelling Sol. Asia'), 'Checkpoint Systems'],
  [normalize('CHECKPOINT VIETNAM COMPANY LIMITED'), 'Checkpoint Systems'],
  [normalize('DONG GUAN CITY OCAN WEAVING CO.,LTD'), 'Dong Guan City'],
  [normalize('Dragon Times Accessory Co. Ltd.'), 'Dragon Times'],
  [normalize('G & F TRADING (HONG KONG) LTD.'), 'G&F Industries'],
  [normalize('Jointak Labels Company Ltd.'), 'Jointak'],
  [normalize('Kabuhayan Namin Inc. (SuperDry PH)'), 'Kabuhayan Namin'],
  [normalize('Lee Bou International Binh Duong Company'), 'Lee Bou Vietnam'],
  [normalize('LEE BOU INTERNATIONAL CO.,LTD'), 'Lee Bou Vietnam'],
  [normalize('MANOHAR FILAMENTS PVT LTD'), 'Manohar Filaments'],
  [normalize('Nilorn East Asia Ltd.'), 'Nilorn HK'],
  [normalize('Perfect China Supplies'), 'Perfect China'],
  [normalize('PT SML INDONESIA PRIVATE'), 'PT SML Indonesia'],
  [normalize('SML (Hongkong) Ltd.'), 'PT SML Indonesia'],
  [normalize('PT VICTORIA LABEL'), 'PT Victoria'],
  [normalize('PT SUPER DRY'), 'Superdry PH'],
  [normalize('R-PAC VIETNAM LIMITED'), 'R-PAC Vietnam'],
  [normalize('RUDHOLM & HAAK (H.K.) LIMITED'), 'Rudholm & Haak HK'],
  [normalize('Seaman Paper Asia Company Limited'), 'Seaman Paper Asia'],
  [normalize('SF EXPRESS'), 'SF Express'],
  [normalize('FAR DAR EXPRESS'), 'Far Dar Enterprise'],
  [normalize('TRIMCO GROUP (HONG KONG)'), 'Trimco HK'],
  [normalize('TRIMCO GROUP TRADING (H.K.)CO., LTD.'), 'Trimco HK'],
  [normalize('VELA VIETNAM PACKAGING LIMITED COMPANY'), 'Vela Vietnam Packaging'],
]);

function normalize(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/&/g, ' AND ')
    .replace(/\b(CO|COMPANY|CORP|CORPORATION|INC|INCORPORATED|LTD|LIMITED|LLC|PTE|SDN|BHD)\b/g, '')
    .replace(/[^A-Z0-9]/g, '')
    .replace(/^PT(?=[A-Z0-9])/, '')
    .trim();
}

function cleanTerm(value) {
  const result = String(value || '').replace(/\s+/g, ' ').trim();
  return result || null;
}

function cleanDocType(value) {
  const result = String(value || '').trim().toUpperCase();
  return result || null;
}

function readRows() {
  if (!fs.existsSync(workbookPath)) {
    throw new Error(`Supplier workbook not found: ${workbookPath}`);
  }
  const workbook = XLSX.readFile(workbookPath, { cellDates: false });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });
  return rows
    .map((row, index) => {
      const keys = Object.keys(row);
      const vendorKey = keys.find((key) => /vendor\s*name/i.test(key)) || keys[0];
      const termsKey = keys.find((key) => /^terms?$/i.test(key) || /payment\s*terms?/i.test(key));
      const typeKey = keys.find((key) => /inv\s*\/\s*pi|document\s*type/i.test(key));
      return {
        row: index + 2,
        vendor: String(row[vendorKey] || '').trim(),
        terms: cleanTerm(termsKey ? row[termsKey] : ''),
        documentType: cleanDocType(typeKey ? row[typeKey] : ''),
      };
    })
    .filter((row) => row.vendor);
}

function groupRows(rows) {
  const grouped = new Map();
  for (const row of rows) {
    const key = normalize(row.vendor);
    const entry = grouped.get(key) || { names: new Set(), terms: new Set(), documentTypes: new Set(), rows: [] };
    entry.names.add(row.vendor);
    if (row.terms) entry.terms.add(row.terms);
    if (row.documentType) entry.documentTypes.add(row.documentType);
    entry.rows.push(row.row);
    grouped.set(key, entry);
  }
  return grouped;
}

function findVendor(vendors, sourceName) {
  const key = normalize(sourceName);
  const matches = vendors.filter((vendor) =>
    normalize(vendor.name) === key || (vendor.name_aliases || []).some((alias) => normalize(alias) === key)
  );
  const canonicalName = CANONICAL_VENDOR_BY_SOURCE.get(key);
  if (canonicalName) {
    const canonical = matches.find((vendor) => normalize(vendor.name) === normalize(canonicalName));
    if (canonical) return canonical;
  }
  if (matches.length <= 1) return matches[0] || null;

  // Never choose between records carrying different bank identities. For
  // duplicate records with the same bank identity, prefer the canonical
  // title-cased record with the richer alias set; this resolves legacy
  // uppercase duplicates without changing any bank fields.
  const bankFingerprint = (vendor) => [vendor.beneficiary_name, vendor.bank_name, vendor.account_number, vendor.swift_code]
    .map((value) => String(value || '').trim().toUpperCase())
    .join('|');
  const fingerprints = new Set(matches.map(bankFingerprint).filter(Boolean));
  if (fingerprints.size > 1) return { ambiguous: matches };

  const score = (vendor) => {
    const name = String(vendor.name || '');
    const mixedCase = name !== name.toUpperCase() ? 10 : 0;
    const aliases = Array.isArray(vendor.name_aliases) ? vendor.name_aliases.length : 0;
    const bankCompleteness = [vendor.beneficiary_name, vendor.bank_name, vendor.account_number, vendor.swift_code]
      .filter((value) => String(value || '').trim()).length;
    return mixedCase + aliases / 100 + bankCompleteness / 1000;
  };
  const ranked = matches.map((vendor) => ({ vendor, score: score(vendor) })).sort((a, b) => b.score - a.score);
  if (ranked.length === 1 || ranked[0].score > ranked[1].score) return ranked[0].vendor;
  // Exact duplicate names with the same financial fingerprint are safe to
  // treat as one record for master defaults; otherwise require review.
  const normalizedNames = new Set(matches.map((vendor) => normalize(vendor.name)));
  if (normalizedNames.size === 1) return matches[0];
  return { ambiguous: matches };
}

function toSortedArray(set) {
  return Array.from(set).sort((a, b) => a.localeCompare(b));
}

async function main() {
  const rows = readRows();
  const grouped = groupRows(rows);
  if (validateOnly) {
    const conflicts = [];
    for (const [key, entry] of grouped.entries()) {
      const terms = toSortedArray(entry.terms);
      if (terms.length > 1) conflicts.push({ sourceNames: Array.from(entry.names).sort(), terms, rows: entry.rows });
    }
    console.log(JSON.stringify({
      mode: 'validate-only',
      workbook: workbookPath,
      rows: rows.length,
      uniqueSuppliers: grouped.size,
      suppliersWithPaymentTerms: Array.from(grouped.values()).filter((entry) => entry.terms.size > 0).length,
      suppliersWithDocumentTypes: Array.from(grouped.values()).filter((entry) => entry.documentTypes.size > 0).length,
      conflicts,
    }, null, 2));
    if (conflicts.length > 0) process.exitCode = 2;
    return;
  }
  const prisma = new PrismaClient();
  try {
    const vendors = await prisma.vendor.findMany({
      where: { is_active: true },
      select: {
        id: true,
        name: true,
        name_aliases: true,
        default_payment_terms: true,
        accepted_document_types: true,
        beneficiary_name: true,
        bank_name: true,
        account_number: true,
        swift_code: true,
      },
    });

    const report = { rows: rows.length, uniqueSuppliers: grouped.size, updated: [], unchanged: [], unmatched: [], ambiguous: [], conflicts: [], repairedConflicts: [] };
    const updates = [];
    const resolvedByVendor = new Map();

    for (const [key, entry] of grouped.entries()) {
      const sourceName = Array.from(entry.names).sort()[0];
      const match = findVendor(vendors, sourceName);
      if (!match || match.ambiguous) {
        if (match && match.ambiguous) report.ambiguous.push({ sourceName, candidates: match.ambiguous.map((v) => v.name), rows: entry.rows });
        else report.unmatched.push({ sourceName, rows: entry.rows });
        continue;
      }

      const resolved = resolvedByVendor.get(match.id) || {
        match,
        sourceNames: new Set(),
        terms: new Set(),
        documentTypes: new Set(),
        rows: [],
      };
      for (const name of entry.names) resolved.sourceNames.add(name);
      for (const term of entry.terms) resolved.terms.add(term);
      for (const type of entry.documentTypes) resolved.documentTypes.add(type);
      resolved.rows.push(...entry.rows);
      resolvedByVendor.set(match.id, resolved);
    }

    for (const resolved of resolvedByVendor.values()) {
      const { match } = resolved;
      const sourceNames = Array.from(resolved.sourceNames).sort();
      const terms = toSortedArray(resolved.terms);
      if (terms.length > 1) {
        report.conflicts.push({ sourceNames, vendor: match.name, terms, rows: resolved.rows });
        if (repairConflicts) report.repairedConflicts.push({ vendor: match.name, rows: resolved.rows });
        continue;
      }
      const documentTypes = toSortedArray(resolved.documentTypes);
      const nextTerms = terms[0] || match.default_payment_terms || null;
      const nextTypes = documentTypes.length ? documentTypes : (match.accepted_document_types || []);
      const aliases = Array.from(new Set([...(match.name_aliases || []), ...sourceNames])).sort();
      const sameNameDuplicates = vendors.filter((vendor) => normalize(vendor.name) === normalize(match.name));
      const duplicateNeedsUpdate = sameNameDuplicates.some((vendor) =>
        nextTerms !== (vendor.default_payment_terms || null)
        || JSON.stringify(nextTypes) !== JSON.stringify((vendor.accepted_document_types || []).slice().sort())
      );
      const changed = (nextTerms !== (match.default_payment_terms || null))
        || JSON.stringify(nextTypes) !== JSON.stringify((match.accepted_document_types || []).slice().sort())
        || JSON.stringify(aliases) !== JSON.stringify((match.name_aliases || []).slice().sort())
        || duplicateNeedsUpdate;
      const item = { vendor: match.name, sourceNames, defaultPaymentTerms: nextTerms, acceptedDocumentTypes: nextTypes, rows: resolved.rows };
      if (changed) {
        report.updated.push(item);
        updates.push({ match, nextTerms, nextTypes, aliases });
      } else {
        report.unchanged.push(item);
      }
    }

    console.log(JSON.stringify({ mode: shouldApply ? 'apply' : 'dry-run', workbook: workbookPath, ...report }, null, 2));
    if (!shouldApply) return;

    for (const update of updates) {
      const sameNameDuplicates = vendors.filter((vendor) => normalize(vendor.name) === normalize(update.match.name));
      for (const target of sameNameDuplicates) {
        await prisma.vendor.update({
          where: { id: target.id },
          data: {
            default_payment_terms: update.nextTerms,
            accepted_document_types: update.nextTypes,
            ...(target.id === update.match.id ? { name_aliases: update.aliases } : {}),
          },
        });
      }
    }
    if (repairConflicts) {
      for (const repaired of report.repairedConflicts) {
        const target = vendors.find((vendor) => vendor.name === repaired.vendor);
        if (target) {
          await prisma.vendor.update({ where: { id: target.id }, data: { default_payment_terms: null } });
        }
      }
    }
    console.log(`Applied ${updates.length} vendor master updates. No invoice rows were modified.`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
