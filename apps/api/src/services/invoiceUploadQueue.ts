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

type InvoiceProcessor = (item: QueuedInvoiceUpload, fileBuffer: Buffer) => Promise<unknown>;
const QUEUE_DIR = process.env.INVOICE_QUEUE_DIR || path.join(process.cwd(), 'data', 'invoice-upload-queue');
const CONCURRENCY = Math.max(1, Number(process.env.INVOICE_WORKER_CONCURRENCY || 2));

class InvoiceUploadQueue {
  private pending: string[] = [];
  private active = 0;
  private processor?: InvoiceProcessor;

  constructor() { fs.mkdirSync(QUEUE_DIR, { recursive: true }); }

  start(processor: InvoiceProcessor): void {
    this.processor = processor;
    const recovered = fs.readdirSync(QUEUE_DIR)
      .filter(name => name.endsWith('.json'))
      .map(name => path.basename(name, '.json'));
    this.pending.push(...recovered.filter(id => !this.pending.includes(id)));
    this.drain();
  }

  enqueue(item: QueuedInvoiceUpload, fileBuffer: Buffer): number {
    fs.writeFileSync(this.bufferPath(item.jobId), fileBuffer);
    fs.writeFileSync(this.metadataPath(item.jobId), JSON.stringify(item), 'utf8');
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
    try {
      const item = JSON.parse(fs.readFileSync(this.metadataPath(jobId), 'utf8')) as QueuedInvoiceUpload;
      const fileBuffer = fs.readFileSync(this.bufferPath(jobId));
      markJobProcessing(jobId);
      completeJob(jobId, await this.processor!(item, fileBuffer));
      this.removePayload(jobId);
    } catch (error) {
      failJob(jobId, error instanceof Error ? error.message : String(error));
    }
  }

  private metadataPath(id: string) { return path.join(QUEUE_DIR, `${id}.json`); }
  private bufferPath(id: string) { return path.join(QUEUE_DIR, `${id}.bin`); }
  private removePayload(id: string): void {
    for (const filePath of [this.metadataPath(id), this.bufferPath(id)]) {
      try { fs.unlinkSync(filePath); } catch (error: any) {
        if (error?.code !== 'ENOENT') console.warn(`[InvoiceQueue] Could not remove ${filePath}:`, error);
      }
    }
  }
}

export const invoiceUploadQueue = new InvoiceUploadQueue();
