export interface VendorTemplateMapping {
  name: string;
  invoice_template_type: string;
  has_template: boolean;
}

export const VENDOR_TEMPLATE_MAPPINGS: VendorTemplateMapping[] = [
  // --- INVOICE ---
  { name: "ADT HONG KONG LIMITED", invoice_template_type: "INVOICE", has_template: true },
  { name: "AMASS INTERNATIONAL LTD", invoice_template_type: "INVOICE", has_template: true },
  { name: "AN CHIN CO,.LTD", invoice_template_type: "INVOICE", has_template: true },
  { name: "ASCHEI INTERNATIONAL CO. LTD", invoice_template_type: "INVOICE", has_template: true },
  { name: "Avery Dennison (PT. AVERY INDONESIA.)", invoice_template_type: "INVOICE", has_template: true },
  { name: "Avery Dennison (PT. Paxar INDONESIA.)", invoice_template_type: "INVOICE", has_template: true },
  { name: "Avery Dennison Hong Kong (FASTENER)", invoice_template_type: "INVOICE", has_template: true },
  { name: "Avery Dennison RIS Vietnam CO., Limited", invoice_template_type: "INVOICE", has_template: true },
  { name: "Bemis Hong Kong Ltd.", invoice_template_type: "INVOICE", has_template: true },
  { name: "Beijing Shunte Science & Technology Corporation", invoice_template_type: "INVOICE", has_template: true },
  { name: "BO HING LABEL INDUSTRIES CO. LTD.", invoice_template_type: "INVOICE", has_template: true },
  { name: "Bornemann Far East Ltd.", invoice_template_type: "INVOICE", has_template: true },
  { name: "BUTTON INTERNATIONAL CO. LTD.", invoice_template_type: "INVOICE", has_template: true },
  { name: "Columbia Sportswear Company Vendor", invoice_template_type: "INVOICE", has_template: true },
  { name: "E.TEXTINT CORP.", invoice_template_type: "INVOICE", has_template: true },
  { name: "Everbest Development (HK) LTD", invoice_template_type: "INVOICE", has_template: true },
  { name: "Fineline Technologies", invoice_template_type: "INVOICE", has_template: true },
  { name: "Global Trim Sales, Inc.", invoice_template_type: "INVOICE", has_template: true },
  { name: "Guangzhou Baoshen Science", invoice_template_type: "INVOICE", has_template: true },
  { name: "ISA INDUSTRIAL LIMITED", invoice_template_type: "INVOICE", has_template: true },
  { name: "LEE BOU INTERNATIONAL CO.,LTD", invoice_template_type: "INVOICE", has_template: true },
  { name: "MEGA WAVES COMPANY LIMITED", invoice_template_type: "INVOICE", has_template: true },
  { name: "MICOLOR PRINTING PRODUCTS COMPANY LIMITED", invoice_template_type: "INVOICE", has_template: true },
  { name: "Nilorn East Asia Ltd.", invoice_template_type: "INVOICE", has_template: true },
  { name: "OPSEC DELTA (HK)", invoice_template_type: "INVOICE", has_template: true },
  { name: "PT VICTORIA LABEL", invoice_template_type: "INVOICE", has_template: true },
  { name: "PT BSN TECHNOLOGIES INDONESIA", invoice_template_type: "INVOICE", has_template: true },
  { name: "PT TETRA MITRA LOGISTIK", invoice_template_type: "INVOICE", has_template: true },
  { name: "PT. JARINGAN LOGISTIK SEMESTA", invoice_template_type: "INVOICE", has_template: true },
  { name: "RUDHOLM & HAAK (H.K.) LIMITED", invoice_template_type: "INVOICE", has_template: true },
  { name: "Rudholm & Haak AB", invoice_template_type: "INVOICE", has_template: true },
  { name: "RUDHOLM PRINTING AND PACKAGING CO., LTD", invoice_template_type: "INVOICE", has_template: true },
  { name: "S.E.C. ACCESSORIES LTD.", invoice_template_type: "INVOICE", has_template: true },
  { name: "Seaman Paper Asia Company Limited", invoice_template_type: "INVOICE", has_template: true },
  { name: "SML (Hongkong) Ltd.", invoice_template_type: "INVOICE", has_template: true },
  { name: "SMT (VN) Label Co., Ltd.", invoice_template_type: "INVOICE", has_template: true },
  { name: "Starmap International HK Ltd.", invoice_template_type: "INVOICE", has_template: true },
  { name: "STELMAR SRL", invoice_template_type: "INVOICE", has_template: true },
  { name: "TENTAC", invoice_template_type: "INVOICE", has_template: true },
  { name: "TIEN-HU TRADING (HONG KONG) LTD", invoice_template_type: "INVOICE", has_template: true },
  { name: "UTS UNIVERSAL TRIM SUPPLY CO", invoice_template_type: "INVOICE", has_template: true },
  { name: "V MAKE MANUFACTURING AND PRINTING LTD", invoice_template_type: "INVOICE", has_template: true },
  { name: "VELA VIETNAM PACKAGING LIMITED COMPANY", invoice_template_type: "INVOICE", has_template: true },
  { name: "WILLPOWER PRODUCT SOLUTIONS LTD.", invoice_template_type: "INVOICE", has_template: true },
  { name: "Zabin Industries (HK) Ltd.", invoice_template_type: "INVOICE", has_template: true },
  { name: "Zhejiang Weixing Imp. & Exp. Co.Ltd", invoice_template_type: "INVOICE", has_template: true },

  // --- PRO_FORMA ---
  { name: "ACG ACCENT", invoice_template_type: "PRO_FORMA", has_template: true },
  { name: "AVERY DENNINSON PAXAR (CHINA) LTD", invoice_template_type: "PRO_FORMA", has_template: true },
  { name: "Avery Dennison Hong Kong, B.V.", invoice_template_type: "PRO_FORMA", has_template: true },
  { name: "BENEFITS INDUSTRIAL LIMITED", invoice_template_type: "PRO_FORMA", has_template: true },
  { name: "Brand ID", invoice_template_type: "PRO_FORMA", has_template: true },
  { name: "C&T Garment Accessories Co.Ltd", invoice_template_type: "PRO_FORMA", has_template: true },
  { name: "C&T LABEL COMPANY LTD.", invoice_template_type: "PRO_FORMA", has_template: true },
  { name: "CADICA GROUP", invoice_template_type: "PRO_FORMA", has_template: true },
  { name: "CADICASIA HONG KONG", invoice_template_type: "PRO_FORMA", has_template: true },
  { name: "Charming Printing Ltd.", invoice_template_type: "PRO_FORMA", has_template: true },
  { name: "Checkpoint Apparel Labelling Sol. Asia", invoice_template_type: "PRO_FORMA", has_template: true },
  { name: "Chun Wo Ho CO Ltd.", invoice_template_type: "PRO_FORMA", has_template: true },
  { name: "CJ VAST INDUSTRIAL CO.", invoice_template_type: "PRO_FORMA", has_template: true },
  { name: "COLUMBIA SPORTSWEAR COMPANY HK", invoice_template_type: "PRO_FORMA", has_template: true },
  { name: "DONG GUAN CITY OCAN WEAVING CO.,LTD", invoice_template_type: "PRO_FORMA", has_template: true },
  { name: "DONGGUAN GUO XIANG PRINTING CO.", invoice_template_type: "PRO_FORMA", has_template: true },
  { name: "Dragon Times Accessory Co. Ltd.", invoice_template_type: "PRO_FORMA", has_template: true },
  { name: "DUCKSAN ENTERPRISE CO. LTD", invoice_template_type: "PRO_FORMA", has_template: true },
  { name: "ERICTEX FASHION CO., LTD", invoice_template_type: "PRO_FORMA", has_template: true },
  { name: "Expeditors Philippines, Inc.", invoice_template_type: "PRO_FORMA", has_template: true },
  { name: "G & F TRADING (HONG KONG) LTD.", invoice_template_type: "PRO_FORMA", has_template: true },
  { name: "GENESIS LABELS", invoice_template_type: "PRO_FORMA", has_template: true },
  { name: "Global Design I.D. LTD.", invoice_template_type: "PRO_FORMA", has_template: true },
  { name: "GLOBAL EXPRESS INT'L INC", invoice_template_type: "PRO_FORMA", has_template: true },
  { name: "GLORYTEX VINA CO., LTD.", invoice_template_type: "PRO_FORMA", has_template: true },
  { name: "GUANGDONG GOLDEN BRAND TECHNOLOGY CO., LT", invoice_template_type: "PRO_FORMA", has_template: true },
  { name: "Han Yang Leather CO. Ltd.", invoice_template_type: "PRO_FORMA", has_template: true },
  { name: "Hang Sang (Siu Po) Press Co. Ltd.", invoice_template_type: "PRO_FORMA", has_template: true },
  { name: "Hongzhou Industry Co. Ltd.", invoice_template_type: "PRO_FORMA", has_template: true },
  { name: "HUIQUAN TRADING (HK) LIMITED", invoice_template_type: "PRO_FORMA", has_template: true },
  { name: "ICCI (NINGBO MILD TEXTILES TECHNOLOGY CO)", invoice_template_type: "PRO_FORMA", has_template: true },
  { name: "JIANGSU HAOYE FIBER TECHNOLOGY CO", invoice_template_type: "PRO_FORMA", has_template: true },
  { name: "JOINTAK LABELS COMPANY LIMITED (DYNAFIT)", invoice_template_type: "PRO_FORMA", has_template: true },
  { name: "Jointak Labels Company Ltd.", invoice_template_type: "PRO_FORMA", has_template: true },
  { name: "Kabuhayan Namin Inc. (SuperDry PH)", invoice_template_type: "PRO_FORMA", has_template: true },
  { name: "L&E INTERNATIONAL, LTD", invoice_template_type: "PRO_FORMA", has_template: true },
  { name: "Lee Bou International Binh Duong Company", invoice_template_type: "PRO_FORMA", has_template: true },
  { name: "LIENTEX L.L.C.", invoice_template_type: "PRO_FORMA", has_template: true },
  { name: "LONGQING GARMENT ACCESSORIES CO., LTD", invoice_template_type: "PRO_FORMA", has_template: true },
  { name: "M.Y. & UNION HK LTD.", invoice_template_type: "PRO_FORMA", has_template: true },
  { name: "MASTER AIR INTERNATIONAL INC.", invoice_template_type: "PRO_FORMA", has_template: true },
  { name: "MICRO-PAK LTD", invoice_template_type: "PRO_FORMA", has_template: true },
  { name: "Nexgen Packaging LTD.", invoice_template_type: "PRO_FORMA", has_template: true },
  { name: "NIFCO (HK) CO.", invoice_template_type: "PRO_FORMA", has_template: true },
  { name: "Perfect China Supplies", invoice_template_type: "PRO_FORMA", has_template: true },
  { name: "PRIMOTEX TEXTILES HOLDING LIMITED", invoice_template_type: "PRO_FORMA", has_template: true },
  { name: "PT NEXGEN PACKAGING INDONESIA", invoice_template_type: "PRO_FORMA", has_template: true },
  { name: "PT SML INDONESIA PRIVATE", invoice_template_type: "PRO_FORMA", has_template: true },
  { name: "R-PAC VIETNAM LIMITED", invoice_template_type: "PRO_FORMA", has_template: true },
  { name: "S.F. Express", invoice_template_type: "PRO_FORMA", has_template: true },
  { name: "SHANGHAI ARCHER GARMENT ACCESSORIES CO,", invoice_template_type: "PRO_FORMA", has_template: true },
  { name: "SHANGHAI BIAOYI INFORMATION TECHNOLOGY CO", invoice_template_type: "PRO_FORMA", has_template: true },
  { name: "Shing Yuen Industrial Limited", invoice_template_type: "PRO_FORMA", has_template: true },
  { name: "SYSTEM PRINTING SERVICES CO.", invoice_template_type: "PRO_FORMA", has_template: true },
  { name: "TAIWAN PAIHO LIMITED", invoice_template_type: "PRO_FORMA", has_template: true },
  { name: "TALON INTERNATIONAL, INC.", invoice_template_type: "PRO_FORMA", has_template: true },
  { name: "TMV VINA CO., LTD", invoice_template_type: "PRO_FORMA", has_template: true },
  { name: "Trimco Group (Hangzhou) Co., Ltd.", invoice_template_type: "PRO_FORMA", has_template: true },
  { name: "TRIMCO GROUP (HONG KONG)", invoice_template_type: "PRO_FORMA", has_template: true },
  { name: "TRIMCO GROUP (VIETNAM) CO., LTD", invoice_template_type: "PRO_FORMA", has_template: true },
  { name: "Trimco Group (Zhejiang) Co. Ltd.", invoice_template_type: "PRO_FORMA", has_template: true },
  { name: "TRIMCO GROUP TRADING (H.K.)CO., LTD.", invoice_template_type: "PRO_FORMA", has_template: true },
  { name: "Unitex International Button, Ltd", invoice_template_type: "PRO_FORMA", has_template: true },
  { name: "UNIVERSAL STAR CORPORATION", invoice_template_type: "PRO_FORMA", has_template: true },
  { name: "UPW LIMITED", invoice_template_type: "PRO_FORMA", has_template: true },
  { name: "VEST CO. LTD.", invoice_template_type: "PRO_FORMA", has_template: true },
  { name: "Wilson Garment Accessories (Intl.)LTD", invoice_template_type: "PRO_FORMA", has_template: true },
  { name: "WONDERTEX SHANGHAI CO. LTD", invoice_template_type: "PRO_FORMA", has_template: true },
  { name: "Zhangjiagang Yangtse (Sudwollgroup)", invoice_template_type: "PRO_FORMA", has_template: true },
  { name: "ZHEJIANG XINAO TEXTILES INC.", invoice_template_type: "PRO_FORMA", has_template: true },

  // --- COMMERCIAL_INVOICE ---
  { name: "Combine Products International, Ltd.", invoice_template_type: "COMMERCIAL_INVOICE", has_template: true },
  { name: "DONGGUAN LEE FONG LABEL MANUFACTURE LTD.", invoice_template_type: "COMMERCIAL_INVOICE", has_template: true },
  { name: "J-LONG LTD.", invoice_template_type: "COMMERCIAL_INVOICE", has_template: true },
  { name: "PT NEXGEN PACKAGING INDONESIA", invoice_template_type: "COMMERCIAL_INVOICE", has_template: true },
  { name: "R-PAC VIETNAM LIMITED", invoice_template_type: "COMMERCIAL_INVOICE", has_template: true },
  { name: "RUDHOLM & HAAK (H.K.) LIMITED", invoice_template_type: "COMMERCIAL_INVOICE", has_template: true },
  { name: "UPW LIMITED", invoice_template_type: "COMMERCIAL_INVOICE", has_template: true },
  { name: "V MAKE MANUFACTURING AND PRINTING LTD", invoice_template_type: "COMMERCIAL_INVOICE", has_template: true },

  // --- SALES_INVOICE ---
  { name: "CHECKPOINT VIETNAM COMPANY LIMITED", invoice_template_type: "SALES_INVOICE", has_template: true },
  { name: "Komax HK Company", invoice_template_type: "SALES_INVOICE", has_template: true },

  // --- PREPAID_INVOICE ---
  { name: "GLORYTEX VINA CO., LTD.", invoice_template_type: "PREPAID_INVOICE", has_template: true },

  // --- PROTO_SAMPLE_INVOICE ---
  { name: "TMV VINA CO., LTD", invoice_template_type: "PROTO_SAMPLE_INVOICE", has_template: true },

  // --- SERVICE INVOICE (mapped to INVOICE as closest) ---
  { name: "FAR DAR EXPRESS", invoice_template_type: "INVOICE", has_template: true },

  // --- NO DATA ---
  { name: "Han Tag Printing & Label Ltd.", invoice_template_type: "NO_DATA", has_template: false },
  { name: "MANOHAR FILAMENTS PVT LTD", invoice_template_type: "NO_DATA", has_template: false },
  { name: "NINGBO ZHONGXIN WOOL TEXTILE GROUP CO., L", invoice_template_type: "NO_DATA", has_template: false },
  { name: "POOL FILATI SRL", invoice_template_type: "NO_DATA", has_template: false },
  { name: "PT. KK Label Indonesia", invoice_template_type: "NO_DATA", has_template: false },
  { name: "PUNARBHAVAA SUSTAINABLE PRODUCTS PVT LTD", invoice_template_type: "NO_DATA", has_template: false },
  { name: "TOPO SOLUTIONS LIMITED", invoice_template_type: "NO_DATA", has_template: false },
  { name: "Weavabel", invoice_template_type: "NO_DATA", has_template: false },
];

export function getTemplateTypeByVendorName(vendorName: string): string | null {
  const normalized = vendorName.toUpperCase().trim();
  const match = VENDOR_TEMPLATE_MAPPINGS.find(
    (v) => v.name.toUpperCase().trim() === normalized
  );
  return match ? match.invoice_template_type : null;
}

export function getVendorWithAliases(vendorName: string): VendorTemplateMapping | null {
  const normalized = vendorName.toUpperCase().trim();
  return VENDOR_TEMPLATE_MAPPINGS.find(
    (v) => v.name.toUpperCase().trim() === normalized
  ) || null;
}
