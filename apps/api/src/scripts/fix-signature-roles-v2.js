require('dotenv').config({ path: __dirname + '/../../.env' });
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

// Import matchSignerToRole from shared package (compiled)
const { matchSignerToRole, SignatoryRole } = require('@ap-invoice/shared');

async function main() {
  // Get all OCR-detected signatures
  const sigs = await prisma.signature.findMany({
    where: { ocr_detected: true },
    include: { invoice: { select: { invoice_number: true, status: true } } },
  });

  console.log(`Found ${sigs.length} OCR-detected signatures to fix\n`);

  let fixed = 0;
  for (const sig of sigs) {
    const correctRole = matchSignerToRole(sig.signatory_name);
    
    if (correctRole && correctRole !== sig.signatory_role) {
      console.log(`FIXING: ${sig.invoice.invoice_number} - "${sig.signatory_name}" ${sig.signatory_role} → ${correctRole}`);
      await prisma.signature.update({
        where: { id: sig.id },
        data: { signatory_role: correctRole },
      });
      fixed++;
    } else if (correctRole && correctRole === sig.signatory_role) {
      console.log(`OK: ${sig.invoice.invoice_number} - "${sig.signatory_name}" → ${correctRole}`);
    } else {
      // No match found - check if it's a known non-person name
      const name = sig.signatory_name.toLowerCase();
      if (name.includes('company') || name.includes('ltd') || name.includes('inc') || 
          name.includes('corp') || name.includes('trimco') || name.includes('stamp')) {
        console.log(`REMOVE: ${sig.invoice.invoice_number} - "${sig.signatory_name}" is a company/stamp, not a person — deleting`);
        await prisma.signature.delete({ where: { id: sig.id } });
        fixed++;
      } else {
        console.log(`UNKNOWN: ${sig.invoice.invoice_number} - "${sig.signatory_name}" — no role match, keeping as ${sig.signatory_role}`);
      }
    }
  }

  console.log(`\nFixed ${fixed} signature(s)`);

  // Show final state
  const final = await prisma.signature.findMany({
    where: { ocr_detected: true },
    include: { invoice: { select: { invoice_number: true, status: true } } },
  });
  console.log(`\nFinal OCR-detected signatures (${final.length}):`);
  for (const sig of final) {
    console.log(`  ${sig.invoice.invoice_number} (${sig.invoice.status}): ${sig.signatory_name} - ${sig.signatory_role} - signed: ${sig.signed_at ? 'YES' : 'NO'}`);
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
