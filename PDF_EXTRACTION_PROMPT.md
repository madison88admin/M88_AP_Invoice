# PDF Invoice Extraction Prompt

## Purpose
This prompt is based on verified data from 42 real vendor invoices. Use this as the source of truth for extraction logic.

## Required Fields to Extract

### 1. Vendor Information
- **Vendor Name**: Company name issuing the invoice (from letterhead, NOT from BILL TO/SHIP TO blocks or footer)
- **Bill To/Ship To**: Company address and contact information
- **Vendor ID**: If present in the invoice

### 2. Invoice Details
- **Invoice Number**: Unique invoice identifier (full alphanumeric token including slashes/hyphens)
- **Invoice Date**: Date when invoice was issued
- **Due Date**: Payment due date
- **Document Type**: INVOICE, PROFORMA INVOICE, COMMERCIAL INVOICE, SALES INVOICE, STATEMENT

### 3. Financial Information
- **Total Amount**: Final invoice amount (scan ALL pages, take LAST matching label)
- **Currency**: USD, EUR, HKD, etc.
- **Bank Charge**: If listed separately
- **Payment Terms**: Net 30, T/T, etc. (must require label + value, not just word "terms")

### 4. Bank Details
- **Bank Name**: Financial institution name
- **SWIFT Code**: 8-11 character bank identifier
- **Account Number**: Bank account for payment
- **Note**: Some vendors (PT Victoria Label, Tentac Co., Ltd) have NO bank details - return null gracefully

### 5. Purchase Order Information
- **PO Reference**: Embedded in line-item text, format: BRAND_SEASON_ORDERTYPE_PO#_MPO#_FACTORY
- **MPO Number**: Master PO number
- **PO Number**: Regular PO number

### 6. Product/Brand Information
- **Brand**: Brand name from PO reference
- **Brand Code**: Brand abbreviation (see confirmed table below)
- **Season**: Season code (F26, SS26, etc.)
- **Order Type**: BULK, SAMPLE, etc.
- **Category**: Product category (LAB, PACK, etc.)

### 7. Quantity Information
- **Qty Shipped**: Total quantity shipped
- **Unit of Measure**: PCS, KG, etc.
- **Line Items**: Individual item quantities and descriptions

## Confirmed Real Vendor Names

Use this table for vendor_name matching/validation - these are the actual company names as they appear on invoice letterheads:

- Paxar (China) Limited
- UPW Limited
- Avery Dennison Hong Kong B.V.
- PT. Paxar Indonesia
- Amass International Limited
- Punarbhavaa Sustainable Products Pvt Ltd
- Charming Printing Ltd
- Ducksan Enterprise Co. Ltd
- Trimco Group (Hong Kong) Co. Ltd
- Master Air International Inc
- Far Dar Express Worldwide (HK) Ltd
- Seaman Paper Asia Co. Ltd
- R-PAC Vietnam Limited
- Rudholm & Haak (HK) Ltd
- Checkpoint Systems Limited
- PT SML Indonesia Private
- Brand ID LLC
- Bo Hing Label Industries Co. Ltd
- C&T Label Company Limited
- Dong Guan City Ocan Weaving Co. Ltd
- Longqing Garment Accessories Co. Ltd
- G&F Trading (Hong Kong) Limited
- Lee Bou International Binh Duong Co. Ltd
- Perfect China Supplies Ltd
- Nilorn East Asia Limited
- Jointak Labels Company Limited
- Nilorn Shanghai Trading Company Ltd
- Avery Dennison RIS Vietnam Co. Ltd
- Weavabel
- Zhejiang Weixing Imp.&Exp Co. Ltd
- Manohar Filaments Pvt Ltd
- PT Victoria Label
- S.F. Express (Hong Kong) Limited
- Beijing Shunte Science & Technology Corporation
- Kabuhayan Namin Incorporated
- Tentac Co., Ltd
- Vela Vietnam Packaging Limited Company

**Important**: "Avery Dennison" alone is NOT a vendor name - it's a parent company name that appears in footers/email-domains/legal text. Vendor name extraction must prioritize the unlabeled letterhead block and explicitly exclude anything found inside BILL TO/SHIP TO labeled blocks or footer/signature/legal-disclaimer text.

## Confirmed Real Brand Codes

