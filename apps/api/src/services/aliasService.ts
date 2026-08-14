import prisma from '../config/database';
import { AppError } from '../middleware/errorHandler';

export type EntityType = 'VENDOR' | 'BRAND';

export const VALID_ENTITY_TYPES: EntityType[] = ['VENDOR', 'BRAND'];

/**
 * Normalize a name for alias lookups: lowercase, trim, collapse internal
 * whitespace. Kept deliberately light so the alias table (not aggressive
 * punctuation stripping) decides what counts as equivalent.
 */
export function normalizeName(name: string): string {
  return String(name ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

/**
 * Load every alias for an entity type as a Map from normalized alias -> canonical.
 */
export async function getAliasMap(entityType: EntityType): Promise<Map<string, string>> {
  const rows = await prisma.entityAlias.findMany({
    where: { entity_type: entityType },
    select: { canonical: true, alias: true },
  });
  const map = new Map<string, string>();
  for (const row of rows) {
    map.set(normalizeName(row.alias), row.canonical);
  }
  return map;
}

/**
 * Resolve a raw name to its canonical spelling when a known alias exists.
 * Returns the input unchanged when there is no alias.
 */
export function resolveName(name: string, aliasMap: Map<string, string>): string {
  const norm = normalizeName(name);
  if (!norm) return name;
  return aliasMap.get(norm) ?? name;
}

/**
 * True when two names are the same modulo casing/whitespace OR a configured
 * alias maps one onto the other. Missing/blank names are never "different".
 */
export function namesEquivalent(
  a: string | null | undefined,
  b: string | null | undefined,
  aliasMap: Map<string, string>
): boolean {
  const normA = normalizeName(a || '');
  const normB = normalizeName(b || '');
  if (!normA || !normB) return true; // blank side — never a mismatch
  if (normA === normB) return true;
  const resolvedA = resolveName(normA, aliasMap);
  const resolvedB = resolveName(normB, aliasMap);
  return normalizeName(resolvedA) === normalizeName(resolvedB);
}

export async function listAliases(entityType?: string) {
  const where = entityType && VALID_ENTITY_TYPES.includes(entityType as EntityType)
    ? { entity_type: entityType }
    : undefined;
  return prisma.entityAlias.findMany({
    where,
    orderBy: [{ entity_type: 'asc' }, { canonical: 'asc' }, { alias: 'asc' }],
  });
}

export async function createAlias(
  entityType: string,
  canonical: string,
  alias: string,
  createdBy?: string
) {
  const type = entityType.toUpperCase();
  if (!VALID_ENTITY_TYPES.includes(type as EntityType)) {
    throw new AppError(`Invalid entity_type "${entityType}" — expected VENDOR or BRAND`, 400);
  }
  const canon = String(canonical ?? '').trim();
  const al = String(alias ?? '').trim();
  if (!canon || !al) {
    throw new AppError('Both canonical and alias are required', 400);
  }
  if (normalizeName(canon) === normalizeName(al)) {
    throw new AppError('Alias must differ from the canonical name', 400);
  }
  return prisma.entityAlias.create({
    data: {
      entity_type: type,
      canonical: canon,
      alias: al,
      created_by: createdBy,
    },
  });
}

export async function deleteAlias(id: string) {
  return prisma.entityAlias.delete({ where: { id } });
}
