import { PrismaClient, InvoiceTemplateType } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('Starting vendor seed...');

  const vendors = [
    // --- AVERY DENNISON FAMILY ---
    {
      name: "PT Paxar China",
      name_aliases: ["Paxar (China) Limited", "Avery Dennison Paxar (China) Ltd", "PT PAXAR CHINA"],
      invoice_template_type: InvoiceTemplateType.INVOICE,
      bank_name: "Hang Seng Bank",
      account_number: "385-502275-883",
      swift_code: "HASEHKHH",
      supplier_location: "HK",
    },
    {
      name: "Avery Vietnam",
      name_aliases: ["Avery Dennison (VN)", "AVERY VN", "Avery Dennison Vietnam"],
      invoice_template_type: InvoiceTemplateType.INVOICE,
      supplier_location: "Vietnam",
    },
    // --- TRIMS ---
    {
      name: "Trimco HK",
      name_aliases: ["Trimco Group (HK) Limited", "TRIMCO"],
      invoice_template_type: InvoiceTemplateType.PRO_FORMA,
      bank_name: "Hang Seng Bank",
      swift_code: "CTCBHKHH",
      supplier_location: "HK",
    },
    {
      name: "R-PAC Vietnam",
      name_aliases: ["R-PAC VN", "RPAC Vietnam"],
      invoice_template_type: InvoiceTemplateType.COMMERCIAL_INVOICE,
      bank_name: "HSBC Vietnam",
      swift_code: "HSBCVNVX",
      supplier_location: "Vietnam",
    },
    {
      name: "Rudholm & Haak HK",
      name_aliases: ["Rudholm HK", "RUDHOLM"],
      invoice_template_type: InvoiceTemplateType.INVOICE,
      bank_name: "Citibank HK",
      swift_code: "CITIHKHX",
      supplier_location: "HK",
    },
    {
      name: "Nilorn HK",
      name_aliases: ["Nilorn", "NILORN HK"],
      invoice_template_type: InvoiceTemplateType.INVOICE,
      supplier_location: "HK",
    },
    {
      name: "Nilorn CN",
      name_aliases: ["Nilorn China", "NILORN CN"],
      invoice_template_type: InvoiceTemplateType.INVOICE,
      supplier_location: "China",
    },
    {
      name: "Brand ID LLC",
      name_aliases: ["Brand ID", "BRAND ID"],
      invoice_template_type: InvoiceTemplateType.INVOICE,
      bank_name: "First Chatham Bank",
      swift_code: "FCBTUS33",
      supplier_location: "USA",
    },
    {
      name: "Fineline Technologies",
      name_aliases: ["Fineline", "FINELINE"],
      invoice_template_type: InvoiceTemplateType.INVOICE,
      supplier_location: "HK",
    },
    {
      name: "C&T Label",
      name_aliases: ["C&T", "C AND T LABEL"],
      invoice_template_type: InvoiceTemplateType.PRO_FORMA,
      supplier_location: "HK",
    },
    {
      name: "Jointak",
      name_aliases: ["JOINTAK"],
      invoice_template_type: InvoiceTemplateType.PRO_FORMA,
      supplier_location: "HK",
    },
    {
      name: "Charming Printing Ltd",
      name_aliases: ["Charming Printing & Packing", "CHARMING"],
      invoice_template_type: InvoiceTemplateType.PRO_FORMA,
      bank_name: "HSBC HK",
      account_number: "808-190896-838",
      swift_code: "HSBCHKHH",
      supplier_location: "HK",
    },
    {
      name: "Weavabel",
      name_aliases: ["WEAVABEL"],
      invoice_template_type: InvoiceTemplateType.INVOICE,
      bank_name: "Lloyds Bank",
      iban: "GB29LOYD30949301273801",
      sort_code: "30-94-93",
      vat_number: "GB123456789",
      supplier_location: "UK",
    },
    {
      name: "Tentac",
      name_aliases: ["TENTAC"],
      invoice_template_type: InvoiceTemplateType.INVOICE,
      bank_name: null,
      supplier_location: "HK",
    },
    {
      name: "G&F Industries",
      name_aliases: ["G & F", "G AND F", "GF INDUSTRIES"],
      invoice_template_type: InvoiceTemplateType.PRO_FORMA,
      supplier_location: "HK",
    },
    {
      name: "Goodbox",
      name_aliases: ["GOODBOX"],
      invoice_template_type: InvoiceTemplateType.PRO_FORMA,
      supplier_location: "HK",
    },
    {
      name: "Manohar Filaments",
      name_aliases: ["Manohar Filaments Pvt. Ltd.", "MANOHAR"],
      invoice_template_type: InvoiceTemplateType.PRO_FORMA,
      gstin_number: "27AABCM1234F1Z5",
      supplier_location: "India",
    },
    {
      name: "Vela Vietnam Packaging",
      name_aliases: ["Vela Vietnam", "VELA VN"],
      invoice_template_type: InvoiceTemplateType.PRO_FORMA,
      supplier_location: "Vietnam",
    },
    {
      name: "Zhejiang Weixing",
      name_aliases: ["ZHEJIANG WEIXING", "Weixing"],
      invoice_template_type: InvoiceTemplateType.PRO_FORMA,
      supplier_location: "China",
    },
    {
      name: "Shunte",
      name_aliases: ["SHUNTE"],
      invoice_template_type: InvoiceTemplateType.PRO_FORMA,
      supplier_location: "China",
    },
    {
      name: "Dragon Times",
      name_aliases: ["DRAGON TIMES"],
      invoice_template_type: InvoiceTemplateType.PRO_FORMA,
      supplier_location: "HK",
    },
    {
      name: "Lee Bou Vietnam",
      name_aliases: ["LEE BOU VN", "Lee Bou"],
      invoice_template_type: InvoiceTemplateType.INVOICE,
      supplier_location: "Vietnam",
    },
    {
      name: "Bo Hing",
      name_aliases: ["BO HING"],
      invoice_template_type: InvoiceTemplateType.INVOICE,
      supplier_location: "HK",
    },
    {
      name: "Dong Guan City",
      name_aliases: ["DONG GUAN", "DONGGUAN"],
      invoice_template_type: InvoiceTemplateType.PRO_FORMA,
      supplier_location: "China",
    },
    {
      name: "Perfect China",
      name_aliases: ["PERFECT CHINA"],
      invoice_template_type: InvoiceTemplateType.INVOICE,
      supplier_location: "China",
    },
    // --- YARN ---
    {
      name: "Amass Enterprises",
      name_aliases: ["AMASS", "AMASSS"],
      invoice_template_type: InvoiceTemplateType.INVOICE,
      bank_name: "HSBC HK",
      supplier_location: "HK",
    },
    {
      name: "Ducksan Enterprise",
      name_aliases: ["DUCKSAN"],
      invoice_template_type: InvoiceTemplateType.INVOICE,
      bank_name: "Industrial Bank of Korea",
      swift_code: "IBKOKRSE",
      supplier_location: "Korea",
    },
    // --- SHIPPING / FREIGHT ---
    {
      name: "Master Air Inc",
      name_aliases: ["Master Air, Inc.", "MASTER AIR"],
      invoice_template_type: InvoiceTemplateType.INVOICE,
      bank_name: "JP Morgan Chase",
      aba_routing_number: "021000021",
      supplier_location: "USA",
    },
    {
      name: "Far Dar Enterprise",
      name_aliases: ["Far Dar Enterprise Co., Ltd.", "FAR DAR"],
      invoice_template_type: InvoiceTemplateType.INVOICE,
      supplier_location: "Taiwan",
    },
    {
      name: "SF Express",
      name_aliases: ["SF EXPRESS", "S.F. Express"],
      invoice_template_type: InvoiceTemplateType.INVOICE,
      supplier_location: "HK",
    },
    // --- LABELS / HANGTAGS ---
    {
      name: "Seaman Paper Asia",
      name_aliases: ["SEAMAN PAPER", "Seaman Paper Asia Ltd"],
      invoice_template_type: InvoiceTemplateType.PRO_FORMA,
      bank_name: "HSBC HK",
      account_number: "808-026348-838",
      swift_code: "HSBCHKHH",
      supplier_location: "HK",
    },
    {
      name: "PT SML Indonesia",
      name_aliases: ["PT SML", "SML Group", "SML INDONESIA"],
      invoice_template_type: InvoiceTemplateType.INVOICE,
      bank_name: "HSBC Indonesia",
      supplier_location: "Indonesia",
    },
    {
      name: "PT Victoria",
      name_aliases: ["PT Victoria Label Indonesia", "PT VICTORIA LABEL"],
      invoice_template_type: InvoiceTemplateType.SALES_INVOICE,
      bank_name: null,
      bir_tin: null,
      supplier_location: "Indonesia",
    },
    // --- SECURITY TAGS ---
    {
      name: "Checkpoint Systems",
      name_aliases: ["Checkpoint", "CHECKPOINT"],
      invoice_template_type: InvoiceTemplateType.SALES_INVOICE,
      supplier_location: "USA",
    },
    // --- LOCAL / PH ---
    {
      name: "Superdry PH",
      name_aliases: ["SUPERDRY PH", "Superdry Philippines"],
      invoice_template_type: InvoiceTemplateType.INVOICE,
      bir_tin: "placeholder",
      supplier_location: "Philippines",
    },
    {
      name: "Kabuhayan Namin",
      name_aliases: ["KABUHAYAN NAMIN"],
      invoice_template_type: InvoiceTemplateType.SALES_INVOICE,
      bir_tin: "placeholder",
      supplier_location: "Philippines",
    },
  ];

  for (const vendor of vendors) {
    await prisma.vendor.upsert({
      where: { name: vendor.name },
      update: {},
      create: vendor,
    });
    console.log(`Seeded vendor: ${vendor.name}`);
  }

  console.log('Vendor seed completed successfully!');
}

main()
  .catch((e) => {
    console.error('Error seeding vendors:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