| Code | Brand Name | Tier |
|------|------------|------|
| CSC | Columbia Sportswear | TOP_10 |
| TNF | The North Face | TOP_10 |
| VNS | Vans | TOP_10 |
| ARC | Arc'teryx | TOP_10 |
| UA | Under Armour | TOP_10 |
| HH | Helly Hansen | TOP_10 |
| BUR | Burton | TOP_10 |
| TM | Travis Mathew | TOP_10 |
| FR | Fjallraven | TOP_10 |
| FRJ | Fjallraven | TOP_10 |
| ON | On Running | TOP_10 |
| PRA | Prana | OTHER |
| PRN | Prana | OTHER |
| PRANA | Prana (full word form) | OTHER |
| DYN | Dynafit | OTHER |
| MUS | Mustang | OTHER |
| VUO | Vuori | OTHER |

**Note**: "SMW" appeared in some invoices but its actual brand identity has not been confirmed. Do not guess - treat unrecognized codes as MISSING_BRAND_TIER exception and route to Purchasing Coordinator for manual confirmation.

## Extraction Strategy

### Section-Based Extraction
1. **Header Section**: First page, top portion
   - Look for keywords: "INVOICE", "BILL TO", "SHIP TO", "VENDOR"
   - Vendor name: Identify unlabeled letterhead block, EXCLUDE company names after "BILL TO", "SHIP TO", "DELIVERY TO" labels
   
2. **Financial Section**: Usually middle or bottom of first page
   - Look for keywords: "TOTAL", "AMOUNT", "DUE DATE", "CURRENCY"
   - **Important**: Scan ALL pages, take LAST matching label for total amount (some invoices show subtotal on page 1, actual total on page 2)
   
3. **Bank Section**: Typically bottom section
   - Look for keywords: "BANK", "SWIFT", "ACCOUNT", "A/C"
   - Return null gracefully if no bank details found (PT Victoria Label, Tentac Co., Ltd)
   
4. **PO Reference Section**: Embedded in line-item text, not a labeled field
   - Format: BRAND_SEASON_ORDERTYPE_PO#_MPO#_FACTORY
   - **Important**: Handles mixed delimiters (spaces AND underscores in same string)
   
5. **Tabular Data Section**: Line items table
   - Look for headers: "QTY", "DESCRIPTION", "AMOUNT", "PRICE"
   - Extract rows with quantity and price information

### Pattern Matching (Updated with Real Labels)

#### Invoice Number Patterns
**Confirmed real labels**: "Invoice No", "Invoice No.", "INVOICE NO:", "I/V NO.", "PI No.", "P/I NO", "SI No", "Order #", "D/N No.", "PI#"
**Confirmed real formats** (include slashes/hyphens, not just digits):
- MFPL/PI/142/25-00/0768
- CLPI2603-026LW
- PCI-26018341
- PSP/PI/0004633

#### Date Patterns
- `\d{4}-\d{2}-\d{2}` (YYYY-MM-DD)
- `\d{2}/\d{2}/\d{4}` (MM/DD/YYYY)
- `\d{2}-\d{2}-\d{4}` (DD-MM-YYYY)

#### Amount Patterns
**Confirmed real labels**: "TOTAL", "Total Amount", "TOTAL (USD)", "NET INVOICE", "Net Amount", "Grand Total", "Order Total"
- `[$€£]\s*[\d,]+\.\d{2}`
- `Total[:\s]+[$€£]?[\d,]+\.\d{2}`
- **Special case**: Prose-based currency conversion - look for "settle in USD" or "@[rate]" phrasing

#### PO Reference Patterns
**No fixed label** - embedded in line-item text with format:
- `CSC_F26_BULK_MPO14694_ML_AVERY`
- `TNF F26 JAN BUY_MPO15371_MDDC_A7WJO_INDONESIA` (mixed spaces and underscores)
- Parse using both space and underscore as delimiters

#### Payment Terms Patterns
**Confirmed real labels**: "Payment Terms", "TERMS:", "Terms of payment", "Credit Term", "CREDIT TERM"
**Important**: Must require label + value (number + "days" or recognized phrase), NOT just word "terms" anywhere in text
- `Payment Terms[:\s]+(Net\s+\d+|T\/T|[\d]+\s+days)`

#### Bank Details Patterns
**Confirmed real labels**: "Bank Name", "Swift Code", "A/C No.", "Account No", "Beneficiary", "Our A/C No."
- `SWIFT[:\s]+([A-Z]{8,11})`
- `A/C[:\s]+([\d\s\-]+)`
- `Account[:\s]+([\d\s\-]+)`

#### Brand/Season Patterns
- Extract from PO reference: BRAND_SEASON_ORDERTYPE_PO#_MPO#_FACTORY
- Season format: [A-Z]{2}\d{2} (F26, SS26, etc.)
- Brand codes: See confirmed table above

