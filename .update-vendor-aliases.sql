-- Vendor aliases expansion based on existing vendors in DB
-- This script updates name_aliases for vendors that have known variations
-- Avery/Paxar, Combine Products, and other common vendor name mismatches

-- Avery Dennison Hong Kong, B.V. — add aliases for OCR variations
UPDATE "AP_Invoice"."APInvoice_Vendor"
SET name_aliases = ARRAY[
  'Avery Dennison Hong Kong',
  'Avery Dennison HK',
  'Avery Dennison (HK)',
  'Avery HK',
  'AVERY HK',
  'Avery Dennison Hong Kong B.V.',
  'Avery Dennison Hong Kong BV',
  'AVERY DENNISON HONG KONG B.V.'
]
WHERE name = 'Avery Dennison Hong Kong, B.V.';

-- Avery Dennison Hong Kong (FASTENER) — add aliases
UPDATE "AP_Invoice"."APInvoice_Vendor"
SET name_aliases = ARRAY[
  'Avery Dennison Fastener',
  'Avery Dennison (HK) Fastener',
  'Avery Dennison Hong Kong Fastener',
  'AVERY DENNISON (HK) LTD.'
]
WHERE name = 'Avery Dennison Hong Kong (FASTENER)';

-- Avery Dennison (PT. AVERY INDONESIA.) — add aliases
UPDATE "AP_Invoice"."APInvoice_Vendor"
SET name_aliases = ARRAY[
  'PT AVERY INDONESIA',
  'PT. AVERY INDONESIA',
  'AVERY INDONESIA',
  'AVERY DENNISON INDONESIA',
  'PT. AVERY DENNISON INDONESIA'
]
WHERE name = 'Avery Dennison (PT. AVERY INDONESIA.)';

-- Avery Dennison (PT. Paxar INDONESIA.) — add aliases
UPDATE "AP_Invoice"."APInvoice_Vendor"
SET name_aliases = ARRAY[
  'PT PAXAR INDONESIA',
  'PT. PAXAR INDONESIA',
  'PAXAR INDONESIA',
  'AVERY DENNISON PAXAR INDONESIA',
  'PT. AVERY DENNISON PAXAR INDONESIA'
]
WHERE name = 'Avery Dennison (PT. Paxar INDONESIA.)';

-- PT Paxar China — already has good aliases, add more OCR variations
UPDATE "AP_Invoice"."APInvoice_Vendor"
SET name_aliases = ARRAY[
  'Paxar (China) Limited',
  'Avery Dennison Paxar (China) Ltd',
  'PT PAXAR CHINA',
  'AVERY DENNINSON PAXAR (CHINA) LTD',
  'PAXAR CHINA',
  'PAXAR (CHINA) LIMITED',
  'Paxar China',
  'AVERY DENNISON PAXAR CHINA',
  'PT. PAXAR CHINA',
  'PAXAR (CHINA) LTD'
]
WHERE name = 'PT Paxar China';

-- Avery Dennison RIS Vietnam — add aliases
UPDATE "AP_Invoice"."APInvoice_Vendor"
SET name_aliases = ARRAY[
  'Avery Dennison RIS Vietnam',
  'AVERY DENNISON RIS VIETNAM',
  'Avery Dennison Vietnam RIS',
  'Avery RIS Vietnam'
]
WHERE name = 'Avery Dennison RIS Vietnam CO., Limited';

-- Combine Products International, Ltd. — add aliases
UPDATE "AP_Invoice"."APInvoice_Vendor"
SET name_aliases = ARRAY[
  'Combine Products International',
  'Combine Products',
  'COMBINE PRODUCTS INTERNATIONAL',
  'Combine Products International Ltd',
  'COMBINE',
  'Combine Products International, Ltd',
  'Combine Products International Limited'
]
WHERE name = 'Combine Products International, Ltd.';

