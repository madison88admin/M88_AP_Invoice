import * as fs from 'fs';
import { extractMadisonInvoiceFields } from '../services/madisonInvoiceExtractor';

/**
 * Standalone verification script for AST mode extraction fixes.
 * Usage (from repo root):
 *   npx ts-node apps/api/src/scripts/test_ast_extraction.ts <pdf-path-1> <pdf-path-2> ...
 *
 * Expected outputs:
 *   G&F Trading SC-26-00806  -> amount = 4693.10
 *   Perfect China IN26020002 -> amount = 96.68, currency = USD
 *   Avery Dennison 100703828 -> amount = 37.94
 *   PT Paxar PCI-26018341    -> amount = 8.62
 */

async function main() {
  const paths = process.argv.slice(2);
  if (paths.length === 0) {
    console.error('Usage: npx ts-node apps/api/src/scripts/test_ast_extraction.ts <pdf-path> ...');
    process.exit(1);
  }

  for (const path of paths) {
    if (!fs.existsSync(path)) {
      console.error(`File not found: ${path}`);
      continue;
    }

    console.log('\n========================================');
    console.log('File:', path);
    console.log('========================================');

    const buffer = fs.readFileSync(path);
    const result = await extractMadisonInvoiceFields(buffer);

    console.log('vendor_name:', result.vendor_name);
    console.log('invoice_number:', result.invoice_number);
    console.log('amount:', result.amount);
    console.log('currency:', result.currency);
    console.log('qty_shipped:', result.qty_shipped);
    console.log('mpo_number:', result.mpo_number);
    console.log('status:', result.status);
    console.log('status_reason:', result.status_reason);
  }
}

main().catch(err => {
  console.error('Script failed:', err);
  process.exit(1);
});
