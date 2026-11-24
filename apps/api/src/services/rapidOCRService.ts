import { logger } from '../utils/logger';

const RAPIDOCR_URL = process.env.RAPIDOCR_URL || 'http://localhost:8500';

class RapidOCRService {
  private baseUrl: string;

  constructor() {
    this.baseUrl = RAPIDOCR_URL;
  }

  isAvailable(): boolean {
    return !!this.baseUrl;
  }

  /**
   * Extract text from a PDF or image using the RapidOCR Python microservice.
   * The MIME type must match the actual payload; sending a PNG/JPEG as a PDF
   * makes the service try to parse it as a PDF and produces Invalid XRef errors.
   */
  async extractText(fileBuffer: Buffer, mimeType = 'application/pdf', fileName = 'invoice.pdf'): Promise<{ text: string; confidence: number; page_count: number; elapsed_ms: number } | null> {
    try {
      const normalizedMime = mimeType || 'application/pdf';
      const blob = new Blob([fileBuffer], { type: normalizedMime });
      const formData = new FormData();
      const extension = normalizedMime === 'image/png' ? '.png'
        : normalizedMime === 'image/jpeg' ? '.jpg'
        : normalizedMime === 'image/gif' ? '.gif'
        : normalizedMime === 'image/tiff' ? '.tiff'
        : normalizedMime === 'image/webp' ? '.webp'
        : normalizedMime === 'image/bmp' ? '.bmp' : '.pdf';
      const safeName = fileName && fileName !== 'invoice.bin'
        ? fileName
        : `invoice${extension}`;
      formData.append('file', blob, safeName);

      const response = await fetch(`${this.baseUrl}/extract`, {
        method: 'POST',
        body: formData,
        signal: AbortSignal.timeout(120000),
      });

      if (!response.ok) {
        logger.error(`[RapidOCR] HTTP ${response.status}: ${await response.text()}`);
        return null;
      }

      const data = await response.json() as any;

      if (data && data.text) {
        logger.info(`[RapidOCR] Extraction succeeded: ${data.text.length} chars, confidence: ${data.confidence}, ${data.elapsed_ms}ms`);
        return data;
      }

      logger.warn('[RapidOCR] No text returned from service');
      return null;
    } catch (error: any) {
      if (error?.code === 'ECONNREFUSED' || error?.cause?.code === 'ECONNREFUSED') {
        logger.warn('[RapidOCR] Service not running on ' + this.baseUrl);
      } else {
        logger.error('[RapidOCR] Extraction failed:', error?.message || String(error));
      }
      return null;
    }
  }

  /**
   * Health check — verify the Python service is running.
   */
  async healthCheck(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/health`, {
        signal: AbortSignal.timeout(5000),
      });
      const data = await response.json() as any;
      return data?.status === 'ok';
    } catch {
      return false;
    }
  }
}

export const rapidOCRService = new RapidOCRService();
