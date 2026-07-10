import { PrismaClient, InvoiceTemplateType } from '@prisma/client';
import { VENDOR_TEMPLATE_MAPPINGS } from './vendor-template-mapping';

const prisma = new PrismaClient();

interface VendorSeedData {
  name: string;
  name_aliases: string[];
  invoice_template_type: InvoiceTemplateType;
  beneficiary_name?: string;
  supplier_location?: string;
  bank_name?: string | null;
  bank_name_alt?: string[];
  bank_address?: string;
  account_number?: string | null;
  account_number_alt?: string[];
  swift_code?: string | null;
  swift_code_alt?: string[];
  iban?: string;
  sort_code?: string;
  aba_routing_number?: string;
  intermediary_bank_name?: string;
  intermediary_bank_swift?: string;
  has_multiple_accounts?: boolean;
  gstin_number?: string;
  bir_tin?: string;
  vat_number?: string;
  eori_number?: string;
}

// Existing vendors with known bank details from the original seed.ts
const EXISTING_VENDORS_WITH_BANK_DETAILS: Record<string, Partial<VendorSeedData>> = {
  "PT Paxar China": {
    name_aliases: ["Paxar (China) Limited", "Avery Dennison Paxar (China) Ltd", "PT PAXAR CHINA", "AVERY DENNINSON PAXAR (CHINA) LTD"],
    bank_name: "Hang Seng Bank",
    account_number: "385-502275-883",
    swift_code: "HASEHKHH",
    supplier_location: "HK",
  },
  "Avery Vietnam": {
    name_aliases: ["Avery Dennison (VN)", "AVERY VN", "Avery Dennison Vietnam", "Avery Dennison RIS Vietnam CO., Limited"],
    supplier_location: "Vietnam",
  },
  "Trimco HK": {
    name_aliases: ["Trimco Group (HK) Limited", "TRIMCO", "TRIMCO GROUP (HONG KONG)", "TRIMCO GROUP TRADING (H.K.)CO., LTD."],
    bank_name: "Hang Seng Bank",
    swift_code: "CTCBHKHH",
    supplier_location: "HK",
  },
  "R-PAC Vietnam": {
    name_aliases: ["R-PAC VN", "RPAC Vietnam", "R-PAC VIETNAM LIMITED"],
    bank_name: "HSBC Vietnam",
    swift_code: "HSBCVNVX",
    supplier_location: "Vietnam",
  },
  "Rudholm & Haak HK": {
    name_aliases: ["Rudholm HK", "RUDHOLM", "RUDHOLM & HAAK (H.K.) LIMITED"],
    bank_name: "Citibank HK",
    swift_code: "CITIHKHX",
    supplier_location: "HK",
  },
  "Nilorn HK": {
    name_aliases: ["Nilorn", "NILORN HK", "Nilorn East Asia Ltd."],
    supplier_location: "HK",
  },
  "Brand ID LLC": {
    name_aliases: ["Brand ID", "BRAND ID"],
    bank_name: "First Chatham Bank",
    swift_code: "FCBTUS33",
    supplier_location: "USA",
  },
  "Fineline Technologies": {
    name_aliases: ["Fineline", "FINELINE"],
    supplier_location: "HK",
  },
  "C&T Label": {
    name_aliases: ["C&T", "C AND T LABEL", "C&T LABEL COMPANY LTD.", "C&T Garment Accessories Co.Ltd"],
    supplier_location: "HK",
  },
  "Jointak": {
    name_aliases: ["JOINTAK", "Jointak Labels Company Ltd.", "JOINTAK LABELS COMPANY LIMITED (DYNAFIT)"],
    supplier_location: "HK",
  },
  "Charming Printing Ltd": {
    name_aliases: ["Charming Printing & Packing", "CHARMING"],
    bank_name: "HSBC HK",
    bank_name_alt: ["Hongkong and Shanghai Banking Corporation", "HSBC Hong Kong", "The Hongkong and Shanghai Banking Corporation Limited"],
    account_number: "808-190896-838",
    account_number_alt: ["808190896838"],
    swift_code: "HSBCHKHH",
    swift_code_alt: ["HSBCHKHHXXX"],
    supplier_location: "HK",
  },
  "Weavabel": {
    name_aliases: ["WEAVABEL"],
    bank_name: "Lloyds Bank",
    iban: "GB29LOYD30949301273801",
    sort_code: "30-94-93",
    vat_number: "GB123456789",
    supplier_location: "UK",
  },
  "Tentac": {
    name_aliases: ["TENTAC"],
    bank_name: null,
    supplier_location: "HK",
  },
  "G&F Industries": {
    name_aliases: ["G & F", "G AND F", "GF INDUSTRIES", "G & F TRADING (HONG KONG) LTD."],
    supplier_location: "HK",
  },
  "Manohar Filaments": {
    name_aliases: ["Manohar Filaments Pvt. Ltd.", "MANOHAR", "MANOHAR FILAMENTS PVT LTD"],
    gstin_number: "27AABCM1234F1Z5",
    supplier_location: "India",
  },
  "Vela Vietnam Packaging": {
    name_aliases: ["Vela Vietnam", "VELA VN", "VELA VIETNAM PACKAGING LIMITED COMPANY"],
    supplier_location: "Vietnam",
  },
  "Zhejiang Weixing": {
    name_aliases: ["ZHEJIANG WEIXING", "Weixing", "Zhejiang Weixing Imp. & Exp. Co.Ltd"],
    supplier_location: "China",
  },
  "Shunte": {
    name_aliases: ["SHUNTE", "Beijing Shunte Science & Technology Corporation"],
    supplier_location: "China",
  },
  "Dragon Times": {
    name_aliases: ["DRAGON TIMES", "Dragon Times Accessory Co. Ltd."],
    supplier_location: "HK",
  },
  "Lee Bou Vietnam": {
    name_aliases: ["LEE BOU VN", "Lee Bou", "Lee Bou International Binh Duong Company", "LEE BOU INTERNATIONAL CO.,LTD"],
    supplier_location: "Vietnam",
  },
  "Bo Hing": {
    name_aliases: ["BO HING", "BO HING LABEL INDUSTRIES CO. LTD."],
    supplier_location: "HK",
  },
  "Dong Guan City": {
    name_aliases: ["DONG GUAN", "DONGGUAN", "DONG GUAN CITY OCAN WEAVING CO.,LTD"],
    supplier_location: "China",
  },
  "Perfect China": {
    name_aliases: ["PERFECT CHINA", "Perfect China Supplies"],
    supplier_location: "China",
  },
  "Amass Enterprises": {
    name_aliases: ["AMASS", "AMASSS", "AMASS INTERNATIONAL LTD"],
    bank_name: "HSBC HK",
    supplier_location: "HK",
  },
  "Ducksan Enterprise": {
    name_aliases: ["DUCKSAN", "DUCKSAN ENTERPRISE CO. LTD"],
    bank_name: "Industrial Bank of Korea",
    swift_code: "IBKOKRSE",
    supplier_location: "Korea",
  },
  "Master Air Inc": {
    name_aliases: ["Master Air, Inc.", "MASTER AIR", "MASTER AIR INTERNATIONAL INC."],
    bank_name: "JP Morgan Chase",
    aba_routing_number: "021000021",
    supplier_location: "USA",
  },
  "Far Dar Enterprise": {
    name_aliases: ["Far Dar Enterprise Co., Ltd.", "FAR DAR", "FAR DAR EXPRESS"],
    supplier_location: "Taiwan",
  },
  "SF Express": {
    name_aliases: ["SF EXPRESS", "S.F. Express"],
    supplier_location: "HK",
  },
  "Seaman Paper Asia": {
    name_aliases: ["SEAMAN PAPER", "Seaman Paper Asia Ltd", "Seaman Paper Asia Company Limited"],
    bank_name: "HSBC HK",
    account_number: "808-026348-838",
    swift_code: "HSBCHKHH",
    supplier_location: "HK",
  },
  "PT SML Indonesia": {
    name_aliases: ["PT SML", "SML Group", "SML INDONESIA", "PT SML INDONESIA PRIVATE", "SML (Hongkong) Ltd."],
    bank_name: "HSBC Indonesia",
    supplier_location: "Indonesia",
  },
  "PT Victoria": {
    name_aliases: ["PT Victoria Label Indonesia", "PT VICTORIA LABEL"],
    bank_name: null,
    bir_tin: null,
    supplier_location: "Indonesia",
  },
  "Checkpoint Systems": {
    name_aliases: ["Checkpoint", "CHECKPOINT", "CHECKPOINT VIETNAM COMPANY LIMITED", "Checkpoint Apparel Labelling Sol. Asia"],
    supplier_location: "USA",
  },
  "Superdry PH": {
    name_aliases: ["SUPERDRY PH", "Superdry Philippines"],
    bir_tin: "placeholder",
    supplier_location: "Philippines",
  },
  "Kabuhayan Namin": {
    name_aliases: ["KABUHAYAN NAMIN", "Kabuhayan Namin Inc. (SuperDry PH)"],
    bir_tin: "placeholder",
    supplier_location: "Philippines",
  },
};

