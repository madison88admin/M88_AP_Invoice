import { logger } from '../utils/logger';

/**
 * Per-field majority-voting consensus for OCR extraction engines.
 *
 * Each engine provides a partial extraction (some fields may be missing or wrong).
 * For the core fields we vote: when two or more engines return the same normalized
 * value, that value wins. Non-voted (extended) fields are carried over from the
 * "base engine" — the engine that supplied the most core fields.
 */

export interface EngineResult {
  engine: string;
  data: Record<string, any>;
}

export interface FieldVerdict {
  value: any;
  agreement: number; // engines agreeing on the winning value
  provided: number;  // engines that supplied a non-null value
  source: string;    // engine(s) that produced the winning value
  consensus: 'MAJORITY' | 'SINGLE' | 'TIE' | 'MISSING';
}

export interface ConsensusOutput {
  data: Record<string, any>;
  per_field: Record<string, FieldVerdict>;
  engines_used: string[];
  base_engine: string | null;
}

type Normalizer = (value: any) => string | number | null;

function normalizeDate(value: any): string | null {
  if (!value) return null;
  const s = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const months: Record<string, string> = {
    JAN: '01', FEB: '02', MAR: '03', APR: '04', MAY: '05', JUN: '06',
    JUL: '07', AUG: '08', SEP: '09', OCT: '10', NOV: '11', DEC: '12',
  };
  const mdy = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (mdy) {
    const year = mdy[3].length === 2 ? `20${mdy[3]}` : mdy[3];
    return `${year}-${mdy[1].padStart(2, '0')}-${mdy[2].padStart(2, '0')}`;
  }
  const dmy = s.match(/^(\d{1,2})-([A-Z]{3})-(\d{4})$/i);
  if (dmy) {
    const month = months[dmy[2].toUpperCase()];
    if (month) return `${dmy[3]}-${month}-${dmy[1].padStart(2, '0')}`;
  }
  const parsed = new Date(s);
  if (!isNaN(parsed.getTime())) return parsed.toISOString().split('T')[0];
  return null;
}

function normalizeMPO(value: any): string | null {
  if (!value) return null;
  const s = String(value).trim().toUpperCase();
  const m = s.match(/MPO(\d+)/);
  if (m) return 'MPO' + m[1].padStart(6, '0');
  const digits = s.match(/^\d+$/);
  if (digits) return 'MPO' + digits[0].padStart(6, '0');
  return s;
}

function normalizeAmount(value: any): string | null {
  if (value === undefined || value === null || value === '') return null;
  const n = Number(String(value).replace(/[$,]/g, ''));
  if (isNaN(n)) return null;
  return n.toFixed(4);
}

const FIELD_NORMALIZERS: Record<string, Normalizer> = {
  vendor_name: (v) => (v ? String(v).trim().replace(/\s+/g, ' ').toUpperCase() : null),
  invoice_number: (v) => (v ? String(v).trim().toUpperCase() : null),
  invoice_date: normalizeDate,
  due_date: normalizeDate,
  total_amount: normalizeAmount,
  currency: (v) => (v ? String(v).trim().replace(/[\s$]/g, '').toUpperCase() : null),
  po_number: (v) => (v ? String(v).trim().toUpperCase() : null),
  mpo_number: normalizeMPO,
  brand: (v) => (v ? String(v).trim().toLowerCase().replace(/[^a-z0-9]/g, '') : null),
  brand_code: (v) => (v ? String(v).trim().toUpperCase() : null),
  season: (v) => (v ? String(v).trim().toUpperCase() : null),
  payment_terms: (v) => (v ? String(v).trim().replace(/\s+/g, ' ').toLowerCase() : null),
};

// Core fields participate in voting; everything else passes through from the base engine.
const VOTED_FIELDS = Object.keys(FIELD_NORMALIZERS);

function pickBaseEngine(results: EngineResult[]): EngineResult | null {
  let best: EngineResult | null = null;
  let bestCount = -1;
  for (const result of results) {
    const count = VOTED_FIELDS.filter(f => FIELD_NORMALIZERS[f](result.data[f]) !== null).length;
    if (count > bestCount) {
      bestCount = count;
      best = result;
    }
  }
  return best;
}

