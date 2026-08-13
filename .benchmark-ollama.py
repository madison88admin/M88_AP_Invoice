"""
Benchmark: Compare Ollama models for invoice field extraction.
Uses OpenDataLoader Markdown output as input to each model.
Measures: speed (seconds) + accuracy (fields extracted correctly).
"""
import requests, json, time, subprocess, sys

OLLAMA_URL = "http://localhost:11434/api/generate"

# The clean Markdown from OpenDataLoader (CHECKPOINT- IA00493973.pdf)
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

Sub Total Amount : 339.50

Total Amount : USD 339.50

Bank Information: Bank Name: The Hongkong and Shanghai Banking Corporation Limited
Address : 1 Queen's Road , Central , Hong Kong.
Beneficiary: Checkpoint Systems Limited
Account No: 741-291777-001 (HKD) 741-291777-201 (USD) 741-291777-275 (EUR)
Swift Code : HSBCHKHHHKH
"""

PROMPT = """You are an invoice data extractor. Given the following invoice text, extract these fields and return ONLY a JSON object (no markdown, no explanation):

{
  "vendor_name": "",
  "invoice_number": "",
  "invoice_date": "",
  "due_date": "",
  "total_amount": 0,
  "currency": "",
  "mpo_number": "",
  "po_number": "",
  "payment_terms": "",
  "bank_name": "",
  "swift_code": "",
  "account_number": "",
  "beneficiary_name": ""
}

Invoice text:
""" + MARKDOWN

# Expected values for accuracy check
EXPECTED = {
    "vendor_name": "Checkpoint Systems Limited",
    "invoice_number": "IA00493973",
    "invoice_date": "07/25/2026",
    "due_date": "06/25/2026",
    "total_amount": 339.50,
    "currency": "USD",
    "mpo_number": "MPO15736",
    "payment_terms": "30 Days",
    "bank_name": "The Hongkong and Shanghai Banking Corporation Limited",
    "swift_code": "HSBCHKHHHKH",
    "account_number": "741-291777-201",
    "beneficiary_name": "Checkpoint Systems Limited",
}

MODELS = [
    "qwen3:4b",
    "qwen2.5:3b-instruct",
    "phi3.5:3.8b",
]

def run_model(model_name):
    print(f"\n{'='*60}")
    print(f"Testing: {model_name}")
    print(f"{'='*60}")

    payload = {
        "model": model_name,
        "prompt": PROMPT,
        "stream": False,
        "format": "json",
        "options": {
            "temperature": 0.1,
            "num_predict": 512,
            "timeout": 120,
        }
    }

    start = time.time()
    try:
        resp = requests.post(OLLAMA_URL, json=payload, timeout=120)
        elapsed = time.time() - start

        if resp.status_code != 200:
            print(f"  ERROR: HTTP {resp.status_code}")
            print(f"  Response: {resp.text[:200]}")
            return {"model": model_name, "time": elapsed, "error": resp.text[:200]}

        data = resp.json()
        raw_output = data.get("response", "")

        # Parse JSON output
        try:
            extracted = json.loads(raw_output)
        except json.JSONDecodeError:
            # Try to find JSON in the output
            import re
            match = re.search(r'\{.*\}', raw_output, re.DOTALL)
            if match:
                try:
                    extracted = json.loads(match.group())
                except:
                    print(f"  Failed to parse JSON. Raw output:")
                    print(f"  {raw_output[:300]}")
                    return {"model": model_name, "time": elapsed, "error": "JSON parse failed"}
            else:
                print(f"  No JSON found. Raw output:")
                print(f"  {raw_output[:300]}")
                return {"model": model_name, "time": elapsed, "error": "No JSON in output"}

        # Check accuracy
        correct = 0
        total = len(EXPECTED)
        field_results = {}

        for field, expected_val in EXPECTED.items():
            actual_val = str(extracted.get(field, "")).strip()
            expected_str = str(expected_val).strip()

            # Flexible matching
            if expected_str.lower() in actual_val.lower() or actual_val.lower() in expected_str.lower():
                correct += 1
                field_results[field] = "✓"
            else:
                field_results[field] = f"✗ (got: '{actual_val[:30]}')"

        accuracy = (correct / total) * 100

        print(f"  Time: {elapsed:.2f}s")
        print(f"  Accuracy: {correct}/{total} ({accuracy:.0f}%)")
        print(f"  Fields:")
        for field, status in field_results.items():
            print(f"    {field}: {status}")

        # Show eval count (tokens)
        eval_count = data.get("eval_count", 0)
        eval_duration = data.get("eval_duration", 0)
        if eval_duration > 0:
            tokens_per_sec = eval_count / (eval_duration / 1e9)
            print(f"  Tokens: {eval_count}, Speed: {tokens_per_sec:.1f} tok/s")

        return {
            "model": model_name,
            "time": elapsed,
            "accuracy": accuracy,
            "correct": correct,
            "total": total,
            "fields": field_results,
            "tokens": eval_count,
        }

    except requests.exceptions.Timeout:
        elapsed = time.time() - start
        print(f"  TIMEOUT after {elapsed:.1f}s")
        return {"model": model_name, "time": elapsed, "error": "timeout"}
    except Exception as e:
        elapsed = time.time() - start
        print(f"  ERROR: {e}")
        return {"model": model_name, "time": elapsed, "error": str(e)}

# Run benchmarks
results = []
for model in MODELS:
    result = run_model(model)
    results.append(result)

# Summary
print(f"\n{'='*60}")
print("SUMMARY")
print(f"{'='*60}")
print(f"{'Model':<25} {'Time':>8} {'Accuracy':>10} {'Tokens':>8}")
print(f"{'-'*25} {'-'*8} {'-'*10} {'-'*8}")
for r in results:
    if "error" in r:
        print(f"{r['model']:<25} {r['time']:>7.1f}s {'ERROR':>10} {'-':>8}")
    else:
        print(f"{r['model']:<25} {r['time']:>7.1f}s {r['accuracy']:>9.0f}% {r.get('tokens', 0):>8}")
