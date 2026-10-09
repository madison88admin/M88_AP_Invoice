import { normalizeAmount, normalizeDate, normalizeInvoiceNumber } from './intakeControlService';

const HEADER_FIELDS = [
  'vendor_name', 'invoice_number', 'invoice_date', 'due_date', 'total_amount',
  'currency', 'po_number', 'mpo_number', 'payment_terms',
];
const LINE_FIELDS = ['material_code', 'description', 'quantity', 'selling_quantity', 'unit_price', 'line_amount'];
const NUMERIC_FIELDS = new Set(['total_amount', 'quantity', 'selling_quantity', 'unit_price', 'line_amount']);

export interface BenchmarkEvidence { page?: number; bounding_box?: { x?: number; y?: number; width?: number; height?: number }; quote?: string; confidence?: number; }
export interface BenchmarkCase {
  id?: string; vendor_name?: string; expected: Record<string, any>; actual: Record<string, any>;
  expected_document_type?: string | null; actual_document_type?: string | null;
  expected_pages?: number[] | { start: number; end: number }[]; actual_pages?: number[] | { start: number; end: number }[];
  expected_invoice_count?: number; actual_invoice_count?: number;
  intake?: { uploaded?: boolean; created?: boolean; retries?: number; dead_letter?: boolean; time_to_created_ms?: number | null };
}
export interface MetricStat { field: string; accuracy: number; precision: number; recall: number; f1: number; correct: number; total: number; tp: number; fp: number; fn: number; support: number; scored: number; coverage_rate: number; }

