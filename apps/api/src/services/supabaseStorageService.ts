import { logger } from '../utils/logger';

const SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost:8000';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const BUCKET = process.env.SUPABASE_STORAGE_BUCKET || 'AP_Invoice_Storage';

/**
 * Upload a file buffer to Supabase Storage bucket.
 * Returns the storage path (key) on success, null on failure.
 */
export async function uploadToStorage(
  buffer: Buffer,
  fileName: string,
  contentType: string
): Promise<string | null> {
  if (!SUPABASE_SERVICE_KEY) {
    logger.warn('[Storage] SUPABASE_SERVICE_ROLE_KEY not configured — skipping upload');
    return null;
  }

  // Build a unique path: invoices/{year}/{month}/{timestamp}_{filename}
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const ts = now.getTime();
  const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
  const storagePath = `invoices/${year}/${month}/${ts}_${safeName}`;

  try {
    const url = `${SUPABASE_URL}/storage/v1/object/${BUCKET}/${storagePath}`;
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
        'Content-Type': contentType,
        'x-upsert': 'true',
      },
      body: buffer,
    });

    if (!response.ok) {
      const text = await response.text();
      logger.error(`[Storage] Upload failed (${response.status}): ${text}`);
      return null;
    }

    logger.info(`[Storage] Uploaded ${fileName} → ${BUCKET}/${storagePath}`);
    return storagePath;
  } catch (error) {
    logger.error(`[Storage] Upload error for ${fileName}:`, error);
    return null;
  }
}

/**
 * Get the full storage URL for a given path.
 */
export function getStorageUrl(storagePath: string): string {
  return `${SUPABASE_URL}/storage/v1/object/${BUCKET}/${storagePath}`;
}

/**
 * Download a file from Supabase Storage.
 */
export async function downloadFromStorage(storagePath: string): Promise<Buffer | null> {
  if (!SUPABASE_SERVICE_KEY) {
    logger.warn('[Storage] SUPABASE_SERVICE_ROLE_KEY not configured — skipping download');
    return null;
  }

  try {
    const url = `${SUPABASE_URL}/storage/v1/object/${BUCKET}/${storagePath}`;
    const response = await fetch(url, {
      headers: { 'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}` },
    });

    if (!response.ok) {
      logger.error(`[Storage] Download failed (${response.status}) for ${storagePath}`);
      return null;
    }

    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer);
  } catch (error) {
    logger.error(`[Storage] Download error for ${storagePath}:`, error);
    return null;
  }
}