-- PAXAR (empty name vendor) — merge into PT Paxar China by adding aliases
-- This vendor has empty beneficiary, likely a duplicate. Add aliases for safety.
UPDATE "AP_Invoice"."APInvoice_Vendor"
SET name_aliases = ARRAY[
  'PAXAR',
  'Paxar',
  'PAXAR LTD',
  'Paxar Ltd'
]
WHERE name = 'PAXAR' AND beneficiary_name = '';

-- AVERY DENNINSON PAXAR (CHINA) LTD — add aliases (this is also a Paxar China variant)
UPDATE "AP_Invoice"."APInvoice_Vendor"
SET name_aliases = ARRAY[
  'AVERY DENNISON PAXAR CHINA',
  'AVERY DENNINSON PAXAR CHINA',
  'AVERY DENNISON PAXAR (CHINA) LTD',
  'AVERY DENNINSON PAXAR (CHINA) LTD'
]
WHERE name = 'AVERY DENNINSON PAXAR (CHINA) LTD';

-- Bo Hing — add more aliases
UPDATE "AP_Invoice"."APInvoice_Vendor"
SET name_aliases = ARRAY[
  'BO HING',
  'BO HING LABEL INDUSTRIES CO. LTD.',
  'BO HING LABEL INDUSTRIES',
  'BO HING LABEL',
  'Bo Hing Label Industries Co. Ltd.',
  'Bo Hing Label Industries'
]
WHERE name = 'Bo Hing';

-- Combine Products — also handle "Combine" variations that OCR might produce
-- ACG ACCENT — add aliases
UPDATE "AP_Invoice"."APInvoice_Vendor"
SET name_aliases = ARRAY[
  'ACG ACCENT AB',
  'ACG ACCENT',
  'ACG',
  'ACG ACCENT A.B.'
]
WHERE name = 'ACG ACCENT';

-- Nilorn HK — add more aliases
UPDATE "AP_Invoice"."APInvoice_Vendor"
SET name_aliases = ARRAY[
  'Nilorn',
  'NILORN HK',
  'Nilorn East Asia Ltd.',
  'Nilorn East Asia Limited',
  'NILORN',
  'Nilorn East Asia',
  'NILORN EAST ASIA',
  'NILORN EAST ASIA LTD'
]
WHERE name = 'Nilorn HK';

-- Trimco HK — add more aliases
UPDATE "AP_Invoice"."APInvoice_Vendor"
SET name_aliases = ARRAY[
  'Trimco Group (HK) Limited',
  'TRIMCO',
  'TRIMCO GROUP (HONG KONG)',
  'TRIMCO GROUP TRADING (H.K.)CO., LTD.',
  'Trimco Group HK',
  'Trimco Hong Kong',
  'TRIMCO HK',
  'Trimco Group (Hong Kong)'
]
WHERE name = 'Trimco HK';

-- S.F. Express — add more aliases
UPDATE "AP_Invoice"."APInvoice_Vendor"
SET name_aliases = ARRAY[
  'SF EXPRESS',
  'S.F. Express',
  'SF EXPRESS (HONG KONG) LIMITED',
  'S.F. EXPRESS (HONG KONG) LIMITED',
  'SF EXPRESS HONG KONG',
  'S.F. EXPRESS HONG KONG',
  'SF EXPRESS HK'
]
WHERE name = 'SF Express';

-- PT SML Indonesia — add more aliases
UPDATE "AP_Invoice"."APInvoice_Vendor"
SET name_aliases = ARRAY[
  'PT SML',
  'SML Group',
  'SML INDONESIA',
  'PT SML INDONESIA PRIVATE',
  'SML (Hongkong) Ltd.',
  'SML',
  'SML INDONESIA PRIVATE',
  'PT. SML INDONESIA'
]
WHERE name = 'PT SML Indonesia';