function percent(value: number): number { return Math.round(value * 10000) / 100; }
function normalized(field: string, value: any): string {
  if (value == null || value === '') return '';
  if (NUMERIC_FIELDS.has(field)) { const number = normalizeAmount(value); return number == null ? String(value).trim().toUpperCase() : number.toFixed(2); }
  if (field.includes('date')) return normalizeDate(value) || String(value).trim().toUpperCase();
  if (field === 'invoice_number') return normalizeInvoiceNumber(value);
  return String(value).trim().toUpperCase().replace(/\s+/g, ' ');
}
function createStat() { return { accuracy: 0, precision: 0, recall: 0, f1: 0, correct: 0, total: 0, tp: 0, fp: 0, fn: 0, support: 0, scored: 0, coverage_rate: 0 }; }
function finishStat(field: string, stat: ReturnType<typeof createStat>): MetricStat {
  const denominator = stat.total + stat.fp; const precision = stat.tp + stat.fp ? stat.tp / (stat.tp + stat.fp) : 0; const recall = stat.tp + stat.fn ? stat.tp / (stat.tp + stat.fn) : 0; const f1 = precision + recall ? (2 * precision * recall) / (precision + recall) : 0;
  return { field, ...stat, accuracy: denominator ? percent(stat.correct / denominator) : 0, precision: percent(precision), recall: percent(recall), f1: percent(f1), coverage_rate: stat.support ? percent(stat.scored / stat.support) : 0 };
}
function addComparison(map: Map<string, ReturnType<typeof createStat>>, field: string, expected: any, actual: any) {
  const stat = map.get(field) || createStat(); const expectedPresent = expected != null && expected !== ''; const actualPresent = actual != null && actual !== '';
  if (expectedPresent) stat.support++; if (expectedPresent || actualPresent) stat.total++;
  if (expectedPresent && actualPresent) { stat.scored++; if (normalized(field, expected) === normalized(field, actual)) { stat.tp++; stat.correct++; } else { stat.fp++; stat.fn++; } }
  else if (expectedPresent) stat.fn++; else if (actualPresent) stat.fp++;
  map.set(field, stat);
}
function flattenPages(value: BenchmarkCase['expected_pages'] | BenchmarkCase['actual_pages']): string[] { if (!Array.isArray(value)) return []; return value.flatMap(page => typeof page === 'number' ? [String(page)] : [`${page.start}-${page.end}`]); }
function classificationMetric(cases: BenchmarkCase[]) {
  let tp = 0; let fp = 0; let fn = 0; let support = 0;
  for (const item of cases) { const expected = String(item.expected_document_type ?? item.expected?.document_type ?? '').trim().toUpperCase(); const actual = String(item.actual_document_type ?? item.actual?.document_type ?? '').trim().toUpperCase(); if (!expected && !actual) continue; if (expected) support++; if (expected && actual && expected === actual) tp++; else if (expected && actual) { fp++; fn++; } else if (expected) fn++; else fp++; }
  const precision = tp + fp ? tp / (tp + fp) : 0; const recall = tp + fn ? tp / (tp + fn) : 0;
  return { accuracy: support ? percent(tp / support) : 0, precision: percent(precision), recall: percent(recall), f1: precision + recall ? percent(2 * precision * recall / (precision + recall)) : 0, tp, fp, fn, support };
}
function pageSplitMetrics(cases: BenchmarkCase[]) {
  let exact = 0; let expected = 0; let predicted = 0; let matched = 0; let invoiceCountCorrect = 0; let invoiceCountScored = 0; let splitCases = 0;
  for (const item of cases) { const expectedPages = flattenPages(item.expected_pages); const actualPages = flattenPages(item.actual_pages); if (expectedPages.length || actualPages.length) { splitCases++; expected += expectedPages.length; predicted += actualPages.length; matched += expectedPages.filter(page => actualPages.includes(page)).length; if (expectedPages.length === actualPages.length && expectedPages.every(page => actualPages.includes(page))) exact++; } if (item.expected_invoice_count != null || item.actual_invoice_count != null) { invoiceCountScored++; if (item.expected_invoice_count === item.actual_invoice_count) invoiceCountCorrect++; } }
  return { exact_split_rate: splitCases ? percent(exact / splitCases) : 0, page_precision: predicted ? percent(matched / predicted) : 0, page_recall: expected ? percent(matched / expected) : 0, invoice_count_accuracy: invoiceCountScored ? percent(invoiceCountCorrect / invoiceCountScored) : 0, expected_pages: expected, predicted_pages: predicted, matched_pages: matched, invoice_count_scored: invoiceCountScored };
}
function intakeMetrics(cases: BenchmarkCase[]) {
  const scored = cases.map(c => c.intake).filter(Boolean) as NonNullable<BenchmarkCase['intake']>[]; const successful = scored.filter(i => i.created).length; const uploaded = scored.filter(i => i.uploaded).length; const deadLetter = scored.filter(i => i.dead_letter).length; const retrying = scored.filter(i => Number(i.retries || 0) > 0).length; const durations = scored.map(i => i.time_to_created_ms).filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
  return { cases: scored.length, intake_success_rate: uploaded ? percent(successful / uploaded) : 0, retry_rate: scored.length ? percent(retrying / scored.length) : 0, dead_letter_rate: scored.length ? percent(deadLetter / scored.length) : 0, time_to_created_ms_avg: durations.length ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : null, time_to_created_ms_p95: durations.length ? Math.round([...durations].sort((a, b) => a - b)[Math.min(durations.length - 1, Math.ceil(durations.length * .95) - 1)]) : null };
}

