-- Delete all invoice data in order respecting foreign key constraints
DELETE FROM "Payment";
DELETE FROM "Notification";
DELETE FROM "StageTimestamp";
DELETE FROM "Signature";
DELETE FROM "Exception";
DELETE FROM "Invoice";
