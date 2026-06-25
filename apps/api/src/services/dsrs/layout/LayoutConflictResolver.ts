/**
 * DSRS v4 - Layout Conflict Resolver
 * 
 * Region-based conflict resolution rules
 * FOOTER TOTAL > TABLE TOTAL unless anomaly detected
 * BANK region values NEVER compete with amount
 * HEADER invoice_number NEVER comes from TABLE
 */

import { Candidate, FieldType } from '../tournament/Candidate';
import { RegionType } from './LayoutGraphBuilder';
import { RegionFieldBinding } from './RegionFieldBinding';

export interface ConflictRule {
  name: string;
  description: string;
  priority: number; // Higher = more important
  condition: (candidates: Map<RegionType, Candidate[]>) => boolean;
  resolution: (candidates: Map<RegionType, Candidate[]>) => Candidate[];
}

export class LayoutConflictResolver {
  private rules: ConflictRule[];
  private fieldBinding: RegionFieldBinding;

  constructor(fieldBinding?: RegionFieldBinding) {
    this.fieldBinding = fieldBinding || new RegionFieldBinding();
    this.rules = this.initializeRules();
  }

  /**
   * Initialize conflict resolution rules
   */
  private initializeRules(): ConflictRule[] {
    const rules: ConflictRule[] = [];

    // Rule 1: FOOTER TOTAL > TABLE TOTAL (unless anomaly)
    rules.push({
      name: 'FOOTER_TOTAL_PRIORITY',
      description: 'Footer total has priority over table total unless anomaly detected',
      priority: 100,
      condition: (candidates) => {
        const footerCandidates = candidates.get('FOOTER') || [];
        const tableCandidates = candidates.get('TABLE') || [];
        return footerCandidates.length > 0 && tableCandidates.length > 0;
      },
      resolution: (candidates) => {
        const footerCandidates = candidates.get('FOOTER') || [];
        const tableCandidates = candidates.get('TABLE') || [];

        // Check for anomaly (footer total significantly different from table sum)
        const footerTotal = footerCandidates[0].value;
        const tableTotal = tableCandidates[0].value;
        const difference = Math.abs(footerTotal - tableTotal) / Math.max(footerTotal, tableTotal);

        if (difference > 0.1) {
          // Anomaly detected, keep both for further analysis
          console.log(`[LayoutConflictResolver] Anomaly detected: footer (${footerTotal}) vs table (${tableTotal}) difference ${(difference * 100).toFixed(1)}%`);
          return [...footerCandidates, ...tableCandidates];
        }

        // No anomaly, prefer footer
        console.log(`[LayoutConflictResolver] No anomaly, preferring footer total: ${footerTotal}`);
        return footerCandidates;
      }
    });

    // Rule 2: BANK region values NEVER compete with amount
    rules.push({
      name: 'BANK_AMOUNT_EXCLUSION',
      description: 'Bank region values are excluded from amount candidates',
      priority: 200,
      condition: (candidates) => {
        const bankCandidates = candidates.get('BANK') || [];
        return bankCandidates.length > 0;
      },
      resolution: (candidates) => {
        const allCandidates: Candidate[] = [];
        
        for (const [region, regionCandidates] of candidates.entries()) {
          if (region !== 'BANK') {
            allCandidates.push(...regionCandidates);
          } else {
            console.log(`[LayoutConflictResolver] Excluding ${regionCandidates.length} candidates from BANK region`);
          }
        }
        
        return allCandidates;
      }
    });

    // Rule 3: HEADER invoice_number NEVER comes from TABLE
    rules.push({
      name: 'HEADER_INVOICE_NUMBER_ONLY',
      description: 'Invoice number must come from HEADER region, not TABLE',
      priority: 150,
      condition: (candidates) => {
        const headerCandidates = candidates.get('HEADER') || [];
        const tableCandidates = candidates.get('TABLE') || [];
        return headerCandidates.length > 0 && tableCandidates.length > 0;
      },
      resolution: (candidates) => {
        const headerCandidates = candidates.get('HEADER') || [];
        const tableCandidates = candidates.get('TABLE') || [];

        if (headerCandidates.length > 0) {
          console.log(`[LayoutConflictResolver] Using HEADER invoice number, excluding TABLE candidates`);
          return headerCandidates;
        }

        // Fallback to table if no header candidates
        console.log(`[LayoutConflictResolver] No HEADER candidates, using TABLE as fallback`);
        return tableCandidates;
      }
    });

    // Rule 4: SKU must come from TABLE only
    rules.push({
      name: 'SKU_TABLE_ONLY',
      description: 'SKU candidates must come from TABLE region only',
      priority: 180,
      condition: (candidates) => {
        const tableCandidates = candidates.get('TABLE') || [];
        const otherRegions = Array.from(candidates.keys()).filter(r => r !== 'TABLE');
        return tableCandidates.length > 0 && otherRegions.length > 0;
      },
      resolution: (candidates) => {
        const tableCandidates = candidates.get('TABLE') || [];
        
        if (tableCandidates.length > 0) {
          console.log(`[LayoutConflictResolver] Using TABLE SKU candidates only`);
          return tableCandidates;
        }

        // If no table candidates, return empty (SKU must be in table)
        console.log(`[LayoutConflictResolver] No TABLE SKU candidates, returning empty`);
        return [];
      }
    });

    // Rule 5: Account number must come from BANK only
    rules.push({
      name: 'ACCOUNT_NUMBER_BANK_ONLY',
      description: 'Account number must come from BANK region only',
      priority: 190,
      condition: (candidates) => {
        const bankCandidates = candidates.get('BANK') || [];
        const otherRegions = Array.from(candidates.keys()).filter(r => r !== 'BANK');
        return bankCandidates.length > 0 && otherRegions.length > 0;
      },
      resolution: (candidates) => {
        const bankCandidates = candidates.get('BANK') || [];
        
        if (bankCandidates.length > 0) {
          console.log(`[LayoutConflictResolver] Using BANK account number candidates only`);
          return bankCandidates;
        }

        // If no bank candidates, return empty
        console.log(`[LayoutConflictResolver] No BANK account number candidates, returning empty`);
        return [];
      }
    });

    // Rule 6: Vendor must come from HEADER only
    rules.push({
      name: 'VENDOR_HEADER_ONLY',
      description: 'Vendor must come from HEADER region only',
      priority: 170,
      condition: (candidates) => {
        const headerCandidates = candidates.get('HEADER') || [];
        const otherRegions = Array.from(candidates.keys()).filter(r => r !== 'HEADER');
        return headerCandidates.length > 0 && otherRegions.length > 0;
      },
      resolution: (candidates) => {
        const headerCandidates = candidates.get('HEADER') || [];
        
        if (headerCandidates.length > 0) {
          console.log(`[LayoutConflictResolver] Using HEADER vendor candidates only`);
          return headerCandidates;
        }

        // Fallback to META if no header candidates
        const metaCandidates = candidates.get('META') || [];
        if (metaCandidates.length > 0) {
          console.log(`[LayoutConflictResolver] No HEADER candidates, using META as fallback`);
          return metaCandidates;
        }

        console.log(`[LayoutConflictResolver] No HEADER or META vendor candidates, returning empty`);
        return [];
      }
    });

    return rules;
  }