-- Checkpoint Systems — add more aliases
UPDATE "AP_Invoice"."APInvoice_Vendor"
SET name_aliases = ARRAY[
  'Checkpoint',
  'CHECKPOINT',
  'CHECKPOINT VIETNAM COMPANY LIMITED',
  'Checkpoint Apparel Labelling Sol. Asia',
  'CHECKPOINT SYSTEMS',
  'Checkpoint Systems Limited',
  'CHECKPOINT SYSTEMS LTD'
]
WHERE name = 'Checkpoint Systems';

-- Rudholm & Haak HK — add more aliases
UPDATE "AP_Invoice"."APInvoice_Vendor"
SET name_aliases = ARRAY[
  'Rudholm HK',
  'RUDHOLM',
  'RUDHOLM & HAAK (H.K.) LIMITED',
  'Rudholm',
  'Rudholm & Haak',
  'RUDHOLM & HAAK',
  'Rudholm & Haak HK',
  'RUDHOLM & HAAK HK'
]
WHERE name = 'Rudholm & Haak HK';

-- R-PAC Vietnam — add more aliases
UPDATE "AP_Invoice"."APInvoice_Vendor"
SET name_aliases = ARRAY[
  'R-PAC VN',
  'RPAC Vietnam',
  'R-PAC VIETNAM LIMITED',
  'R-PAC VIETNAM',
  'R PAC VIETNAM',
  'RPAC VN',
  'R-PAC VIET NAM'
]
WHERE name = 'R-PAC Vietnam';

-- PT Victoria — add more aliases
UPDATE "AP_Invoice"."APInvoice_Vendor"
SET name_aliases = ARRAY[
  'PT Victoria Label Indonesia',
  'PT VICTORIA LABEL',
  'PT VICTORIA',
  'Victoria Label',
  'VICTORIA LABEL',
  'PT. VICTORIA LABEL'
]
WHERE name = 'PT Victoria';

-- Seaman Paper Asia — add more aliases
UPDATE "AP_Invoice"."APInvoice_Vendor"
SET name_aliases = ARRAY[
  'SEAMAN PAPER',
  'Seaman Paper Asia Ltd',
  'Seaman Paper Asia Company Limited',
  'SEAMAN PAPER ASIA',
  'Seaman Paper',
  'SEAMAN PAPER ASIA COMPANY LIMITED'
]
WHERE name = 'Seaman Paper Asia';

-- Dragon Times — add more aliases
UPDATE "AP_Invoice"."APInvoice_Vendor"
SET name_aliases = ARRAY[
  'DRAGON TIMES',
  'Dragon Times Accessory Co. Ltd.',
  'DRAGON TIMES ACCESSORY',
  'Dragon Times Accessory',
  'DRAGON TIMES ACCESSORY CO. LTD.'
]
WHERE name = 'Dragon Times';

-- Jointak — add more aliases
UPDATE "AP_Invoice"."APInvoice_Vendor"
SET name_aliases = ARRAY[
  'JOINTAK',
  'Jointak Labels Company Ltd.',
  'JOINTAK LABELS COMPANY LIMITED (DYNAFIT)',
  'JOINTAK LABELS',
  'Jointak Labels',
  'JOINTAK LABELS COMPANY LIMITED',
  'Jointak Labels Company Limited'
]
WHERE name = 'Jointak';

-- Brand ID LLC — add more aliases
UPDATE "AP_Invoice"."APInvoice_Vendor"
SET name_aliases = ARRAY[
  'Brand ID',
  'BRAND ID',
  'BRAND ID LLC',
  'Brand ID LLC.',
  'BRAND ID LLC.'
]
WHERE name = 'Brand ID LLC';

-- Lee Bou Vietnam — add more aliases
UPDATE "AP_Invoice"."APInvoice_Vendor"
SET name_aliases = ARRAY[
  'LEE BOU VN',
  'Lee Bou',
  'Lee Bou International Binh Duong Company',
  'LEE BOU INTERNATIONAL CO.,LTD',
  'LEE BOU',
  'Lee Bou International',
  'LEE BOU INTERNATIONAL'
]
WHERE name = 'Lee Bou Vietnam';

