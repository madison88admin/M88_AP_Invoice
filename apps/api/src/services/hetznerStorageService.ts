import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { logger } from '../utils/logger';

const ENDPOINT = process.env.HETZNER_S3_ENDPOINT || 'https://hel1.your-objectstorage.com';
const ACCESS_KEY = process.env.HETZNER_S3_ACCESS_KEY || '';
const SECRET_KEY = process.env.HETZNER_S3_SECRET_KEY || '';
const BUCKET = process.env.HETZNER_S3_BUCKET || 'm88';
const REGION = process.env.HETZNER_S3_REGION || 'hel1';
const BASE_PREFIX = process.env.HETZNER_S3_PREFIX || 'JC/AP_Invoice';

let client: S3Client | null = null;

function getClient(): S3Client | null {
  if (!ACCESS_KEY || !SECRET_KEY) {
    logger.warn('[Hetzner] HETZNER_S3_ACCESS_KEY or HETZNER_S3_SECRET_KEY not configured — skipping sync');
    return null;
  }
  if (!client) {
    client = new S3Client({
      endpoint: ENDPOINT,
      region: REGION,
      credentials: {
        accessKeyId: ACCESS_KEY,
        secretAccessKey: SECRET_KEY,
      },
      forcePathStyle: true,
    });
  }
  return client;
}

/**
 * Build the Hetzner object key based on received_date.
 * Format: JC/AP_Invoice/{VendorName}/{Year}/{Month}/{invoice_number}.pdf
 */
function buildKey(vendorName: string, invoiceNumber: string, receivedDate: Date): string {
  const year = receivedDate.getFullYear();
  const month = String(receivedDate.getMonth() + 1).padStart(2, '0');
  const safeVendor = vendorName.replace(/[^a-zA-Z0-9._-]/g, '_').substring(0, 80) || 'Unknown';
  const safeInvoice = invoiceNumber.replace(/[^a-zA-Z0-9._-]/g, '_') || 'unknown';
  return `${BASE_PREFIX}/${safeVendor}/${year}/${month}/${safeInvoice}.pdf`;
}

/**
 * Sync an invoice PDF buffer to Hetzner Object Storage.
 * Returns the S3 key on success, null on failure.
 *
 * Non-blocking: callers should use .then()/.catch() to avoid blocking the request.
 */
export async function syncToHetzner(
  buffer: Buffer,
  vendorName: string,
  invoiceNumber: string,
  receivedDate: Date
): Promise<string | null> {
  const s3 = getClient();
  if (!s3) return null;

  const key = buildKey(vendorName, invoiceNumber, receivedDate);

  try {
    await s3.send(
      new PutObjectCommand({
        Bucket: BUCKET,
        Key: key,
        Body: buffer,
        ContentType: 'application/pdf',
      })
    );
    logger.info(`[Hetzner] Synced ${invoiceNumber} → s3://${BUCKET}/${key}`);
    return key;
  } catch (error) {
    logger.error(`[Hetzner] Sync failed for ${invoiceNumber}:`, error);
    return null;
  }
}

/**
 * Get the full S3 URL for a given key.
 */
export function getHetznerUrl(key: string): string {
  return `${ENDPOINT}/${BUCKET}/${key}`;
}
