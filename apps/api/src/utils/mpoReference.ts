export interface ParsedMPOReference {
  raw: string;
  baseMpo?: string;
  orderSequence?: string;
  materialCode?: string;
}

/** Parses MPO012121, MPO012121-3, and MPO012121-3-ZVT000123. */
export function parseMPOReference(value?: string | null): ParsedMPOReference {
  const raw = String(value || '').trim().toUpperCase().replace(/\s+/g, '');
  if (!raw) return { raw };
  const match = raw.match(/^(MPO\d{5,8})(?:-([A-Z0-9]+))?(?:-([A-Z][A-Z0-9._/]+))?$/i);
  if (!match) return { raw };
  return { raw, baseMpo: match[1], orderSequence: match[2], materialCode: match[3] };
}
