"""
Test PO and MPO extraction with Ollama Qwen2.5:3b-instruct
Uses the actual OpenDataLoader Markdown from CHECKPOINT invoice.
"""
import requests, json, time

OLLAMA_URL = "http://localhost:11434/api/chat"

# Actual Markdown from CHECKPOINT- IA00493973.pdf (from OpenDataLoader)
MARKDOWN = """# CHECKPOINT SYSTEMS LIMITED

Sales Invoice Invoice No

### IA00493973

Bill To : Ship To:

MADISON 88 LTD 2433 Curtis Street 2nd Floor Denver, CO 80205 USA Denver United States Zip: 80205 Attn: Veronica Hualpa Tel: 212-239-3962

PT. UWU JUMP INDONESIA KP. Jatirawing RT 13 RW 06, Desa, Gunungsari, Kec. Pagaden, Kab. NPWP:071.009.591.0-439.000 Subang Indonesia Zip: 41252 Attn: Sari Tel: (0260) 760 9110

## MPO15736

Customer Code E0000003RG

Invoice Date : 07/25/2026 SI No: Payment Terms :

Due Date:

06/25/2026 SI0000GVWP

30 Days

S No Order No Item Code Item Description Quantity UoM Unit Price Amount

CORE_P_HTAG_RFID VendorNo: VNS PO3011-MPO15736-CA Shopping Cart#:6283854 PO#VN000PNTEMP
227458 1152587 250 0.0375900 9.40

CORE_PBAG_ST Vans Core Polybag Sticker VendorNo: VNS PO3011-MPO15736-CA Shopping Cart#:6283854 PO#VN000T5HEMV
227459 1113411 250 0.0067600 1.69

Sub Total Amount : 339.50

Total Amount : USD 339.50

Bank Information: Bank Name: The Hongkong and Shanghai Banking Corporation Limited
Address : 1 Queen's Road , Central , Hong Kong.
Beneficiary: Checkpoint Systems Limited
Account No: 741-291777-001 (HKD) 741-291777-201 (USD) 741-291777-275 (EUR)
Swift Code : HSBCHKHHHKH
"""

PROMPT = """You are an invoice data extractor for Madison 88. Extract these fields and return ONLY valid JSON:

Fields:
- vendor_name: Company name of the vendor/supplier (NOT Madison 88)
- invoice_number: Invoice number
- po_number: Customer Purchase Order number (e.g., "PO3011"). Extract ONLY the PO part, NOT the MPO.
- mpo_number: Material Purchase Order number (e.g., "MPO15736"). Look for headers like "## MPO15736" or references like "PO3011-MPO15736-CA".

Return ONLY JSON:
{
  "vendor_name": "",
  "invoice_number": "",
  "po_number": "",
  "mpo_number": ""
}

Invoice text:
""" + MARKDOWN

payload = {
    "model": "qwen2.5:3b-instruct",
    "messages": [
        {"role": "system", "content": "You are an invoice data extractor. Return ONLY valid JSON, no explanation."},
        {"role": "user", "content": PROMPT},
    ],
    "stream": False,
    "format": "json",
    "options": {"temperature": 0.1, "num_predict": 256},
}

print("Testing PO/MPO extraction with Qwen2.5:3b-instruct...")
start = time.time()
resp = requests.post(OLLAMA_URL, json=payload, timeout=120)
elapsed = time.time() - start

print(f"Time: {elapsed:.1f}s")
print(f"Status: {resp.status_code}")

data = resp.json()
raw = data.get("message", {}).get("content", "")
print(f"Raw output: {raw}")

try:
    result = json.loads(raw)
    print(f"\n=== RESULTS ===")
    print(f"  vendor_name:  {result.get('vendor_name')}")
    print(f"  invoice_number: {result.get('invoice_number')}")
    print(f"  po_number:    {result.get('po_number')}")
    print(f"  mpo_number:   {result.get('mpo_number')}")

    # Check accuracy
    print(f"\n=== ACCURACY ===")
    print(f"  PO Number (expect PO3011): {'✓' if 'PO3011' in str(result.get('po_number', '')) else '✗'}")
    print(f"  MPO Number (expect MPO15736): {'✓' if 'MPO15736' in str(result.get('mpo_number', '')) else '✗'}")
except:
    print("Failed to parse JSON")
