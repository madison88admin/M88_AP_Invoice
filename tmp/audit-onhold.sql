/* BEGIN;

CREATE TEMP TABLE legacy_purchasing_holds AS
SELECT DISTINCT i.id
FROM "AP_Invoice"."APInvoice_Invoice" i
JOIN "AP_Invoice"."APInvoice_Exception" e ON e.invoice_id = i.id
WHERE i.status = 'ON_HOLD'
  AND e.status = 'PENDING'
  AND e.reason = 'BATCH_THRESHOLD_NOT_MET'
  AND NOT EXISTS (
    SELECT 1 FROM "AP_Invoice"."APInvoice_Signature" s
    WHERE s.invoice_id = i.id AND s.approval_status = 'APPROVED'
  );

UPDATE "AP_Invoice"."APInvoice_Exception" e
SET status = 'RESOLVED', resolved_at = now(), resolved_by = 'system-migration',
    resolution_notes = 'Legacy Purchasing-stage batch hold removed; ON_HOLD is now Accounting-only.'
WHERE e.invoice_id IN (SELECT id FROM legacy_purchasing_holds)
  AND e.status = 'PENDING' AND e.reason = 'BATCH_THRESHOLD_NOT_MET';

UPDATE "AP_Invoice"."APInvoice_Invoice" i
SET status = 'VALIDATION_PENDING', current_approver_role = NULL, updated_at = now()
WHERE i.id IN (SELECT id FROM legacy_purchasing_holds);

INSERT INTO "AP_Invoice"."APInvoice_AuditLog" (id, invoice_id, action, performed_by, note, created_at)
SELECT gen_random_uuid(), id, 'PURCHASING_HOLD_REMOVED', 'system-migration',
       'Legacy Purchasing-stage ON_HOLD removed. Invoice returned to VALIDATION_PENDING under Accounting-only hold policy.', now()
FROM legacy_purchasing_holds;

SELECT COUNT(*) AS migrated_count FROM legacy_purchasing_holds;
COMMIT;
*/

BEGIN;

UPDATE "AP_Invoice"."APInvoice_Invoice"
SET invoice_number = 'PI169580',
    status = 'PENDING_COORDINATOR',
    current_approver_role = 'COORDINATOR',
    updated_at = now()
WHERE id = '550d0469-bf17-42a9-a788-067895682914';

UPDATE "AP_Invoice"."APInvoice_Signature"
SET signed_at = NULL,
    approval_status = 'PENDING',
    invalidated_at = now(),
    invalidation_reason = 'Re-opened after Purchasing Manager rejection; legacy routing repair.'
WHERE id = '54f1465e-24d4-46d2-92da-79002556339a'
  AND invoice_id = '550d0469-bf17-42a9-a788-067895682914';

INSERT INTO "AP_Invoice"."APInvoice_AuditLog" (id, invoice_id, action, performed_by, note, created_at)
VALUES (
  gen_random_uuid(),
  '550d0469-bf17-42a9-a788-067895682914',
  'REJECTION_ROUTING_REPAIRED',
  'system-migration',
  'Corrected malformed invoice number PI169580BillToMadison88 to PI169580 and re-opened Maricon coordinator approval after Purchasing Manager rejection.',
  now()
);

COMMIT;

SELECT i.invoice_number, i.status, i.current_approver_role,
       s.signatory_name, s.signed_at, s.approval_status
FROM "AP_Invoice"."APInvoice_Invoice" i
JOIN "AP_Invoice"."APInvoice_Signature" s ON s.invoice_id = i.id AND s.signatory_role = 'COORDINATOR'
WHERE i.id = '550d0469-bf17-42a9-a788-067895682914';