-- Vela Vietnam Packaging — add more aliases
UPDATE "AP_Invoice"."APInvoice_Vendor"
SET name_aliases = ARRAY[
  'Vela Vietnam',
  'VELA VN',
  'VELA VIETNAM PACKAGING LIMITED COMPANY',
  'VELA VIETNAM',
  'Vela Vietnam Packaging Limited Company',
  'VELA PACKAGING'
]
WHERE name = 'Vela Vietnam Packaging';

-- Zhejiang Weixing — add more aliases
UPDATE "AP_Invoice"."APInvoice_Vendor"
SET name_aliases = ARRAY[
  'ZHEJIANG WEIXING',
  'Weixing',
  'Zhejiang Weixing Imp. & Exp. Co.Ltd',
  'ZHEJIANG WEIXING IMP. & EXP. CO.LTD',
  'WEIXING',
  'Zhejiang Weixing Imp & Exp'
]
WHERE name = 'Zhejiang Weixing';

-- G&F Industries — add more aliases
UPDATE "AP_Invoice"."APInvoice_Vendor"
SET name_aliases = ARRAY[
  'G & F',
  'G AND F',
  'GF INDUSTRIES',
  'G & F TRADING (HONG KONG) LTD.',
  'G&F',
  'G & F TRADING',
  'G AND F TRADING',
  'GF TRADING'
]
WHERE name = 'G&F Industries';

-- Fineline Technologies — add more aliases
UPDATE "AP_Invoice"."APInvoice_Vendor"
SET name_aliases = ARRAY[
  'Fineline',
  'FINELINE',
  'Fineline Technologies',
  'FINELINE TECHNOLOGIES',
  'Fineline Tech',
  'FINELINE TECH'
]
WHERE name = 'Fineline Technologies';

-- Weavabel — add more aliases
UPDATE "AP_Invoice"."APInvoice_Vendor"
SET name_aliases = ARRAY[
  'WEAVABEL',
  'Weavabel',
  'WEAVABEL LTD',
  'Weavabel Ltd',
  'WEAVABEL LIMITED'
]
WHERE name = 'Weavabel';

-- Tentac — add more aliases
UPDATE "AP_Invoice"."APInvoice_Vendor"
SET name_aliases = ARRAY[
  'TENTAC',
  'Tentac',
  'TENTAC CO. LTD.',
  'TENTAC CO. LTD',
  'Tentac Co. Ltd.',
  'Tentac Co. Ltd'
]
WHERE name = 'Tentac';

-- Master Air Inc — add more aliases
UPDATE "AP_Invoice"."APInvoice_Vendor"
SET name_aliases = ARRAY[
  'Master Air, Inc.',
  'MASTER AIR',
  'MASTER AIR INTERNATIONAL INC.',
  'MASTER AIR INTERNATIONAL',
  'Master Air International',
  'MASTER AIR INC',
  'Master Air'
]
WHERE name = 'Master Air Inc';

-- Manohar Filaments — add more aliases
UPDATE "AP_Invoice"."APInvoice_Vendor"
SET name_aliases = ARRAY[
  'Manohar Filaments Pvt. Ltd.',
  'MANOHAR',
  'MANOHAR FILAMENTS PVT LTD',
  'Manohar Filaments',
  'MANOHAR FILAMENTS',
  'Manohar Filaments Pvt Ltd'
]
WHERE name = 'Manohar Filaments';

-- Perfect China — add more aliases
UPDATE "AP_Invoice"."APInvoice_Vendor"
SET name_aliases = ARRAY[
  'PERFECT CHINA',
  'Perfect China Supplies',
  'PERFECT CHINA SUPPLIES',
  'Perfect China Supplies LTD',
  'PERFECT CHINA SUPPLIES LTD'
]
WHERE name = 'Perfect China';

