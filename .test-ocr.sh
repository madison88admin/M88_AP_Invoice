#!/bin/bash
cd /opt/ap-invoice/apps/api
TOKEN=$(node -e "
const jwt = require('jsonwebtoken');
const token = jwt.sign(
  { id: 'test-ocr-only', email: 'jc@madison88.com', role: 'SUPERADMIN', name: 'JC' },
  process.env.JWT_SECRET || 'madison88-jwt-secret-dev',
  { expiresIn: '1h' }
);
console.log(token);
" 2>&1)

PDF="${1:-/incoming-invoices/manual-review/MS 353816 shipment.pdf}"
echo "=== Test OCR: $PDF ==="

curl -s -X POST http://localhost:3001/api/invoices/upload \
  -F "file=@${PDF}" \
  -H "Authorization: Bearer $TOKEN" \
  --max-time 120 2>&1 > /tmp/ocr-result.json

echo "Response size: $(wc -c < /tmp/ocr-result.json) bytes"
echo ""

# Pretty print extraction only
node -e "
const fs = require('fs');
const raw = fs.readFileSync('/tmp/ocr-result.json', 'utf8');
try {
  const data = JSON.parse(raw);
  console.log('Success:', data.success);
  
  if (data.extraction) {
    const e = data.extraction;
    console.log('');
    console.log('=== EXTRACTED FIELDS ===');
    console.log('Vendor:', e.vendor_name || 'N/A');
    console.log('Invoice #:', e.invoice_number || 'N/A');
    console.log('Date:', e.invoice_date || 'N/A');
    console.log('Due Date:', e.due_date || 'N/A');
    console.log('Amount:', e.total_amount || 'N/A');
    console.log('Currency:', e.currency || 'N/A');
    console.log('MPO:', e.mpo_number || 'N/A');
    console.log('PO:', e.po_number || 'N/A');
    console.log('Brand:', e.brand || 'N/A');
    console.log('Season:', e.season || 'N/A');
    console.log('Payment Terms:', e.payment_terms || 'N/A');
    console.log('Qty Shipped:', e.qty_shipped || 'N/A');
    console.log('Doc Type:', e.document_type || 'N/A');
    console.log('Subtotal:', e.subtotal || 'N/A');
    console.log('Incoterm:', e.incoterm || 'N/A');
    console.log('');
    console.log('=== CHARGES ===');
    console.log('Bank Charges:', e.bank_charges || 'N/A');
    console.log('TT Charge:', e.tt_charge || 'N/A');
    console.log('Freight:', e.freight_charges || 'N/A');
    console.log('Courier:', e.courier_charges || 'N/A');
    console.log('Handling:', e.handling_fee || 'N/A');
    console.log('Tax:', e.tax_amount || 'N/A');
    console.log('Discount:', e.discount_amount || 'N/A');
    console.log('');
    console.log('=== BANK DETAILS ===');
    console.log('Bank:', e.bank_name || 'N/A');
    console.log('SWIFT:', e.swift_code || 'N/A');
    console.log('Account:', e.account_number || 'N/A');
    console.log('Beneficiary:', e.beneficiary_name || 'N/A');
    console.log('');
    
    if (e.line_items && e.line_items.length > 0) {
      console.log('=== LINE ITEMS (' + e.line_items.length + ') ===');
      e.line_items.forEach((li, i) => {
        console.log((i+1) + '. ' + (li.description || 'N/A') + ' | Qty: ' + li.quantity + ' | Price: ' + li.unit_price + ' | Total: ' + li.total_amount + (li.mpo_number ? ' | MPO: ' + li.mpo_number : '') + (li.size ? ' | Size: ' + li.size : ''));
      });
      console.log('');
    }
    
    if (e.signatures && e.signatures.length > 0) {
      console.log('=== SIGNATURES ===');
      e.signatures.forEach(s => {
        console.log('- ' + s.signatory_name + ' (' + (s.signatory_role || 'N/A') + ') ' + (s.signed_date || ''));
      });
      console.log('');
    }
  }
  
  if (data.decision) {
    console.log('=== DECISION ENGINE ===');
    console.log('Confidence:', data.decision.overall_confidence + '%');
    console.log('Status:', data.decision.overall_status);
    console.log('Requires Review:', data.decision.requires_review);
    console.log('Engines Used:', (data.decision.engines_used || []).join(', '));
    if (data.decision.review_fields && data.decision.review_fields.length > 0) {
      console.log('Review Fields:', data.decision.review_fields.join(', '));
    }
    console.log('');
  }
  
  if (data.vendor_match) {
    console.log('=== VENDOR MATCH ===');
    console.log('Vendor:', data.vendor_match.vendor_name);
    console.log('ID:', data.vendor_match.vendor_id);
  } else {
    console.log('=== VENDOR MATCH ===');
    console.log('No vendor matched');
  }
  
  console.log('');
  console.log('=========================================');
  console.log('NOTE: OCR-only test. Nothing saved to DB.');
  console.log('=========================================');
} catch (err) {
  console.log('Parse error:', err.message);
  console.log('Raw (first 1000):', raw.substring(0, 1000));
}
"
