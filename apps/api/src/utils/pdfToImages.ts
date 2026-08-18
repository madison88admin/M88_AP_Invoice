import { execSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { logger } from './logger';

/**
 * Convert PDF to PNG image using pdftoppm (poppler-utils).
 * Returns base64-encoded image string, or null if conversion fails.
 */
export function convertPDFToImage(fileBuffer: Buffer): string | null {
  const tmpDir = os.tmpdir();
  const tmpPdf = path.join(tmpDir, `invoice_${Date.now()}.pdf`);
  const tmpImgPrefix = path.join(tmpDir, `invoice_${Date.now()}`);

  try {
    fs.writeFileSync(tmpPdf, fileBuffer);
    logger.info(`[OCR] Converting PDF to image using pdftoppm...`);

    // Convert first page to PNG at 300 DPI with grayscale for better OCR contrast
    execSync(`pdftoppm -png -gray -r 300 -f 1 -l 1 "${tmpPdf}" "${tmpImgPrefix}"`, {
      timeout: 30000,
      stdio: 'pipe',
    });

    // Find the generated image file
    const imgFile = `${tmpImgPrefix}-1.png`;
    if (!fs.existsSync(imgFile)) {
      // Try alternative naming
      const files = fs.readdirSync(tmpDir).filter(f => f.startsWith(path.basename(tmpImgPrefix)));
      if (files.length === 0) {
        logger.error('[OCR] PDF-to-image conversion produced no output files');
        return null;
      }
      const imgPath = path.join(tmpDir, files[0]);
      const imgBuffer = fs.readFileSync(imgPath);
      const base64 = imgBuffer.toString('base64');
      fs.unlinkSync(imgPath);
      return base64;
    }

    const imgBuffer = fs.readFileSync(imgFile);
    const base64 = imgBuffer.toString('base64');
    fs.unlinkSync(imgFile);
    logger.info(`[OCR] PDF-to-image conversion succeeded (${(base64.length / 1024).toFixed(0)}KB base64)`);
    return base64;
  } catch (error) {
    logger.error('[OCR] PDF-to-image conversion failed:', error);
    return null;
  } finally {
    try { fs.unlinkSync(tmpPdf); } catch {}
  }
}

/**
 * Convert ALL pages of a PDF to PNG images using pdftoppm (poppler-utils).
 * Returns array of base64-encoded image strings, or empty array if conversion fails.
 * Uses 300 DPI for better OCR accuracy.
 */
export function convertPDFToImages(fileBuffer: Buffer): string[] {
  const tmpDir = os.tmpdir();
  const tmpPdf = path.join(tmpDir, `invoice_${Date.now()}.pdf`);
  const tmpImgPrefix = path.join(tmpDir, `invoice_${Date.now()}`);

  try {
    fs.writeFileSync(tmpPdf, fileBuffer);
    logger.info(`[OCR] Converting PDF to images (all pages) using pdftoppm...`);

    // Convert ALL pages to PNG at 300 DPI with grayscale for better OCR contrast
    execSync(`pdftoppm -png -gray -r 300 "${tmpPdf}" "${tmpImgPrefix}"`, {
      timeout: 60000,
      stdio: 'pipe',
    });

    // Find all generated image files (sorted by page number)
    const prefix = path.basename(tmpImgPrefix);
    const files = fs.readdirSync(tmpDir)
      .filter(f => f.startsWith(prefix) && f.endsWith('.png'))
      .sort();

    if (files.length === 0) {
      logger.error('[OCR] PDF-to-images conversion produced no output files');
      return [];
    }

    const images: string[] = [];
    for (const file of files) {
      const imgPath = path.join(tmpDir, file);
      const imgBuffer = fs.readFileSync(imgPath);
      images.push(imgBuffer.toString('base64'));
      fs.unlinkSync(imgPath);
    }

    logger.info(`[OCR] PDF-to-images conversion succeeded — ${images.length} pages, total ${(images.reduce((s, i) => s + i.length, 0) / 1024).toFixed(0)}KB base64`);
    return images;
  } catch (error) {
    logger.error('[OCR] PDF-to-images conversion failed:', error);
    return [];
  } finally {
    try { fs.unlinkSync(tmpPdf); } catch {}
  }
}
