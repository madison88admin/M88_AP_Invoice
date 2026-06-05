import prisma from '../config/database';
import { AppError } from '../middleware/errorHandler';

export interface VendorMatchResult {
  vendor_id: string;
  vendor_name: string;
  match_type: 'exact' | 'alias' | 'fuzzy' | 'partial' | 'none';
  confidence: number;
}

export async function matchVendor(vendorName: string): Promise<VendorMatchResult> {
  const normalizedInput = vendorName.toUpperCase().trim();

  // Step 1: Exact match on Vendor.name
  const exactMatch = await prisma.vendor.findFirst({
    where: {
      name: {
        equals: vendorName,
        mode: 'insensitive',
      },
    },
  });

  if (exactMatch) {
    return {
      vendor_id: exactMatch.id,
      vendor_name: exactMatch.name,
      match_type: 'exact',
      confidence: 1.0,
    };
  }

  // Step 2: Exact match on Vendor.name_aliases array
  const allVendors = await prisma.vendor.findMany();
  for (const vendor of allVendors) {
    if (vendor.name_aliases.some(alias => 
      alias.toUpperCase() === normalizedInput
    )) {
      return {
        vendor_id: vendor.id,
        vendor_name: vendor.name,
        match_type: 'alias',
        confidence: 0.95,
      };
    }
  }

  // Step 3: Fuzzy match (Levenshtein distance ≤ 3, case-insensitive)
  for (const vendor of allVendors) {
    const distance = levenshteinDistance(normalizedInput, vendor.name.toUpperCase());
    if (distance <= 3) {
      const confidence = 1 - (distance / Math.max(normalizedInput.length, vendor.name.length));
      return {
        vendor_id: vendor.id,
        vendor_name: vendor.name,
        match_type: 'fuzzy',
        confidence,
      };
    }
  }

  // Step 4: Partial match on key tokens
  const inputTokens = normalizedInput.split(/\s+/).filter(t => t.length > 2);
  for (const vendor of allVendors) {
    const vendorTokens = vendor.name.toUpperCase().split(/\s+/).filter(t => t.length > 2);
    
    const commonTokens = inputTokens.filter(token => 
      vendorTokens.some(vToken => vToken.includes(token) || token.includes(vToken))
    );

    if (commonTokens.length >= 2) {
      const confidence = commonTokens.length / Math.max(inputTokens.length, vendorTokens.length);
      return {
        vendor_id: vendor.id,
        vendor_name: vendor.name,
        match_type: 'partial',
        confidence,
      };
    }
  }

  // Step 5: No match found
  throw new AppError(
    `No matching vendor found for "${vendorName}". Please assign vendor manually.`,
    404
  );
}

function levenshteinDistance(str1: string, str2: string): number {
  const matrix = [];

  for (let i = 0; i <= str2.length; i++) {
    matrix[i] = [i];
  }

  for (let j = 0; j <= str1.length; j++) {
    matrix[0][j] = j;
  }

  for (let i = 1; i <= str2.length; i++) {
    for (let j = 1; j <= str1.length; j++) {
      if (str2.charAt(i - 1) === str1.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1
        );
      }
    }
  }

  return matrix[str2.length][str1.length];
}

export async function getVendorSuggestions(searchTerm: string, limit: number = 5) {
  const normalizedSearch = searchTerm.toUpperCase().trim();
  
  const vendors = await prisma.vendor.findMany({
    where: {
      OR: [
        {
          name: {
            contains: searchTerm,
            mode: 'insensitive',
          },
        },
        {
          name_aliases: {
            hasSome: [searchTerm],
          },
        },
      ],
    },
    take: limit,
  });

  return vendors.map(vendor => ({
    id: vendor.id,
    name: vendor.name,
    aliases: vendor.name_aliases,
    confidence: calculateMatchConfidence(normalizedSearch, vendor),
  })).sort((a, b) => b.confidence - a.confidence);
}

function calculateMatchConfidence(searchTerm: string, vendor: any): number {
  const vendorName = vendor.name.toUpperCase();
  
  if (vendorName === searchTerm) return 1.0;
  if (vendor.name_aliases.some((alias: string) => alias.toUpperCase() === searchTerm)) return 0.95;
  
  const distance = levenshteinDistance(searchTerm, vendorName);
  if (distance <= 3) return 1 - (distance / Math.max(searchTerm.length, vendorName.length));
  
  const searchTokens = searchTerm.split(/\s+/).filter((t: string) => t.length > 2);
  const vendorTokens = vendorName.split(/\s+/).filter((t: string) => t.length > 2);
  const commonTokens = searchTokens.filter((token: string) => 
    vendorTokens.some((vToken: string) => vToken.includes(token) || token.includes(vToken))
  );
  
  if (commonTokens.length >= 2) {
    return commonTokens.length / Math.max(searchTokens.length, vendorTokens.length);
  }
  
  return 0;
}
