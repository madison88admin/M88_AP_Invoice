import fs from 'fs';
import path from 'path';
import { completeJob, failJob, markJobProcessing } from './jobStore';

export interface QueuedInvoiceUpload {
  jobId: string;
  fileName: string;
  mimeType: string;
  user?: unknown;
  body?: Record<string, unknown>;
}

/**
 * On-disk metadata for a queued upload. `attempts` and `lastError` survive
 * restarts, so the retry budget and failure reasons are durable.
 */
interface QueuePayloadMeta extends QueuedInvoiceUpload {
  attempts?: number;
  lastError?: string;
}

type InvoiceProcessor = (item: QueuedInvoiceUpload, fileBuffer: Buffer) => Promise<unknown>;
const QUEUE_DIR = process.env.INVOICE_QUEUE_DIR || path.join(process.cwd(), 'data', 'invoice-upload-queue');
const CONCURRENCY = Math.max(1, Number(process.env.INVOICE_WORKER_CONCURRENCY || 2));
// Failed uploads are retried once per process restart, up to this many total
// attempts, so a permanently failing file can never cause an unbounded retry
// storm across deployments.
const MAX_RETRIES = Math.max(0, Number(process.env.INVOICE_MAX_RETRIES || 3));
// Payload files (including failed ones) older than this are purged at boot.
const PAYLOAD_RETENTION_MS = Number(process.env.INVOICE_QUEUE_RETENTION_MS || 7 * 24 * 60 * 60 * 1000);

class InvoiceUploadQueue {
  private pending: string[] = [];
  private active = 0;
  private processor?: InvoiceProcessor;

  constructor() { fs.mkdirSync(QUEUE_DIR, { recursive: true }); }

  start(processor: InvoiceProcessor): void {
    this.processor = processor;
    this.cleanupStalePayloads();
    const recovered = fs.readdirSync(QUEUE_DIR)
      .filter(name => name.endsWith('.json'))
      .map(name => path.basename(name, '.json'))
      .filter(id => !this.pending.includes(id));

    // Retry budget is per payload: jobs that exhausted their attempts on a
    // previous boot are failed permanently and removed so they can't be
    // re-queued again. Corrupt metadata can never succeed — drop it too.
    for (const id of recovered) {
      let meta: QueuePayloadMeta;
      try {
        meta = this.readMeta(id);
      } catch {
        this.failPermanently(id, 'Upload metadata is corrupt and could not be recovered. Please upload the file again.');
        continue;
      }
      const attempts = meta.attempts || 0;
      if (attempts >= MAX_RETRIES) {
        this.failPermanently(id, `Upload failed after ${attempts} attempt(s) across restarts and will not be retried. Please upload the file again.`);
        continue;
      }
      this.pending.push(id);
    }
    this.drain();
  }

  enqueue(item: QueuedInvoiceUpload, fileBuffer: Buffer): number {
    fs.writeFileSync(this.bufferPath(item.jobId), fileBuffer);
    fs.writeFileSync(this.metadataPath(item.jobId), JSON.stringify({ ...item, attempts: 0 }), 'utf8');
    this.pending.push(item.jobId);
    this.drain();
    return this.pending.length + this.active;
  }

  stats() { return { concurrency: CONCURRENCY, active: this.active, queued: this.pending.length }; }

  private drain(): void {
    while (this.processor && this.active < CONCURRENCY && this.pending.length) {
      const jobId = this.pending.shift()!;
      this.active += 1;
      void this.run(jobId).finally(() => { this.active -= 1; this.drain(); });
    }
  }

  private async run(jobId: string): Promise<void> {
    let meta: QueuePayloadMeta;
    try {
      meta = this.readMeta(jobId);
    } catch {
      this.failPermanently(jobId, 'Upload metadata is corrupt and could not be recovered. Please upload the file again.');
      return;
    }
    meta.attempts = (meta.attempts || 0) + 1;
    meta.lastError = undefined;
    this.writeMeta(meta);

    let fileBuffer: Buffer;
    try {
      fileBuffer = fs.readFileSync(this.bufferPath(jobId));
    } catch {
      // The .bin half is gone or unreadable — this payload can never succeed.
      this.failPermanently(jobId, 'Upload file payload is missing or unreadable. Please upload the file again.');
      return;
    }

    try {
      markJobProcessing(jobId);
      completeJob(jobId, await this.processor!(meta, fileBuffer));
      this.removePayload(jobId);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      failJob(jobId, message);
      meta.lastError = message;
      this.writeMeta(meta);
      if ((meta.attempts || 0) >= MAX_RETRIES) {
        // Retry budget exhausted — drop the payload so the next boot doesn't
        // re-queue a file that can never succeed.
        this.failPermanently(jobId, `${message} — failed ${meta.attempts} attempt(s) across restarts; will not retry. Please upload the file again.`);
      }
    }
  }

  private readMeta(id: string): QueuePayloadMeta {
    return JSON.parse(fs.readFileSync(this.metadataPath(id), 'utf8')) as QueuePayloadMeta;
  }

  private writeMeta(meta: QueuePayloadMeta): void {
    fs.writeFileSync(this.metadataPath(meta.jobId), JSON.stringify(meta), 'utf8');
  }

  private metadataPath(id: string) { return path.join(QUEUE_DIR, `${id}.json`); }
  private bufferPath(id: string) { return path.join(QUEUE_DIR, `${id}.bin`); }

  private failPermanently(id: string, message: string): void {
    failJob(id, message);
    this.removePayload(id);
  }

  private removePayload(id: string): void {
    for (const filePath of [this.metadataPath(id), this.bufferPath(id)]) {
      try { fs.unlinkSync(filePath); } catch (error: any) {
        if (error?.code !== 'ENOENT') console.warn(`[InvoiceQueue] Could not remove ${filePath}:`, error);
      }
    }
  }

  /** Drop payload files older than the retention window, plus orphan halves. */
  private cleanupStalePayloads(): void {
    const now = Date.now();
    for (const name of fs.readdirSync(QUEUE_DIR)) {
      const full = path.join(QUEUE_DIR, name);
      let stat: fs.Stats;
      try { stat = fs.statSync(full); } catch { continue; }
      if (stat.isFile() && now - stat.mtimeMs > PAYLOAD_RETENTION_MS) {
        try { fs.unlinkSync(full); } catch (error: any) {
          if (error?.code !== 'ENOENT') console.warn(`[InvoiceQueue] Could not remove stale payload ${full}:`, error);
        }
      }
    }
    for (const name of fs.readdirSync(QUEUE_DIR)) {
      if (!name.endsWith('.json') && !name.endsWith('.bin')) continue;
      const id = path.basename(name, path.extname(name));
      if (!fs.existsSync(this.metadataPath(id)) || !fs.existsSync(this.bufferPath(id))) {
        this.removePayload(id);
      }
    }
  }
}

export const invoiceUploadQueue = new InvoiceUploadQueue();
