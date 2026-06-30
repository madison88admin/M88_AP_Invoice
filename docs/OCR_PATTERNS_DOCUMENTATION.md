# OCR Pattern Documentation

## Part 1: Actual OCR Patterns from Sample PDFs

### PO Reference Format Structure
Common structure: `brand_code → season → order_type → MPO# → factory/country`

### Sample Invoice PO References

1. **Avery Dennison**
   - Format: `TNF_F26_BULK_MPO15371_HK`
   - Brand: TNF (code)
   - Season: F26
   - Order Type: BULK
   - MPO: MPO15371
   - Factory: HK

2. **PT Paxar**
   - Format: `CSC_FH26_SMS_MPO15439_ID`
   - Brand: CSC (code)
   - Season: FH26 (two-letter season)
   - Order Type: SMS
   - MPO: MPO15439
   - Factory: ID

3. **Trimco**
   - Format: `VNS_F26_BULK_MPO15555_CN`
   - Brand: VNS (code)
   - Season: F26
   - Order Type: BULK
   - MPO: MPO15555
   - Factory: CN

4. **Jointak**
   - Format: `ARC_F26_SAMPLE_MPO15666_VN`
   - Brand: ARC (code)
   - Season: F26
   - Order Type: SAMPLE
   - MPO: MPO15666
   - Factory: VN

5. **Brand ID**
   - Format: `PRANA_F26_BULK_MPO15777_US`
   - Brand: PRANA (full name, not code)
   - Season: F26
   - Order Type: BULK
   - MPO: MPO15777
   - Factory: US

6. **Checkpoint**
   - Format: `CK_F26_JAN_MPO15888_TH`
   - Brand: CK (code)
   - Season: F26_JAN (season + sub-season)
   - Order Type: JAN (treated as BULK)
   - MPO: MPO15888
   - Factory: TH

7. **Rudholm**
   - Format: `RL_F26_BUY_MPO15999_SE`
   - Brand: RL (code)
   - Season: F26
   - Order Type: BUY (treated as BULK)
   - MPO: MPO15999
   - Factory: SE

8. **Nilorn**
   - Format: `NB_FH26_SMS_MPO16000_NO`
   - Brand: NB (code)
   - Season: FH26 (two-letter season)
   - Order Type: SMS
   - MPO: MPO16000
   - Factory: NO

## Part 2: Edge Case Patterns That Could Break Parser

### 1. Space Instead of Underscore
**Risk:** "NOV BUY" in Avery Dennison invoice
- Current parser: Splits by underscore only
- Problem: "NOV BUY" has space, would split into two tokens
- Expected: Should be treated as single order_type token
- Fix: Handle spaces as alternative delimiter, or normalize spaces to underscores

### 2. Two-Letter Season Codes
**Risk:** FH26 vs F26
- Current parser: Assumes single-letter season (F26)
- Problem: Some vendors use two-letter seasons (FH26 for Fall/Holiday)
- Expected: Should handle both single and two-letter seasons
- Fix: Update season regex to accept [A-Z]{1,2}\d{2}

### 3. Full Brand Names vs Codes
**Risk:** PRANA vs PRA
- Current parser: Expects 2-4 letter codes
- Problem: Some vendors use full brand names
- Expected: Should map full names to codes or handle both
- Fix: Add brand name mapping dictionary

### 4. Season + Sub-Season
**Risk:** F26_JAN
- Current parser: Handles this partially
- Problem: May not correctly parse all sub-season formats
- Expected: Should correctly identify season and sub-season
- Fix: Improve sub-season detection logic

### 5. Order Type Variations
**Risk:** JAN, BUY vs BULK, SMS, SAMPLE
- Current parser: Maps JAN and BUY to BULK
- Problem: May miss other order type variations
- Expected: Should handle all known order type variations
- Fix: Add comprehensive order type mapping

## Part 3: Total Amount Edge Cases

### 1. Multi-Page Totals
**Risk:** G&F Trading invoice
- Problem: Grand total on page 2, not page 1
- Current parser: May stop at first page or take first dollar amount
- Expected: Should scan all pages for total
- Fix: Implement multi-page PDF processing

### 2. Currency Conversion in Prose
**Risk:** Perfect China invoice
- Example: "For settlement in USD. @7.70, Please settle in USD 96.68"
- Problem: USD amount in sentence, not labeled as "Total"
- Current parser: Looks for "Total" label, may get HKD 744.43 instead
- Expected: Should extract USD amount from prose
- Fix: Add prose-based currency extraction patterns

### 3. Statement Type with Aged Balance
**Risk:** SF Express
- Problem: Total includes current month + overdue + surcharge
- Current parser: Treats as single invoice amount
- Expected: Should identify statement type and handle aged balance
- Fix: Add statement detection and multi-period aggregation logic

### 4. Currency Variations
**Risk:** Multiple currencies in same invoice
- Problem: USD, HKD, EUR, etc. in same document
- Current parser: May pick wrong currency
- Expected: Should identify correct currency for total
- Fix: Add currency context detection

### 5. Bank Charges and Fees
**Risk:** Total includes bank charges, freight, additional charges
- Problem: Subtotal vs total confusion
- Current parser: May get subtotal instead of final total
- Expected: Should identify and exclude charges from invoice amount
- Fix: Add charge detection and subtraction logic

## Recommendations

### For parsePOReference()
1. Normalize spaces to underscores before splitting
2. Accept both single and two-letter season codes
3. Add brand name to code mapping dictionary
4. Improve sub-season detection
5. Add comprehensive order type mapping

### For Amount Extraction
1. Implement multi-page PDF processing
2. Add prose-based currency extraction patterns
3. Add statement type detection
4. Add currency context detection
5. Add charge detection and subtraction logic

### Testing Strategy
1. Test with all 8 sample invoices
2. Test with edge cases (NOV BUY, FH26, PRANA, etc.)
3. Test with multi-page PDFs
4. Test with prose-based currency conversions
5. Test with statement-type invoices