// Map template type string to InvoiceTemplateType enum
function mapTemplateType(type: string): InvoiceTemplateType {
  const mapping: Record<string, InvoiceTemplateType> = {
    'PRO_FORMA': InvoiceTemplateType.PRO_FORMA,
    'INVOICE': InvoiceTemplateType.INVOICE,
    'COMMERCIAL_INVOICE': InvoiceTemplateType.COMMERCIAL_INVOICE,
    'SALES_INVOICE': InvoiceTemplateType.SALES_INVOICE,
    'PROTO_SAMPLE_INVOICE': InvoiceTemplateType.PROTO_SAMPLE_INVOICE,
    'PREPAID_INVOICE': InvoiceTemplateType.PREPAID_INVOICE,
    'NO_DATA': InvoiceTemplateType.NO_DATA,
  };
  return mapping[type] || InvoiceTemplateType.NO_DATA;
}

// Suppliers that appear multiple times with different template types
// We use the most specific/first occurrence
const DUPLICATE_VENDORS = new Set([
  'PT NEXGEN PACKAGING INDONESIA',
  'R-PAC VIETNAM LIMITED',
  'RUDHOLM & HAAK (H.K.) LIMITED',
  'UPW LIMITED',
  'V MAKE MANUFACTURING AND PRINTING LTD',
  'GLORYTEX VINA CO., LTD.',
  'TMV VINA CO., LTD',
]);

