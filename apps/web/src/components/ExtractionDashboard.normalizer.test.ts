import { describe, expect, it } from 'vitest';
import { normalizeDashboardData } from './ExtractionDashboard';

describe('normalizeDashboardData', () => {
  it('supports the previous API shape without undefined or NaN KPI values', () => {
    const result = normalizeDashboardData({
      confidence: {
        overall_avg: 80,
        distribution: { high: 33, medium: 0, low: 46, missing: 0 },
        per_field: [{ field: 'vendor_name', avg_confidence: 88, total: 79, low_confidence_count: 4 }],
        trend: [],
      },
      performance: {
        total_processed: 80,
        auto_approved_rate: 1,
        manual_review_rate: 25,
        avg_processing_time_ms: 0,
        fraud_detection_rate: 1,
        self_validation_pass_rate: 0,
      },
      timeline: { total_avg_ms: 0, stages: [], slowest_invoices: [] },
      vendors: { vendors: [] },
      errors: { by_severity: {}, by_field: [], trend: [], top_correction_reasons: [] },
    });

    expect(result.performance.actual_invoice_count).toBe(80);
    expect(result.performance.pending_review_count).toBe(20);
    expect(result.performance.avg_time_to_approval_ms).toBeNull();
    expect(result.confidence.total_actual_invoices).toBe(80);
    expect(result.confidence.scored_count).toBe(79);
    expect(result.confidence.distribution.missing).toBe(1);
    expect(JSON.stringify(result)).not.toContain('undefined');
    expect(JSON.stringify(result)).not.toContain('NaN');
  });
});