/**
 * Merge per-field values from multiple engines using majority voting.
 *
 * Winning rule per field:
 * - If ≥2 engines agree on the same normalized value → MAJORITY (most-agreed wins;
 *   ties between groups broken by the base engine's value).
 * - If only one engine provided a value → SINGLE.
 * - If engines disagree and there is no agreement → the base engine's value wins (TIE).
 * - No engine provided a value → MISSING (undefined).
 *
 * `normalizeAmount`/`normalizeDate` compare normalized forms but the winning engine's
 * ORIGINAL value is preserved in the output.
 */
export function mergeEngineResults(results: EngineResult[]): ConsensusOutput {
  const usable = results.filter(r => r && typeof r.data === 'object' && r.data !== null);
  const baseEngine = pickBaseEngine(usable);
  const enginesUsed = usable.map(r => r.engine);

  const data: Record<string, any> = {};
  const perField: Record<string, FieldVerdict> = {};

  for (const field of VOTED_FIELDS) {
    const normalizer = FIELD_NORMALIZERS[field];
    const groups = new Map<string, { value: any; engines: string[] }>();

    for (const result of usable) {
      const raw = result.data[field];
      const norm = normalizer(raw);
      if (norm === null) continue;
      const key = String(norm);
      const existing = groups.get(key);
      if (existing) {
        existing.engines.push(result.engine);
      } else {
        groups.set(key, { value: raw, engines: [result.engine] });
      }
    }

    const provided = [...groups.values()].reduce((sum, g) => sum + g.engines.length, 0);

    if (groups.size === 0) {
      perField[field] = { value: undefined, agreement: 0, provided: 0, source: '', consensus: 'MISSING' };
      continue;
    }

    let winner: { value: any; engines: string[] } | null = null;
    let consensus: FieldVerdict['consensus'] = 'SINGLE';

    const sorted = [...groups.entries()].sort((a, b) => b[1].engines.length - a[1].engines.length);
    const topCount = sorted[0][1].engines.length;

    if (topCount >= 2) {
      // Majority group wins; break ties by preferring the base engine's value.
      const topGroups = sorted.filter(([, g]) => g.engines.length === topCount);
      const baseNorm = baseEngine ? normalizer(baseEngine.data[field]) : null;
      const baseKey = baseNorm === null ? null : String(baseNorm);
      winner = topGroups.find(([key]) => key === baseKey)?.[1] || topGroups[0][1];
      consensus = 'MAJORITY';
    } else if (groups.size === 1) {
      winner = [...groups.values()][0];
      consensus = 'SINGLE';
    } else {
      // All engines disagree — defer to the base engine (most complete extraction).
      const baseNorm = baseEngine ? normalizer(baseEngine.data[field]) : null;
      winner = baseNorm === null ? null : groups.get(String(baseNorm)) || null;
      if (!winner) winner = sorted[0][1];
      consensus = 'TIE';
    }

    perField[field] = {
      value: winner.value,
      agreement: winner.engines.length,
      provided,
      source: winner.engines.join('+'),
      consensus,
    };
    if (winner.value !== undefined && winner.value !== null && winner.value !== '') {
      data[field] = winner.value;
    }
  }

  // Pass-through fields: prefer the base engine, with line_items picking the fullest list.
  // Engine meta keys are excluded so raw_data reflects the merged result, not one engine.
  const META_KEYS = new Set(['engine_name', 'extraction_method', 'confidence', 'raw_text', 'rawText']);
  if (baseEngine) {
    for (const [key, value] of Object.entries(baseEngine.data)) {
      if (key in data || VOTED_FIELDS.includes(key) || META_KEYS.has(key)) continue;
      data[key] = value;
    }
  }
  const itemLists = usable
    .map(r => ({ engine: r.engine, items: Array.isArray(r.data.line_items) ? r.data.line_items : null }))
    .filter((x): x is { engine: string; items: any[] } => x.items !== null);
  if (itemLists.length > 0) {
    itemLists.sort((a, b) => b.items.length - a.items.length);
    data.line_items = itemLists[0].items;
  }

  logger.info(`[OCR] Consensus merge: engines=[${enginesUsed.join(', ')}], base=${baseEngine?.engine || 'none'}, ` +
    `agreements=${VOTED_FIELDS.filter(f => perField[f]?.consensus === 'MAJORITY').length}/${VOTED_FIELDS.length}`);

  return { data, per_field: perField, engines_used: enginesUsed, base_engine: baseEngine?.engine || null };
}