// Track which vendor names we've already seeded to avoid duplicates
const seededNames = new Set<string>();

// Map user-provided vendor names to existing vendor names (for bank detail lookup)
const VENDOR_NAME_TO_EXISTING: Record<string, string> = {
  'AVERY DENNINSON PAXAR (CHINA) LTD': 'PT Paxar China',
  'Avery Dennison RIS Vietnam CO., Limited': 'Avery Vietnam',
  'TRIMCO GROUP (HONG KONG)': 'Trimco HK',
  'TRIMCO GROUP TRADING (H.K.)CO., LTD.': 'Trimco HK',
  'R-PAC VIETNAM LIMITED': 'R-PAC Vietnam',
  'RUDHOLM & HAAK (H.K.) LIMITED': 'Rudholm & Haak HK',
  'Nilorn East Asia Ltd.': 'Nilorn HK',
  'Brand ID': 'Brand ID LLC',
  'Fineline Technologies': 'Fineline Technologies',
  'C&T LABEL COMPANY LTD.': 'C&T Label',
  'C&T Garment Accessories Co.Ltd': 'C&T Label',
  'Jointak Labels Company Ltd.': 'Jointak',
  'JOINTAK LABELS COMPANY LIMITED (DYNAFIT)': 'Jointak',
  'Charming Printing Ltd.': 'Charming Printing Ltd',
  'Weavabel': 'Weavabel',
  'TENTAC': 'Tentac',
  'G & F TRADING (HONG KONG) LTD.': 'G&F Industries',
  'MANOHAR FILAMENTS PVT LTD': 'Manohar Filaments',
  'VELA VIETNAM PACKAGING LIMITED COMPANY': 'Vela Vietnam Packaging',
  'Zhejiang Weixing Imp. & Exp. Co.Ltd': 'Zhejiang Weixing',
  'Beijing Shunte Science & Technology Corporation': 'Shunte',
  'Dragon Times Accessory Co. Ltd.': 'Dragon Times',
  'Lee Bou International Binh Duong Company': 'Lee Bou Vietnam',
  'LEE BOU INTERNATIONAL CO.,LTD': 'Lee Bou Vietnam',
  'BO HING LABEL INDUSTRIES CO. LTD.': 'Bo Hing',
  'DONG GUAN CITY OCAN WEAVING CO.,LTD': 'Dong Guan City',
  'Perfect China Supplies': 'Perfect China',
  'AMASS INTERNATIONAL LTD': 'Amass Enterprises',
  'DUCKSAN ENTERPRISE CO. LTD': 'Ducksan Enterprise',
  'MASTER AIR INTERNATIONAL INC.': 'Master Air Inc',
  'FAR DAR EXPRESS': 'Far Dar Enterprise',
  'S.F. Express': 'SF Express',
  'Seaman Paper Asia Company Limited': 'Seaman Paper Asia',
  'PT SML INDONESIA PRIVATE': 'PT SML Indonesia',
  'SML (Hongkong) Ltd.': 'PT SML Indonesia',
  'PT VICTORIA LABEL': 'PT Victoria',
  'CHECKPOINT VIETNAM COMPANY LIMITED': 'Checkpoint Systems',
  'Checkpoint Apparel Labelling Sol. Asia': 'Checkpoint Systems',
  'Kabuhayan Namin Inc. (SuperDry PH)': 'Kabuhayan Namin',
};

