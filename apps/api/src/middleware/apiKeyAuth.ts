import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import prisma from '../config/database';
import { logger } from '../utils/logger';

/**
 * Hash an API key for storage. Never store raw keys.
 */
export function hashApiKey(key: string): string {
  return crypto.createHash('sha256').update(key).digest('hex');
}

/**
 * Generate a new API key. Returns the raw key (shown once) and the hash (for storage).
 */
export function generateApiKey(): { rawKey: string; keyHash: string; keyPrefix: string } {
  const rawKey = `m88_${crypto.randomBytes(32).toString('hex')}`;
  const keyHash = hashApiKey(rawKey);
  const keyPrefix = rawKey.substring(0, 12);
  return { rawKey, keyHash, keyPrefix };
}

/**
 * API Key authentication middleware.
 * Checks X-API-Key header against DB-stored keys.
 * Falls back to WEBHOOK_API_KEY env var for backward compatibility.
 */
export async function apiKeyAuth(req: Request, res: Response, next: NextFunction) {
  try {
    const apiKey = req.headers['x-api-key'] as string | undefined;

    if (!apiKey) {
      return res.status(401).json({ success: false, error: 'Missing X-API-Key header' });
    }

    // Check env var fallback first (backward compat with existing Power Automate flows)
    if (process.env.WEBHOOK_API_KEY && apiKey === process.env.WEBHOOK_API_KEY) {
      return next();
    }

    // Check DB-stored keys
    const keyHash = hashApiKey(apiKey);

    let keyRecord: any = null;
    try {
      keyRecord = await prisma.$queryRaw`
        SELECT id, name, revoked_at, expires_at FROM "AP_Invoice"."APInvoice_ApiKey"
        WHERE key_hash = ${keyHash} AND revoked_at IS NULL
        LIMIT 1
      `;
      keyRecord = Array.isArray(keyRecord) ? keyRecord[0] : null;
    } catch (dbErr) {
      logger.warn('API Key DB lookup failed, falling back to env var only');
    }

    if (!keyRecord) {
      return res.status(401).json({ success: false, error: 'Invalid or revoked API key' });
    }

    // Check expiry
    if (keyRecord.expires_at && new Date(keyRecord.expires_at) < new Date()) {
      return res.status(401).json({ success: false, error: 'API key has expired' });
    }

    // Update last_used_at (fire and forget)
    try {
      await prisma.$executeRaw`
        UPDATE "AP_Invoice"."APInvoice_ApiKey"
        SET last_used_at = NOW()
        WHERE id = ${keyRecord.id}
      `;
    } catch {
      // Non-critical, ignore
    }

    (req as any).apiKeyName = keyRecord.name;
    next();
  } catch (error) {
    logger.error('API Key auth error:', error);
    return res.status(500).json({ success: false, error: 'Authentication error' });
  }
}