-- Kabuhayan Namin — add more aliases
UPDATE "AP_Invoice"."APInvoice_Vendor"
SET name_aliases = ARRAY[
  'KABUHAYAN NAMIN',
  'Kabuhayan Namin Inc. (SuperDry PH)',
  'Kabuhayan Namin Inc',
  'KABUHAYAN NAMIN INC',
  'Kabuhayan',
  'KABUHAYAN'
]
WHERE name = 'Kabuhayan Namin';

-- Dong Guan City — add more aliases
UPDATE "AP_Invoice"."APInvoice_Vendor"
SET name_aliases = ARRAY[
  'DONG GUAN',
  'DONGGUAN',
  'DONG GUAN CITY OCAN WEAVING CO.,LTD',
  'DONGGUAN OCAN WEAVING',
  'DONG GUAN OCAN',
  'OCAN WEAVING'
]
WHERE name = 'Dong Guan City';

-- Far Dar Enterprise — add more aliases
UPDATE "AP_Invoice"."APInvoice_Vendor"
SET name_aliases = ARRAY[
  'Far Dar Enterprise Co., Ltd.',
  'FAR DAR',
  'FAR DAR EXPRESS',
  'Far Dar',
  'FAR DAR ENTERPRISE',
  'Far Dar Express'
]
WHERE name = 'Far Dar Enterprise';

-- Ducksan Enterprise — add more aliases
UPDATE "AP_Invoice"."APInvoice_Vendor"
SET name_aliases = ARRAY[
  'DUCKSAN',
  'DUCKSAN ENTERPRISE CO. LTD',
  'Ducksan',
  'DUCKSAN ENTERPRISE',
  'Ducksan Enterprise Co. Ltd.'
]
WHERE name = 'Ducksan Enterprise';

-- Shunte — add more aliases
UPDATE "AP_Invoice"."APInvoice_Vendor"
SET name_aliases = ARRAY[
  'SHUNTE',
  'Beijing Shunte Science & Technology Corporation',
  'Shunte',
  'BEIJING SHUNTE',
  'Beijing Shunte'
]
WHERE name = 'Shunte';

-- Superdry PH — add more aliases
UPDATE "AP_Invoice"."APInvoice_Vendor"
SET name_aliases = ARRAY[
  'SUPERDRY PH',
  'Superdry Philippines',
  'SUPERDRY PHILIPPINES',
  'Superdry',
  'SUPERDRY'
]
WHERE name = 'Superdry PH';

-- Avery Vietnam — already has good aliases, ensure completeness
UPDATE "AP_Invoice"."APInvoice_Vendor"
SET name_aliases = ARRAY[
  'Avery Dennison (VN)',
  'AVERY VN',
  'Avery Dennison Vietnam',
  'Avery Dennison RIS Vietnam CO., Limited',
  'AVERY VIETNAM',
  'Avery VN',
  'AVERY DENNISON VIETNAM'
]
WHERE name = 'Avery Vietnam';

-- C&T Label — already has aliases, add more
UPDATE "AP_Invoice"."APInvoice_Vendor"
SET name_aliases = ARRAY[
  'C&T',
  'C AND T LABEL',
  'C&T LABEL COMPANY LTD.',
  'C&T Garment Accessories Co.Ltd',
  'C AND T',
  'C&T LABEL',
  'C AND T GARMENT ACCESSORIES',
  'C&T GARMENT ACCESSORIES'
]
WHERE name = 'C&T Label';

-- Charming Printing Ltd — add more aliases
UPDATE "AP_Invoice"."APInvoice_Vendor"
SET name_aliases = ARRAY[
  'Charming Printing & Packing',
  'CHARMING',
  'Charming Printing Ltd.',
  'CHARMING PRINTING',
  'Charming Printing',
  'CHARMING PRINTING LTD',
  'CHARMING PRINTING & PACKING'
]
WHERE name = 'Charming Printing Ltd';