async function main() {
  console.log('Starting comprehensive vendor seed...');
  let created = 0;
  let updated = 0;
  let skipped = 0;

  // First, seed existing vendors with bank details (from original seed.ts)
  console.log('\n--- Phase 1: Seeding existing vendors with bank details ---');
  for (const [existingName, existingData] of Object.entries(EXISTING_VENDORS_WITH_BANK_DETAILS)) {
    const templateType = existingData.invoice_template_type || InvoiceTemplateType.INVOICE;
    const vendorData: VendorSeedData = {
      name: existingName,
      name_aliases: existingData.name_aliases || [],
      invoice_template_type: templateType,
      ...existingData,
    } as VendorSeedData;

    try {
      const existing = await prisma.vendor.findFirst({ where: { name: existingName } });
      if (existing) {
        await prisma.vendor.update({
          where: { id: existing.id },
          data: {
            name_aliases: vendorData.name_aliases,
            invoice_template_type: vendorData.invoice_template_type,
            ...(vendorData.bank_name !== undefined ? { bank_name: vendorData.bank_name } : {}),
            ...(vendorData.bank_name_alt ? { bank_name_alt: vendorData.bank_name_alt } : {}),
            ...(vendorData.account_number !== undefined ? { account_number: vendorData.account_number } : {}),
            ...(vendorData.account_number_alt ? { account_number_alt: vendorData.account_number_alt } : {}),
            ...(vendorData.swift_code !== undefined ? { swift_code: vendorData.swift_code } : {}),
            ...(vendorData.swift_code_alt ? { swift_code_alt: vendorData.swift_code_alt } : {}),
            ...(vendorData.iban ? { iban: vendorData.iban } : {}),
            ...(vendorData.sort_code ? { sort_code: vendorData.sort_code } : {}),
            ...(vendorData.aba_routing_number ? { aba_routing_number: vendorData.aba_routing_number } : {}),
            ...(vendorData.gstin_number ? { gstin_number: vendorData.gstin_number } : {}),
            ...(vendorData.bir_tin ? { bir_tin: vendorData.bir_tin } : {}),
            ...(vendorData.vat_number ? { vat_number: vendorData.vat_number } : {}),
            ...(vendorData.supplier_location ? { supplier_location: vendorData.supplier_location } : {}),
          },
        });
        updated++;
      } else {
        await prisma.vendor.create({ data: vendorData });
        created++;
      }
      seededNames.add(existingName.toUpperCase().trim());
      console.log(`  Seeded: ${existingName} (template: ${templateType})`);
    } catch (err: any) {
      console.error(`  Error seeding ${existingName}: ${err.message}`);
      skipped++;
    }
  }

  // Then, seed all new vendors from the template mapping
  console.log('\n--- Phase 2: Seeding new vendors from template mapping ---');
  for (const mapping of VENDOR_TEMPLATE_MAPPINGS) {
    const vendorName = mapping.name.toUpperCase().trim();

    // Skip if already seeded under an existing name
    if (seededNames.has(vendorName)) {
      skipped++;
      continue;
    }

    // Check if this vendor maps to an existing vendor
    const existingName = VENDOR_NAME_TO_EXISTING[mapping.name];
    if (existingName && seededNames.has(existingName.toUpperCase().trim())) {
      // Add as alias to existing vendor
      try {
        const existing = await prisma.vendor.findFirst({
          where: { name: existingName },
        });
        if (existing) {
          const currentAliases = existing.name_aliases || [];
          if (!currentAliases.includes(mapping.name)) {
            await prisma.vendor.update({
              where: { id: existing.id },
              data: {
                name_aliases: [...currentAliases, mapping.name],
              },
            });
            console.log(`  Added alias "${mapping.name}" to existing vendor: ${existingName}`);
          }
          seededNames.add(vendorName);
          updated++;
          continue;
        }
      } catch (err: any) {
        console.error(`  Error adding alias ${mapping.name}: ${err.message}`);
      }
    }

    // Skip duplicates (vendors appearing with multiple template types — first occurrence wins)
    if (DUPLICATE_VENDORS.has(vendorName) && seededNames.has(vendorName)) {
      skipped++;
      continue;
    }

    const templateType = mapTemplateType(mapping.invoice_template_type);

    // Infer supplier location from vendor name
    let supplierLocation = 'Unknown';
    const nameUpper = mapping.name.toUpperCase();
    if (nameUpper.includes('VIETNAM') || nameUpper.includes('VINA') || nameUpper.includes('VN') || nameUpper.includes('BINH DUONG')) {
      supplierLocation = 'Vietnam';
    } else if (nameUpper.includes('HONG KONG') || nameUpper.includes('HK') || nameUpper.includes('H.K.')) {
      supplierLocation = 'HK';
    } else if (nameUpper.includes('CHINA') || nameUpper.includes('SHANGHAI') || nameUpper.includes('GUANGDONG') || nameUpper.includes('DONGGUAN') || nameUpper.includes('DONG GUAN') || nameUpper.includes('NINGBO') || nameUpper.includes('JIANGSU') || nameUpper.includes('ZHEJIANG') || nameUpper.includes('GUANGZHOU') || nameUpper.includes('ZHANGJIAGANG') || nameUpper.includes('BEIJING')) {
      supplierLocation = 'China';
    } else if (nameUpper.includes('INDONESIA') || nameUpper.includes('PT ')) {
      supplierLocation = 'Indonesia';
    } else if (nameUpper.includes('KOREA') || nameUpper.includes('KOREAN')) {
      supplierLocation = 'Korea';
    } else if (nameUpper.includes('TAIWAN')) {
      supplierLocation = 'Taiwan';
    } else if (nameUpper.includes('PHILIPPINES') || nameUpper.includes('PH') || nameUpper.includes('KABUHAYAN')) {
      supplierLocation = 'Philippines';
    } else if (nameUpper.includes('USA') || nameUpper.includes('US ')) {
      supplierLocation = 'USA';
    } else if (nameUpper.includes('UK') || nameUpper.includes('LLOYDS')) {
      supplierLocation = 'UK';
    } else if (nameUpper.includes('ITALY') || nameUpper.includes('SRL')) {
      supplierLocation = 'Italy';
    } else if (nameUpper.includes('INDIA') || nameUpper.includes('PVT')) {
      supplierLocation = 'India';
    }

    const vendorData: VendorSeedData = {
      name: mapping.name,
      name_aliases: [],
      invoice_template_type: templateType,
      supplier_location: supplierLocation,
    };

    try {
      const existing = await prisma.vendor.findFirst({ where: { name: mapping.name } });
      if (existing) {
        await prisma.vendor.update({
          where: { id: existing.id },
          data: { invoice_template_type: templateType },
        });
        updated++;
      } else {
        await prisma.vendor.create({ data: vendorData });
        created++;
      }
      seededNames.add(vendorName);
      console.log(`  Seeded: ${mapping.name} (template: ${templateType}, location: ${supplierLocation})`);
    } catch (err: any) {
      console.error(`  Error seeding ${mapping.name}: ${err.message}`);
      skipped++;
    }
  }

  console.log(`\n--- Seed Summary ---`);
  console.log(`  Created: ${created}`);
  console.log(`  Updated (incl. aliases): ${updated}`);
  console.log(`  Skipped (duplicates): ${skipped}`);
  console.log(`  Total processed: ${created + updated + skipped}`);
  console.log('Comprehensive vendor seed completed successfully!');
}

main()
  .catch((e) => {
    console.error('Error seeding vendors:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
