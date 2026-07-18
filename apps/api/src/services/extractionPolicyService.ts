export interface ExtractionFieldPolicy {
  review_threshold: number;
  auto_accept_threshold: number;
  critical: boolean;
  require_external_validation?: boolean;
}

const DEFAULT_POLICY: ExtractionFieldPolicy = {
  review_threshold: 70,
  auto_accept_threshold: 88,
  critical: false,
};

const POLICIES: Record<string, ExtractionFieldPolicy> = {
  vendor_name: { review_threshold: 85, auto_accept_threshold: 95, critical: true },
  invoice_number: { review_threshold: 90, auto_accept_threshold: 97, critical: true },
  total_amount: { review_threshold: 92, auto_accept_threshold: 98, critical: true },
  currency: { review_threshold: 88, auto_accept_threshold: 96, critical: true },
  mpo_number: { review_threshold: 88, auto_accept_threshold: 96, critical: true, require_external_validation: true },
  po_number: { review_threshold: 88, auto_accept_threshold: 96, critical: true, require_external_validation: true },
  material_code: { review_threshold: 88, auto_accept_threshold: 96, critical: true, require_external_validation: true },
  quantity: { review_threshold: 88, auto_accept_threshold: 96, critical: true },
  selling_quantity: { review_threshold: 85, auto_accept_threshold: 94, critical: true },
  unit_price: { review_threshold: 90, auto_accept_threshold: 97, critical: true },
  line_amount: { review_threshold: 92, auto_accept_threshold: 98, critical: true },
  bank_name: { review_threshold: 95, auto_accept_threshold: 100, critical: true, require_external_validation: true },
  account_number: { review_threshold: 100, auto_accept_threshold: 100, critical: true, require_external_validation: true },
  swift_code: { review_threshold: 98, auto_accept_threshold: 100, critical: true, require_external_validation: true },
  invoice_date: { review_threshold: 75, auto_accept_threshold: 90, critical: false },
  due_date: { review_threshold: 72, auto_accept_threshold: 88, critical: false },
  payment_terms: { review_threshold: 70, auto_accept_threshold: 85, critical: false },
  description: { review_threshold: 60, auto_accept_threshold: 80, critical: false },
  material_name: { review_threshold: 65, auto_accept_threshold: 82, critical: false },
};

export function getExtractionFieldPolicy(field: string): ExtractionFieldPolicy {
  const normalized = field.replace(/^line_items\./, '');
  const envKey = `EXTRACTION_THRESHOLD_${normalized.toUpperCase()}`;
  const configured = Number(process.env[envKey]);
  const policy = POLICIES[normalized] || DEFAULT_POLICY;
  if (!Number.isFinite(configured) || configured < 0 || configured > 100) return policy;
  return {
    ...policy,
    review_threshold: configured,
    auto_accept_threshold: Math.max(configured, policy.auto_accept_threshold),
  };
}

export function calibrateExtractionConfidence(input: {
  field: string;
  raw_confidence: number;
  source_count: number;
  consensus_count: number;
  externally_validated?: boolean;
  arithmetic_validated?: boolean;
}): number {
  const policy = getExtractionFieldPolicy(input.field);
  let score = Math.max(0, Math.min(100, input.raw_confidence));

  // A single model cannot claim near-perfect certainty without an independent check.
  if (input.source_count <= 1 && !input.externally_validated && !input.arithmetic_validated) {
    score = Math.min(score, policy.critical ? 82 : 88);
  }
  if (input.consensus_count >= 2) score += 5;
  if (input.consensus_count >= 3) score += 3;
  if (input.externally_validated) score += 8;
  if (input.arithmetic_validated) score += 5;
  if (policy.require_external_validation && !input.externally_validated) {
    score = Math.min(score, policy.auto_accept_threshold - 1);
  }
  return Math.round(Math.max(0, Math.min(100, score)));
}

export function requiresExtractionReview(field: string, confidence: number, externallyValidated = false): boolean {
  const policy = getExtractionFieldPolicy(field);
  if (policy.require_external_validation && !externallyValidated) return true;
  return confidence < policy.review_threshold;
}

export function listExtractionPolicies() {
  return Object.entries(POLICIES).map(([field, policy]) => ({ field, ...policy }));
}
