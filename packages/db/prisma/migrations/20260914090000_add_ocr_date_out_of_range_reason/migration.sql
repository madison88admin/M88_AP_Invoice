-- Scheduled OCR date-sanity check flags invoices whose invoice_date year is
-- outside a sane range (e.g. the 2001-style OCR corruption bug), so corrupted
-- dates can never silently reach accounting.
ALTER TYPE "AP_Invoice"."ExceptionReason" ADD VALUE IF NOT EXISTS 'OCR_DATE_OUT_OF_RANGE';
