export interface ParsedMPOReference {
  raw: string;
  baseMpo?: string;
  orderSequence?: string;
  materialCode?: string;
}

/**
 * Parses a base MPO plus optional line/material suffixes.
 *
 * Vendors print the suffixes in both orders:
 *   MPO012121-3-ZVT000123
 *   MPO012121-ZVT000123-3
 */
export function parseMPOReference(value?: string | null): ParsedMPOReference {
  const raw = String(value || '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '')
    .replace(/_/g, '-')
    .replace(/-+/g, '-');
  if (!raw) return { raw };

  const match = raw.match(/^(MPO\d{5,8})(?:-([A-Z0-9][A-Z0-9./]*))?(?:-([A-Z0-9][A-Z0-9./]*))?$/i);
  if (!match) return { raw };

  const suffixes = [match[2], match[3]].filter(Boolean) as string[];
  const numericSuffix = suffixes.find(token => /^\d+$/.test(token));
  const materialSuffix = suffixes.find(token => /^[A-Z][A-Z0-9./]*$/i.test(token));

  // Preserve compatibility for a single non-numeric suffix that cannot be
  // confidently classified as a material code.
  const orderSequence = numericSuffix
    || (suffixes.length === 1 && !materialSuffix ? suffixes[0] : undefined);

  return {
    raw,
    baseMpo: match[1],
    orderSequence,
    materialCode: materialSuffix,
  };
}
