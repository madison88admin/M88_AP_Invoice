-- Preserve Debit Note as a first-class document type for OCR and repository filtering.
ALTER TYPE "InvoiceType" ADD VALUE IF NOT EXISTS 'DEBIT_NOTE';
