const HEADER_FIELDS = [
  'vendor_name', 'invoice_number', 'invoice_date', 'due_date', 'total_amount',
  'currency', 'po_number', 'mpo_number', 'payment_terms',
];
const LINE_FIELDS = ['material_code', 'description', 'quantity', 'selling_quantity', 'unit_price', 'line_amount'];

function normalized(field: string, value: any): string {
  if (value == null) return '';
  if (['total_amount', 'quantity', 'selling_quantity', 'unit_price', 'line_amount'].includes(field)) {
    const number = Number(String(value).replace(/,/g, ''));
    return Number.isFinite(number) ? number.toFixed(2) : String(value);
  }
  if (field.includes('date')) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? String(value).trim().toUpperCase() : date.toISOString().slice(0, 10);
  }
  return String(value).trim().toUpperCase().replace(/\s+/g, ' ');
}

export interface BenchmarkCase {
  id?: string;
  vendor_name?: string;
  expected: Record<string, any>;
  actual: Record<string, any>;
}

export function evaluateExtractionBenchmark(cases: BenchmarkCase[]) {
  if (!Array.isArray(cases) || cases.length === 0) throw new Error('At least one benchmark case is required');
  const fieldStats = new Map<string, { correct: number; total: number }>();
  const vendorStats = new Map<string, { correct: number; total: number; cases: number }>();
  let touchlessCases = 0;

  const results = cases.map((testCase, caseIndex) => {
    let correct = 0;
    let total = 0;
    const mismatches: Array<{ field: string; expected: any; actual: any }> = [];
    for (const field of HEADER_FIELDS) {
      if (testCase.expected[field] == null) continue;
      total++;
      const pass = normalized(field, testCase.expected[field]) === normalized(field, testCase.actual[field]);
      const stat = fieldStats.get(field) || { correct: 0, total: 0 };
      stat.total++;
      if (pass) { correct++; stat.correct++; }
      else mismatches.push({ field, expected: testCase.expected[field], actual: testCase.actual[field] });
      fieldStats.set(field, stat);
    }

    const expectedLines = Array.isArray(testCase.expected.line_items) ? testCase.expected.line_items : [];
    const actualLines = Array.isArray(testCase.actual.line_items) ? testCase.actual.line_items : [];
    expectedLines.forEach((expectedLine: any, index: number) => {
      const actualLine = actualLines[index] || {};
      for (const field of LINE_FIELDS) {
        if (expectedLine[field] == null) continue;
        const metric = `line_items.${field}`;
        total++;
        const pass = normalized(field, expectedLine[field]) === normalized(field, actualLine[field]);
        const stat = fieldStats.get(metric) || { correct: 0, total: 0 };
        stat.total++;
        if (pass) { correct++; stat.correct++; }
        else mismatches.push({ field: `${metric}[${index}]`, expected: expectedLine[field], actual: actualLine[field] });
        fieldStats.set(metric, stat);
      }
    });

    const vendor = testCase.vendor_name || testCase.expected.vendor_name || 'UNKNOWN';
    const vendorStat = vendorStats.get(vendor) || { correct: 0, total: 0, cases: 0 };
    vendorStat.correct += correct;
    vendorStat.total += total;
    vendorStat.cases++;
    vendorStats.set(vendor, vendorStat);
    if (mismatches.length === 0) touchlessCases++;
    return {
      id: testCase.id || `case-${caseIndex + 1}`,
      vendor_name: vendor,
      accuracy: total ? Math.round((correct / total) * 10000) / 100 : 0,
      correct_fields: correct,
      total_fields: total,
      touchless: mismatches.length === 0,
      mismatches,
    };
  });

  const allStats = [...fieldStats.values()].reduce((acc, stat) => ({ correct: acc.correct + stat.correct, total: acc.total + stat.total }), { correct: 0, total: 0 });
  return {
    generated_at: new Date().toISOString(),
    case_count: cases.length,
    overall_accuracy: allStats.total ? Math.round((allStats.correct / allStats.total) * 10000) / 100 : 0,
    straight_through_rate: Math.round((touchlessCases / cases.length) * 10000) / 100,
    per_field: [...fieldStats.entries()].map(([field, stat]) => ({
      field,
      accuracy: Math.round((stat.correct / stat.total) * 10000) / 100,
      ...stat,
    })).sort((a, b) => a.accuracy - b.accuracy),
    per_vendor: [...vendorStats.entries()].map(([vendor_name, stat]) => ({
      vendor_name,
      accuracy: stat.total ? Math.round((stat.correct / stat.total) * 10000) / 100 : 0,
      ...stat,
    })).sort((a, b) => a.accuracy - b.accuracy),
    cases: results,
  };
}
