-- Add missing ExceptionReason enum values
ALTER TYPE "AP_Invoice"."ExceptionReason" ADD VALUE 'VENDOR_THRESHOLD_EXCEEDED';
ALTER TYPE "AP_Invoice"."ExceptionReason" ADD VALUE 'BATCH_THRESHOLD_NOT_MET';
