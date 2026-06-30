import { buildInvoiceAST } from '../services/dsrs/ast/InvoiceASTKernel';
import { InvoiceASTResolver } from '../services/dsrs/ast/InvoiceAST';

/**
 * Synthetic unit test for the two AST fixes (no PDFs required).
 * Run: npx ts-node apps/api/src/scripts/test_ast_synthetic.ts
 */

function testMultiPageTotal() {
  // Page 1: line items + subtotal only
  const page1 = `INVOICE
Line 1  100.00
Line 2  200.00
SUBTOTAL  300.00`;

  // Page 2: real grand total
  const page2 = `TOTAL USD  4693.10
Thank you`;

  const ast = buildInvoiceAST(
    `${page1}\n${page2}`,
    [],
    { currency: 'USD' },
    { bank_name: null, account_number: null, swift_code: null },
    [page1, page2]
  );

  const resolver = new InvoiceASTResolver();
  const result = resolver.resolveAmount(ast);

  console.log('\n--- Multi-page total test ---');
  console.log('Expected amount: 4693.10');
  console.log('Actual amount:', result.value);
  console.log('Source:', result.source);
  console.log('PASS:', result.value === 4693.10);
  return result.value === 4693.10;
}

function testProseCurrencyOverride() {
  // Labeled total in HKD, but real USD settlement in prose
  const text = `NET TOTAL (HKD)  744.43
For settlement in USD. @7.70, Please settle in USD 96.68`;

  const ast = buildInvoiceAST(
    text,
    [],
    { currency: 'HKD' },
    { bank_name: null, account_number: null, swift_code: null },
    [text]
  );

  const resolver = new InvoiceASTResolver();
  const result = resolver.resolveAmount(ast);

  console.log('\n--- Prose-currency override test ---');
  console.log('Expected amount: 96.68, currency: USD');
  console.log('Actual amount:', result.value, 'currency:', result.currency);
  console.log('Source:', result.source);
  console.log('PASS:', result.value === 96.68 && result.currency === 'USD');
  return result.value === 96.68 && result.currency === 'USD';
}

function testNoProseRegression() {
  // Normal USD invoice with labeled total, no prose
  const text = `TOTAL USD  37.94`;

  const ast = buildInvoiceAST(
    text,
    [],
    { currency: 'USD' },
    { bank_name: null, account_number: null, swift_code: null },
    [text]
  );

  const resolver = new InvoiceASTResolver();
  const result = resolver.resolveAmount(ast);

  console.log('\n--- No-prose regression test ---');
  console.log('Expected amount: 37.94, currency: USD');
  console.log('Actual amount:', result.value, 'currency:', result.currency);
  console.log('Source:', result.source);
  console.log('PASS:', result.value === 37.94 && result.currency === 'USD');
  return result.value === 37.94 && result.currency === 'USD';
}

function testSinglePage() {
  const text = `TOTAL USD  8.62`;

  const ast = buildInvoiceAST(
    text,
    [],
    { currency: 'USD' },
    { bank_name: null, account_number: null, swift_code: null },
    [text]
  );

  const resolver = new InvoiceASTResolver();
  const result = resolver.resolveAmount(ast);

  console.log('\n--- Single-page total test ---');
  console.log('Expected amount: 8.62, currency: USD');
  console.log('Actual amount:', result.value, 'currency:', result.currency);
  console.log('Source:', result.source);
  console.log('PASS:', result.value === 8.62 && result.currency === 'USD');
  return result.value === 8.62 && result.currency === 'USD';
}

function testAveryStyleLineItems() {
  // Avery-style multi-line invoice with line items and page-2 total
  const page1 = `120 Each 0.06656 7.99
80 Each 0.06656 5.32
50 Each 0.06656 3.33`;

  const page2 = `75 Each 0.06656 4.99
100 Each 0.06656 6.66
TOTAL (USD) 37.94`;

  const ast = buildInvoiceAST(
    `${page1}\n${page2}`,
    [],
    { currency: 'USD' },
    { bank_name: null, account_number: null, swift_code: null },
    [page1, page2]
  );

  const resolver = new InvoiceASTResolver();
  const amountResult = resolver.resolveAmount(ast);
  const qtyResult = resolver.resolveQty(ast);

  console.log('\n--- Avery-style line items + total test ---');
  console.log('Expected amount: 37.94, currency: USD, qty: 575');
  console.log('Actual amount:', amountResult.value, 'currency:', amountResult.currency, 'qty:', qtyResult.value);
  console.log('Amount source:', amountResult.source);
  console.log('PASS:', amountResult.value === 37.94 && amountResult.currency === 'USD' && qtyResult.value === 575);
  return amountResult.value === 37.94 && amountResult.currency === 'USD' && qtyResult.value === 575;
}

const results = [
  testMultiPageTotal(),
  testProseCurrencyOverride(),
  testNoProseRegression(),
  testSinglePage(),
  testAveryStyleLineItems()
];

console.log('\n========================================');
console.log('All synthetic tests passed:', results.every(Boolean));
console.log('========================================');

process.exit(results.every(Boolean) ? 0 : 1);
