export interface MPOLineSelector {
  orderSequence?: string | null;
  materialCode?: string | null;
  materialName?: string | null;
}

export interface MPOLineMatchResult {
  lines: any[];
  matchLevel: 'MPO_HEADER' | 'MPO_LINE' | 'MATERIAL_LINE';
  error?: 'LINE_NOT_FOUND' | 'MATERIAL_NOT_FOUND' | 'AMBIGUOUS_MATERIAL';
}

export function normalizeMPOValue(value: unknown): string {
  return String(value ?? '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
}

function materialValues(line: any): string[] {
  return [
    line.item_code,
    line.material_code,
    line.material_name,
    line.description,
    line.external_reference,
    line.customer_reference,
  ].map(normalizeMPOValue).filter(Boolean);
}

function materialScore(line: any, code?: string | null, name?: string | null): number {
  const normalizedCode = normalizeMPOValue(code);
  const normalizedName = normalizeMPOValue(name);
  const values = materialValues(line);
  let score = 0;

  for (const value of values) {
    if (normalizedCode && value === normalizedCode) score = Math.max(score, 100);
    else if (normalizedCode.length >= 4 && (value.includes(normalizedCode) || normalizedCode.includes(value))) {
      score = Math.max(score, 85);
    }

    if (normalizedName && value === normalizedName) score = Math.max(score, 95);
    else if (normalizedName.length >= 6 && (value.includes(normalizedName) || normalizedName.includes(value))) {
      score = Math.max(score, 75);
    }
  }

  return score;
}

/** Resolve an invoice reference against lines already fetched under one base MPO. */
export function matchMPOLines(lines: any[], selector: MPOLineSelector): MPOLineMatchResult {
  const orderSequence = normalizeMPOValue(selector.orderSequence);
  const hasMaterial = Boolean(normalizeMPOValue(selector.materialCode) || normalizeMPOValue(selector.materialName));
  let candidates = [...lines];

  if (orderSequence) {
    candidates = candidates.filter(line =>
      normalizeMPOValue(line.line_reference ?? line.line_number ?? line.order_sequence) === orderSequence
    );
    if (!candidates.length) return { lines: [], matchLevel: 'MPO_LINE', error: 'LINE_NOT_FOUND' };
  }

  if (hasMaterial) {
    const scored = candidates
      .map(line => ({ line, score: materialScore(line, selector.materialCode, selector.materialName) }))
      .filter(result => result.score > 0)
      .sort((a, b) => b.score - a.score);

    if (!scored.length) return { lines: [], matchLevel: 'MATERIAL_LINE', error: 'MATERIAL_NOT_FOUND' };
    const bestScore = scored[0].score;
    const best = scored.filter(result => result.score === bestScore).map(result => result.line);
    if (best.length > 1 && !orderSequence) {
      return { lines: best, matchLevel: 'MATERIAL_LINE', error: 'AMBIGUOUS_MATERIAL' };
    }
    return { lines: best, matchLevel: 'MATERIAL_LINE' };
  }

  return {
    lines: candidates,
    matchLevel: orderSequence ? 'MPO_LINE' : 'MPO_HEADER',
  };
}