### Noise Filtering
Exclude these patterns from quantity extraction:
- Phone numbers: `\d{3}-\d{3}-\d{4}`
- Dates: `\d{4}-\d{2}-\d{2}`
- Invoice numbers: `INV\d+`
- SO numbers: `SO\d+`
- DN numbers: `DN\d+`

## Confirmed Real Patterns (Not in Generic Template)

These patterns were found in actual uploaded invoices:

### 1. Bilingual Text (Chinese + English)
**Vendors affected**: Charming Printing, Bo Hing Label
**Issue**: Mix of CJK and Latin characters on same page
**Requirement**: Inspect pdf2json output for garbled or reordered text when CJK and Latin characters are interleaved
**Current Status**: NOT YET IMPLEMENTED - needs testing with bilingual invoices

### 2. Prose-Based Currency Conversion
**Vendor affected**: Perfect China Supplies (IN26020002)
**Issue**: Real USD total stated in sentence: "For settlement in USD. @7.70, Please settle in USD 96.68"
**Problem**: Labeled "NET TOTAL (HKD)" figure is wrong amount if mistaken for USD (overstates by 7-8x)
**Requirement**: Fallback search for "settle in USD" or "@[rate]" phrasing when label-based extraction fails
**Current Status**: NOT YET IMPLEMENTED - current logic only looks for labeled fields

### 3. Aged Statement Totals
**Vendor affected**: S.F. Express (8526250996IN202604)
**Issue**: Monthly STATEMENT, not single-transaction invoice
**Problem**: Headline total combines current-month charges, prior-month overdue balance, and finance surcharge
**Requirement**: Should not be treated as normal single-period invoice amount for PO-matching
**Current Status**: PARTIALLY HANDLED - document_type detection exists but statement-specific logic not implemented

### 4. Handwritten Invoice
**Vendor affected**: Kabuhayan Namin Incorporated (0005904)
**Issue**: Handwritten document scanned to PDF
**Requirement**: Use is_handwritten / low-OCR-confidence flag, not standard pattern matching
**Current Status**: NOT YET IMPLEMENTED - no handwriting detection logic exists

## Fallback Logic

### If OCR Extraction Fails
1. **Brand**: Use PO reference to determine brand (CSC = Columbia Sportswear, TNF = The North Face, etc. - see confirmed table above)
2. **Season**: Extract from PO reference (F26 = Fall 2026, SS26 = Spring/Summer 2026)
3. **Qty Shipped**: Use NextGen PO quantity if available
4. **Vendor**: Use vendor matching service with extracted name (match against confirmed vendor list)

### If Bank Details Not Found
- Check for alternative bank section locations
- Look for "BENEFICIARY" or "PAY TO" sections
- Extract from footer if not in main body

## Quality Checks

### Validation
- Invoice date should not be in the future
- Due date should be >= invoice date
- Amount should be positive
- Currency should be valid (USD, EUR, GBP, etc.)
- PO reference should match expected format

### Confidence Scoring
- High confidence: Exact pattern match
- Medium confidence: Fuzzy match with similarity > 0.8
- Low confidence: Partial match or inferred from context

## Error Handling

### Common Issues
1. **Empty fields**: Log as warning, use fallback
2. **Multiple matches**: Use first match or most confident
3. **No matches**: Return null, trigger manual review
4. **Format variations**: Try multiple patterns

### Logging
- Log extraction attempts for each field
- Log pattern matches and confidence scores
- Log fallback usage
- Log any parsing errors

## Implementation Notes

### pdf-parse Usage
```javascript
const pdf = require('pdf-parse');
const data = await pdf(buffer);
const text = data.text;
// Apply extraction patterns to text
```

### pdf2json Usage
```javascript
const PDFParser = require('pdf2json');
const pdfParser = new PDFParser();
await pdfParser.parseBuffer(buffer);
const pdfData = pdfParser.getAllFields();
// Extract structured data from JSON
```

### Azure Form Recognizer Usage
```javascript
const { DocumentIntelligenceClient } = require('@azure/ai-form-recognizer');
// Use prebuilt invoice model for structured extraction
// Fallback to custom model for vendor-specific formats
```

## Continuous Improvement

### Pattern Refinement
- Add new patterns as new invoice formats are encountered
- Update vendor-specific handling rules
- Improve noise filtering based on false positives

### Performance Optimization
- Cache common patterns
- Pre-compile regex patterns
- Use parallel processing for multiple pages
