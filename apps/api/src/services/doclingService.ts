import { execFile, spawnSync } from 'child_process';
import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { promisify } from 'util';
import { logger } from '../utils/logger';

const execFileAsync = promisify(execFile);

/**
 * Docling PDF -> Markdown extraction service (local, CPU-only, ~78-89s/doc).
 *
 * Docling is NOT a Node dependency — it runs in the system Python on the VPS
 * (see src/python/docling_extract.py). This service shells out to it, caches
 * results by content hash, and serializes runs so concurrent fallbacks do not
 * saturate the CPU.
 *
 * Used as a second-opinion text source for problem invoices (low confidence or
 * failed validation) where RapidOCR's space-stripped text confuses the LLM.
 */
export class DoclingService {
  private python: string;
  private scriptPath: string;
  private timeoutMs: number;
  private enabled: boolean;

  private availability: boolean | null = null;
  private cache = new Map<string, string>();
  private runChain: Promise<unknown> = Promise.resolve();

  constructor() {
    this.python = process.env.DOCLING_PYTHON || 'python3';
    this.scriptPath = process.env.DOCLING_SCRIPT ||
      path.join(process.cwd(), 'src', 'python', 'docling_extract.py');
    this.timeoutMs = Number(process.env.DOCLING_TIMEOUT_MS) || 150000;
    this.enabled = (process.env.DOCLING_FALLBACK_ENABLED ?? 'true') !== 'false';
  }

  isAvailable(): boolean {
    if (!this.enabled) return false;
    if (this.availability !== null) return this.availability;
    this.availability = false;
    // Probe once (lazily) whether python + docling are importable.
    try {
      const result = spawnSync(this.python, ['-c', 'import docling'], {
        timeout: 15000,
        stdio: 'pipe',
      });
      this.availability = result.status === 0;
      if (!this.availability) {
        const msg = (result.stderr || '').toString().split('\n')[0] || 'unknown error';
        logger.warn(`[Docling] unavailable (${this.python}): ${msg}`);
      } else {
        logger.info(`[Docling] available via ${this.python}`);
      }
    } catch (e) {
      logger.warn(`[Docling] availability probe failed: ${e instanceof Error ? e.message : String(e)}`);
    }
    return this.availability;
  }

  /**
   * Extract clean Markdown from a PDF buffer using Docling.
   * Results are cached by content hash so re-runs of the same PDF are instant.
   */
  async extractMarkdown(pdfBuffer: Buffer): Promise<string> {
    if (!this.isAvailable()) {
      throw new Error('Docling is not available (DOCLING_FALLBACK_ENABLED=false or python/docling missing)');
    }

    const hash = crypto.createHash('sha1').update(pdfBuffer).digest('hex');
    const cached = this.cache.get(hash);
    if (cached) {
      logger.info(`[Docling] cache hit (${hash.slice(0, 8)}) — ${cached.length} chars`);
      return cached;
    }

    // Serialize runs: Docling is CPU-heavy; concurrent fallbacks would thrash.
    const run = this.runChain.then(() => this.runDocling(pdfBuffer, hash));
    this.runChain = run.catch(() => {});
    return run;
  }

  private async runDocling(pdfBuffer: Buffer, hash: string): Promise<string> {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'docling-'));
    const tmpPdf = path.join(tmpDir, 'invoice.pdf');
    fs.writeFileSync(tmpPdf, pdfBuffer);

    try {
      const started = Date.now();
      const { stdout, stderr } = await execFileAsync(this.python, [this.scriptPath, tmpPdf], {
        timeout: this.timeoutMs,
        maxBuffer: 20 * 1024 * 1024, // markdown can be large for multi-page docs
        windowsHide: true,
      });
      const elapsed = ((Date.now() - started) / 1000).toFixed(1);
      const stderrLine = stderr.split('\n').filter(Boolean).pop() || '';
      logger.info(`[Docling] extraction done in ${elapsed}s (${stdout.length} chars) ${stderrLine}`);

      if (!stdout || stdout.trim().length < 20) {
        throw new Error('Docling produced no usable markdown');
      }

      if (this.cache.size >= 200) {
        const oldestKey = this.cache.keys().next().value;
        if (oldestKey) this.cache.delete(oldestKey);
      }
      this.cache.set(hash, stdout);
      return stdout;
    } catch (e: any) {
      const detail = e?.stderr ? ` — ${e.stderr.toString().split('\n').filter(Boolean).slice(0, 3).join(' | ')}` : '';
      const message = e?.code === 'ETIMEDOUT'
        ? `Docling timed out after ${this.timeoutMs}ms`
        : `Docling extraction failed: ${e?.message || String(e)}${detail}`;
      logger.error(`[Docling] ${message}`);
      throw new Error(message);
    } finally {
      try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
    }
  }
}

export const doclingService = new DoclingService();
