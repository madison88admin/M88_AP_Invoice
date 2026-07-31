/**
 * Backfill pdf_path for existing invoices.
 * Scans processed/, manual-review/, failed/, duplicates/ directories for PDF files
 * and matches them to invoices by filename (which contains the original SFTP filename
 * or a timestamp-based name like SFTP-<timestamp>).
 *
 * Usage: npx ts-node scripts/backfill-pdf-paths.ts
 */
import prisma from '../config/database';
import fs from 'fs';
import path from 'path';

const BASE_DIR = process.env.WATCHER_INCOMING_DIR || '/incoming-invoices';
const SCAN_DIRS = [
  { dir: path.join(BASE_DIR, 'processed'), label: 'processed' },
  { dir: path.join(BASE_DIR, 'manual-review'), label: 'manual-review' },
  { dir: path.join(BASE_DIR, 'failed'), label: 'failed' },
  { dir: path.join(BASE_DIR, 'duplicates'), label: 'duplicates' },
];

async function main() {
  console.log('=== Backfill pdf_path for existing invoices ===\n');

  // 1. Get all invoices without pdf_path
  const invoices = await prisma.invoice.findMany({
    where: { pdf_path: null, source: 'MANUAL_UPLOAD' },
    select: { id: true, invoice_number: true, vendor_name_raw: true, created_at: true },
  });
  console.log(`Found ${invoices.length} invoices without pdf_path (source=MANUAL_UPLOAD)\n`);

  if (invoices.length === 0) {
    console.log('Nothing to backfill.');
    return;
  }

  // 2. Build a map of PDF files in all scan directories
  const pdfFiles: { path: string; filename: string; mtime: Date }[] = [];
  for (const { dir, label } of SCAN_DIRS) {
    if (!fs.existsSync(dir)) {
      console.log(`  Directory not found: ${dir}`);
      continue;
    }
    const files = fs.readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.pdf'));
    for (const f of files) {
      const fullPath = path.join(dir, f);
      const stat = fs.statSync(fullPath);
      pdfFiles.push({ path: fullPath, filename: f, mtime: stat.mtime });
    }
    console.log(`  ${label}: ${files.length} PDFs found`);
  }
  console.log(`  Total PDFs on disk: ${pdfFiles.length}\n`);

  // 3. Match invoices to PDFs
  // Strategy:
  //   - SFTP-<timestamp> invoice numbers → match by timestamp in filename
  //   - Other invoice numbers → match by invoice_number in filename
  //   - Fallback: match by creation time proximity to file mtime
  let matched = 0;
  let unmatched = 0;

  for (const inv of invoices) {
    let bestMatch: { path: string; score: number } | null = null;

    for (const pdf of pdfFiles) {
      const fname = pdf.filename.toLowerCase();
      const invNum = inv.invoice_number.toLowerCase();

      // Direct invoice_number match in filename
      if (fname.includes(invNum) && invNum.length > 5) {
        bestMatch = { path: pdf.path, score: 100 };
        break;
      }

      // SFTP-<timestamp> match: extract timestamp from invoice_number
      if (invNum.startsWith('sftp-')) {
        const timestamp = invNum.replace('sftp-', '');
        if (fname.includes(timestamp)) {
          bestMatch = { path: pdf.path, score: 90 };
          break;
        }
      }

      // Time proximity: file mtime within 5 minutes of invoice creation
      const createdMs = inv.created_at.getTime();
      const mtimeMs = pdf.mtime.getTime();
      const diffMin = Math.abs(createdMs - mtimeMs) / (1000 * 60);
      if (diffMin < 5) {
        const score = 80 - diffMin * 2;
        if (!bestMatch || score > bestMatch.score) {
          bestMatch = { path: pdf.path, score };
        }
      }
    }

    if (bestMatch && bestMatch.score >= 70) {
      await prisma.invoice.update({
        where: { id: inv.id },
        data: { pdf_path: bestMatch.path },
      });
      console.log(`  ✓ ${inv.invoice_number} → ${bestMatch.path} (score: ${bestMatch.score})`);
      matched++;
    } else {
      console.log(`  ✗ ${inv.invoice_number} — no PDF match found`);
      unmatched++;
    }
  }

  console.log(`\n=== Summary ===`);
  console.log(`  Matched: ${matched}`);
  console.log(`  Unmatched: ${unmatched}`);
  console.log(`  Total: ${invoices.length}`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Error:', err);
    process.exit(1);
  });