export function evaluateExtractionBenchmark(cases: BenchmarkCase[]) {
  if (!Array.isArray(cases) || cases.length === 0) throw new Error('At least one benchmark case is required');
  const fieldStats = new Map<string, ReturnType<typeof createStat>>(); const vendorStats = new Map<string, { correct: number; total: number; cases: number }>(); let touchlessCases = 0;
  const results = cases.map((testCase, caseIndex) => {
    let correct = 0; let total = 0; const mismatches: Array<{ field: string; expected: any; actual: any }> = [];
    for (const field of HEADER_FIELDS) { const expected = testCase.expected?.[field]; const actual = testCase.actual?.[field]; if (expected != null && expected !== '') total++; addComparison(fieldStats, field, expected, actual); if (expected != null && expected !== '' && actual != null && actual !== '' && normalized(field, expected) === normalized(field, actual)) correct++; else if (expected != null && expected !== '' && normalized(field, expected) !== normalized(field, actual)) mismatches.push({ field, expected, actual }); }
    const expectedLines = Array.isArray(testCase.expected?.line_items) ? testCase.expected.line_items : []; const actualLines = Array.isArray(testCase.actual?.line_items) ? testCase.actual.line_items : [];
    for (let index = 0; index < Math.max(expectedLines.length, actualLines.length); index++) { const expectedLine = expectedLines[index] || {}; const actualLine = actualLines[index] || {}; for (const field of LINE_FIELDS) { const metric = `line_items.${field}`; const expected = expectedLine[field]; const actual = actualLine[field]; if (expected != null && expected !== '') total++; addComparison(fieldStats, metric, expected, actual); if (expected != null && expected !== '' && actual != null && actual !== '' && normalized(field, expected) === normalized(field, actual)) correct++; else if (expected != null && expected !== '' && normalized(field, expected) !== normalized(field, actual)) mismatches.push({ field: `${metric}[${index}]`, expected, actual }); } }
    const vendor = testCase.vendor_name || testCase.expected?.vendor_name || 'UNKNOWN'; const vendorStat = vendorStats.get(vendor) || { correct: 0, total: 0, cases: 0 }; vendorStat.correct += correct; vendorStat.total += total; vendorStat.cases++; vendorStats.set(vendor, vendorStat); if (mismatches.length === 0) touchlessCases++;
    return { id: testCase.id || `case-${caseIndex + 1}`, vendor_name: vendor, accuracy: total ? percent(correct / total) : 0, correct_fields: correct, total_fields: total, touchless: mismatches.length === 0, mismatches };
  });
  const perField = [...fieldStats.entries()].map(([field, stat]) => finishStat(field, stat)).sort((a, b) => a.f1 - b.f1); const all = perField.reduce((acc, stat) => ({ correct: acc.correct + stat.correct, total: acc.total + stat.total, tp: acc.tp + stat.tp, fp: acc.fp + stat.fp, fn: acc.fn + stat.fn, support: acc.support + stat.support, scored: acc.scored + stat.scored }), { correct: 0, total: 0, tp: 0, fp: 0, fn: 0, support: 0, scored: 0 }); const precision = all.tp + all.fp ? all.tp / (all.tp + all.fp) : 0; const recall = all.tp + all.fn ? all.tp / (all.tp + all.fn) : 0;
  return { generated_at: new Date().toISOString(), case_count: cases.length, overall_accuracy: all.total ? percent(all.correct / all.total) : 0, precision: percent(precision), recall: percent(recall), f1: precision + recall ? percent(2 * precision * recall / (precision + recall)) : 0, support: all.support, scored_fields: all.scored, confidence_coverage: all.support ? percent(all.scored / all.support) : 0, straight_through_rate: percent(touchlessCases / cases.length), document_classification: classificationMetric(cases), page_split: pageSplitMetrics(cases), intake: intakeMetrics(cases), per_field: perField, per_vendor: [...vendorStats.entries()].map(([vendor_name, stat]) => ({ vendor_name, accuracy: stat.total ? percent(stat.correct / stat.total) : 0, ...stat })).sort((a, b) => a.accuracy - b.accuracy), cases: results };
}

export function compareExtractionBenchmarks(baseline: ReturnType<typeof evaluateExtractionBenchmark>, challenger: ReturnType<typeof evaluateExtractionBenchmark>) {
  const byField = new Map(challenger.per_field.map(field => [field.field, field])); const delta = (a: number, b: number) => percent((b - a) / 100);
  return { baseline: { precision: baseline.precision, recall: baseline.recall, f1: baseline.f1, overall_accuracy: baseline.overall_accuracy }, challenger: { precision: challenger.precision, recall: challenger.recall, f1: challenger.f1, overall_accuracy: challenger.overall_accuracy }, delta: { precision: delta(baseline.precision, challenger.precision), recall: delta(baseline.recall, challenger.recall), f1: delta(baseline.f1, challenger.f1), overall_accuracy: delta(baseline.overall_accuracy, challenger.overall_accuracy) }, per_field: baseline.per_field.map(field => ({ field: field.field, baseline_f1: field.f1, challenger_f1: byField.get(field.field)?.f1 ?? 0, delta_f1: delta(field.f1, byField.get(field.field)?.f1 ?? 0) })) };
}
