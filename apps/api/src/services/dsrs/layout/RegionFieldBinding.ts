/**
 * DSRS v4 - Region-to-Field Binding
 * 
 * Enforces hard filters: field → allowed regions
 * Prevents cross-region contamination (e.g., BANK numbers leaking into amount)
 */

import { RegionType } from './LayoutGraphBuilder';
import { FieldType } from '../tournament/Candidate';

export interface FieldRegionBinding {
  field: FieldType;
  allowedRegions: RegionType[];
  preferredRegion?: RegionType; // Highest priority region
  forbiddenRegions: RegionType[]; // Regions where this field should NEVER appear
}

export class RegionFieldBinding {
  private bindings: Map<FieldType, FieldRegionBinding>;

  constructor() {
    this.bindings = this.initializeBindings();
  }

  /**
   * Initialize field-to-region bindings
   */
  private initializeBindings(): Map<FieldType, FieldRegionBinding> {
    const bindings = new Map<FieldType, FieldRegionBinding>();

    // Amount: FOOTER and TABLE only, never BANK
    bindings.set('amount', {
      field: 'amount',
      allowedRegions: ['FOOTER', 'TABLE'],
      preferredRegion: 'FOOTER',
      forbiddenRegions: ['BANK', 'HEADER', 'META']
    });

    // Invoice number: HEADER only
    bindings.set('invoice_number', {
      field: 'invoice_number',
      allowedRegions: ['HEADER'],
      preferredRegion: 'HEADER',
      forbiddenRegions: ['TABLE', 'FOOTER', 'BANK']
    });

    // Vendor: HEADER only
    bindings.set('vendor', {
      field: 'vendor',
      allowedRegions: ['HEADER'],
      preferredRegion: 'HEADER',
      forbiddenRegions: ['TABLE', 'FOOTER', 'BANK']
    });

    // Invoice date: HEADER only
    bindings.set('invoice_date', {
      field: 'invoice_date',
      allowedRegions: ['HEADER'],
      preferredRegion: 'HEADER',
      forbiddenRegions: ['TABLE', 'FOOTER', 'BANK']
    });

    // SKU: TABLE only
    bindings.set('sku', {
      field: 'sku',
      allowedRegions: ['TABLE'],
      preferredRegion: 'TABLE',
      forbiddenRegions: ['HEADER', 'FOOTER', 'BANK', 'META']
    });

    // Quantity: TABLE only
    bindings.set('qty', {
      field: 'qty',
      allowedRegions: ['TABLE'],
      preferredRegion: 'TABLE',
      forbiddenRegions: ['HEADER', 'FOOTER', 'BANK']
    });

    // Unit price: TABLE only
    bindings.set('unit_price', {
      field: 'unit_price',
      allowedRegions: ['TABLE'],
      preferredRegion: 'TABLE',
      forbiddenRegions: ['HEADER', 'FOOTER', 'BANK']
    });

    // Bank account: BANK only
    bindings.set('account_number', {
      field: 'account_number',
      allowedRegions: ['BANK'],
      preferredRegion: 'BANK',
      forbiddenRegions: ['HEADER', 'TABLE', 'FOOTER', 'META']
    });

    // SWIFT: BANK only
    bindings.set('swift', {
      field: 'swift',
      allowedRegions: ['BANK'],
      preferredRegion: 'BANK',
      forbiddenRegions: ['HEADER', 'TABLE', 'FOOTER', 'META']
    });

    // PO number: META or HEADER
    bindings.set('po_number', {
      field: 'po_number',
      allowedRegions: ['META', 'HEADER'],
      preferredRegion: 'META',
      forbiddenRegions: ['TABLE', 'FOOTER', 'BANK']
    });

    // Payment terms: META or HEADER
    bindings.set('payment_terms', {
      field: 'payment_terms',
      allowedRegions: ['META', 'HEADER'],
      preferredRegion: 'META',
      forbiddenRegions: ['TABLE', 'FOOTER', 'BANK']
    });

    // Bill to: HEADER only
    bindings.set('bill_to', {
      field: 'bill_to',
      allowedRegions: ['HEADER'],
      preferredRegion: 'HEADER',
      forbiddenRegions: ['TABLE', 'FOOTER', 'BANK']
    });

    // Ship to: HEADER or META
    bindings.set('ship_to', {
      field: 'ship_to',
      allowedRegions: ['HEADER', 'META'],
      preferredRegion: 'HEADER',
      forbiddenRegions: ['TABLE', 'FOOTER', 'BANK']
    });

    return bindings;
  }

  /**
   * Check if a field is allowed in a region
   */
  isFieldAllowedInRegion(field: FieldType, region: RegionType): boolean {
    const binding = this.bindings.get(field);
    if (!binding) {
      // If no binding defined, allow by default
      return true;
    }

    // Check if region is explicitly forbidden
    if (binding.forbiddenRegions.includes(region)) {
      return false;
    }

    // Check if region is in allowed list
    return binding.allowedRegions.includes(region);
  }

  /**
   * Get allowed regions for a field
   */
  getAllowedRegions(field: FieldType): RegionType[] {
    const binding = this.bindings.get(field);
    return binding?.allowedRegions || [];
  }

  /**
   * Get preferred region for a field
   */
  getPreferredRegion(field: FieldType): RegionType | null {
    const binding = this.bindings.get(field);
    return binding?.preferredRegion || null;
  }

  /**
   * Get forbidden regions for a field
   */
  getForbiddenRegions(field: FieldType): RegionType[] {
    const binding = this.bindings.get(field);
    return binding?.forbiddenRegions || [];
  }

  /**
   * Filter candidates by region binding
   */
  filterCandidatesByRegion(
    field: FieldType,
    candidates: any[],
    region: RegionType
  ): any[] {
    if (!this.isFieldAllowedInRegion(field, region)) {
      console.log(`[RegionFieldBinding] Field ${field} not allowed in region ${region}, filtering out all candidates`);
      return [];
    }

    return candidates;
  }

  /**
   * Get binding for a field
   */
  getBinding(field: FieldType): FieldRegionBinding | undefined {
    return this.bindings.get(field);
  }

  /**
   * Add custom binding
   */
  addBinding(binding: FieldRegionBinding): void {
    this.bindings.set(binding.field, binding);
  }

  /**
   * Remove binding for a field
   */
  removeBinding(field: FieldType): void {
    this.bindings.delete(field);
  }

  /**
   * Get all bindings
   */
  getAllBindings(): Map<FieldType, FieldRegionBinding> {
    return new Map(this.bindings);
  }

  /**
   * Log binding rules
   */
  logBindings(): void {
    console.log('\n=== REGION-FIELD BINDING RULES ===');
    
    for (const [field, binding] of this.bindings.entries()) {
      console.log(`\n${field}:`);
      console.log(`  Allowed Regions: ${binding.allowedRegions.join(', ')}`);
      console.log(`  Preferred Region: ${binding.preferredRegion || 'none'}`);
      console.log(`  Forbidden Regions: ${binding.forbiddenRegions.join(', ')}`);
    }
    
    console.log('\n=== END BINDING RULES ===\n');
  }
}
