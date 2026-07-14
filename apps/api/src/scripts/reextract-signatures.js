require('dotenv').config({ path: __dirname + '/../../.env' });
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const fs = require('fs');
const path = require('path');

async function main() {
  // Find the Gemini OCR service
  const { geminiOCRService } = require('../../dist/services/geminiOCRService');
  if (!geminiOCRService.isAvailable()) {
    console.log('Gemini OCR not configured');
    return;
  }

  // Find all invoices that have no OCR-detected signatures
  const invoices = await prisma.invoice.findMany({
    where: {
      status: { in: ['EXCEPTION_FLAGGED', 'VALIDATION_PENDING', 'PENDING_COORDINATOR', 'RECEIVED'] }
    },
    include: { signatures: true, vendor: true },
  });

  console.log(`Found ${invoices.length} invoices to check for signature extraction`);

  // Folders where PDFs might be
  const folders = [
    '/incoming-invoices/manual-review',
    '/incoming-invoices/processed',
    '/incoming-invoices/processing',
    '/incoming-invoices/failed',
    '/incoming-invoices/duplicates',
  ];

  for (const invoice of invoices) {
    // Skip if already has OCR-detected signatures
    const hasOCRSigs = invoice.signatures.some(s => s.ocr_detected);
    if (hasOCRSigs) {
      console.log(`  ${invoice.invoice_number}: already has OCR signatures, skipping`);
      continue;
    }

    // Try to find the PDF file
    let pdfPath = null;
    for (const folder of folders) {
      const candidates = fs.readdirSync(folder).catch ? [] : (fs.existsSync(folder) ? fs.readdirSync(folder) : []);
      for (const f of candidates) {
        if (f.includes(invoice.invoice_number) || f.includes(invoice.vendor_name_raw?.split(' ')[0] || '___')) {
          pdfPath = path.join(folder, f);
          break;
        }
      }
      if (pdfPath) break;
    }

    if (!pdfPath) {
      console.log(`  ${invoice.invoice_number}: PDF file not found, skipping`);
      continue;
    }

    console.log(`  ${invoice.invoice_number}: re-extracting signatures from ${pdfPath}`);

    try {
      const fileBuffer = fs.readFileSync(pdfPath);
      const result = await geminiOCRService.extractFromPDF(fileBuffer);

      if (result && result.signatures && result.signatures.length > 0) {
        console.log(`    Found ${result.signatures.length} signatures:`, JSON.stringify(result.signatures));

        // Create signature records
        for (const sig of result.signatures) {
          // Try to match signer to role
          let role = 'COORDINATOR'; // default
          const name = sig.signatory_name || '';
          const lower = name.toLowerCase();

          // Simple role matching
          if (lower.includes('coordinator') || lower.includes('purchasing coordinator')) role = 'COORDINATOR';
          else if (lower.includes('manager') && lower.includes('purchasing')) role = 'PURCHASING_MANAGER';
          else if (lower.includes('account holder') || lower.includes('mlo')) role = 'MLO_ACCOUNT_HOLDER';
          else if (lower.includes('planning')) role = 'MLO_PLANNING_MANAGER';
          else if (lower.includes('sr') && lower.includes('manager')) role = 'SR_MANAGER_GLOBAL_PRODUCTION';
          else if (lower.includes('polly')) role = 'MS_POLLY';

          // Check if signature already exists
          const existing = await prisma.signature.findFirst({
            where: {
              invoice_id: invoice.id,
              signatory_role: role,
              ocr_detected: true,
            }
          });

          if (!existing) {
            await prisma.signature.create({
              data: {
                invoice_id: invoice.id,
                signatory_name: name,
                signatory_role: role,
                signature_type: 'DIGITAL',
                signed_at: sig.signed_date ? new Date(sig.signed_date) : new Date(),
                ocr_detected: true,
              }
            });
            console.log(`    Created signature: ${name} → ${role}`);
          } else {
            console.log(`    Signature already exists: ${name} → ${role}`);
          }
        }
      } else {
        console.log(`    No signatures found in document`);
      }
    } catch (err) {
      console.error(`    Error: ${err.message}`);
    }
  }

  console.log('\nDone!');
}

main().catch(console.error).finally(() => prisma.$disconnect());