  /**
   * Resolve conflicts for a field
   */
  resolveConflicts(field: FieldType, candidates: Map<RegionType, Candidate[]>): Candidate[] {
    console.log(`\n[LayoutConflictResolver] Resolving conflicts for field: ${field}`);

    // Sort rules by priority (highest first)
    const sortedRules = [...this.rules].sort((a, b) => b.priority - a.priority);

    for (const rule of sortedRules) {
      if (rule.condition(candidates)) {
        console.log(`[LayoutConflictResolver] Applying rule: ${rule.name}`);
        const resolved = rule.resolution(candidates);
        return resolved;
      }
    }

    // No rules applied, return all candidates
    console.log(`[LayoutConflictResolver] No rules applied, returning all candidates`);
    const allCandidates: Candidate[] = [];
    for (const regionCandidates of candidates.values()) {
      allCandidates.push(...regionCandidates);
    }
    return allCandidates;
  }

  /**
   * Add custom conflict rule
   */
  addRule(rule: ConflictRule): void {
    this.rules.push(rule);
  }

  /**
   * Remove rule by name
   */
  removeRule(name: string): void {
    this.rules = this.rules.filter(rule => rule.name !== name);
  }

  /**
   * Get all rules
   */
  getRules(): ConflictRule[] {
    return [...this.rules];
  }

  /**
   * Update field binding
   */
  setFieldBinding(binding: RegionFieldBinding): void {
    this.fieldBinding = binding;
  }

  /**
   * Get field binding
   */
  getFieldBinding(): RegionFieldBinding {
    return this.fieldBinding;
  }

  /**
   * Log conflict resolution
   */
  logConflictResolution(field: FieldType, candidates: Map<RegionType, Candidate[]>): void {
    console.log(`\n=== CONFLICT RESOLUTION FOR ${field} ===`);
    
    for (const [region, regionCandidates] of candidates.entries()) {
      console.log(`\n${region}:`);
      regionCandidates.forEach(c => {
        console.log(`  - ${c.value} (conf: ${c.confidence.toFixed(3)})`);
      });
    }
    
    const resolved = this.resolveConflicts(field, candidates);
    console.log(`\nResolved candidates: ${resolved.length}`);
    resolved.forEach(c => {
      console.log(`  - ${c.value} (conf: ${c.confidence.toFixed(3)})`);
    });
    
    console.log('\n=== END CONFLICT RESOLUTION ===\n');
  }
}
