import { describe, it, expect, vi, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

const tmpDirs: string[] = [];

function makeDir(label: string) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `ap-queue-${label}-`));
  tmpDirs.push(dir);
  return dir;
}

/**
 * Load fresh module instances (queue + job store) pointed at an isolated
 * queue directory, simulating a fresh process boot. Module-level singletons
 * are re-created via vi.resetModules so each test/restart is independent.
 */
async function freshModules(queueDir: string, extraEnv: Record<string, string> = {}) {
  vi.resetModules();
  process.env.INVOICE_QUEUE_DIR = queueDir;
  process.env.ASYNC_JOB_STORE_PATH = path.join(queueDir, 'jobs.json');
  Object.assign(process.env, extraEnv);
  const queueMod = await import('./invoiceUploadQueue');
  const storeMod = await import('./jobStore');
  return { queue: queueMod.invoiceUploadQueue, store: storeMod };
}

function payloadPaths(dir: string, jobId: string) {
  return { meta: path.join(dir, `${jobId}.json`), bin: path.join(dir, `${jobId}.bin`) };
}

afterEach(() => {
  delete process.env.INVOICE_QUEUE_DIR;
  delete process.env.ASYNC_JOB_STORE_PATH;
  delete process.env.INVOICE_MAX_RETRIES;
  for (const dir of tmpDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  vi.resetModules();
});

describe('invoiceUploadQueue', () => {
  it('processes an enqueued upload and removes its payload', async () => {
    const dir = makeDir('basic');
    const { queue, store } = await freshModules(dir);

    const seen: string[] = [];
    queue.start(async (item, buf) => {
      seen.push(item.jobId);
      expect(buf.toString()).toBe('PAYLOAD');
      return { ok: true };
    });

    const jobId = store.createJob('madison-invoice-upload', 'queued');
    queue.enqueue({ jobId, fileName: 'a.pdf', mimeType: 'application/pdf' }, Buffer.from('PAYLOAD'));

    await vi.waitFor(() => expect(seen).toHaveLength(1));
    expect(store.getJob(jobId)?.status).toBe('completed');
    expect(fs.existsSync(payloadPaths(dir, jobId).meta)).toBe(false);
    expect(fs.existsSync(payloadPaths(dir, jobId).bin)).toBe(false);
  });

  it('recovers queued uploads across a simulated restart', async () => {
    const dir = makeDir('restart');

    // "Process A": enqueue a job but never start the worker (crash before drain).
    const a = await freshModules(dir);
    const jobId = a.store.createJob('madison-invoice-upload', 'queued');
    a.queue.enqueue({ jobId, fileName: 'r.pdf', mimeType: 'application/pdf' }, Buffer.from('RESTART-PAYLOAD'));
    expect(fs.existsSync(payloadPaths(dir, jobId).meta)).toBe(true);
    expect(fs.existsSync(payloadPaths(dir, jobId).bin)).toBe(true);

    // "Process B": boot with the same queue dir; the worker must recover it.
    const b = await freshModules(dir);
    const seen: string[] = [];
    b.queue.start(async (item, buf) => {
      seen.push(item.jobId);
      expect(item.fileName).toBe('r.pdf');
      expect(buf.toString()).toBe('RESTART-PAYLOAD');
      return { ok: true };
    });

    await vi.waitFor(() => expect(seen).toContain(jobId));
    expect(b.store.getJob(jobId)?.status).toBe('completed');
    expect(fs.existsSync(payloadPaths(dir, jobId).meta)).toBe(false);
  });

  it('keeps the payload after a transient failure so a restart can retry', async () => {
    const dir = makeDir('retry');
    const { queue, store } = await freshModules(dir);

    let calls = 0;
    queue.start(async () => {
      calls += 1;
      throw new Error('boom');
    });

    const jobId = store.createJob('madison-invoice-upload', 'queued');
    queue.enqueue({ jobId, fileName: 'f.pdf', mimeType: 'application/pdf' }, Buffer.from('X'));

    await vi.waitFor(() => expect(calls).toBe(1));
    expect(store.getJob(jobId)?.status).toBe('failed');
    // Payload retained for a future restart retry.
    expect(fs.existsSync(payloadPaths(dir, jobId).meta)).toBe(true);
    expect(fs.existsSync(payloadPaths(dir, jobId).bin)).toBe(true);

    // A second "restart" retries it (attempt 2 of 3) and fails again.
    const b = await freshModules(dir);
    const bCalls: string[] = [];
    b.queue.start(async (item) => {
      bCalls.push(item.jobId);
      throw new Error('boom again');
    });
    await vi.waitFor(() => expect(bCalls).toContain(jobId));
    expect(fs.existsSync(payloadPaths(dir, jobId).meta)).toBe(true);
  });

  it('permanently fails jobs that exhausted their retry budget and removes their payload', async () => {
    const dir = makeDir('cap');
    const { queue, store } = await freshModules(dir);

    // Simulate 3 prior failed attempts across restarts (INVOICE_MAX_RETRIES default 3).
    const jobId = store.createJob('madison-invoice-upload', 'queued');
    fs.writeFileSync(
      path.join(dir, `${jobId}.json`),
      JSON.stringify({ jobId, fileName: 'c.pdf', mimeType: 'application/pdf', attempts: 3, lastError: 'boom' })
    );
    fs.writeFileSync(path.join(dir, `${jobId}.bin`), 'X');

    const seen: string[] = [];
    queue.start(async (item) => { seen.push(item.jobId); return { ok: true }; });

    expect(seen).toHaveLength(0);
    expect(store.getJob(jobId)?.status).toBe('failed');
    expect(store.getJob(jobId)?.error).toContain('will not be retried');
    expect(fs.existsSync(payloadPaths(dir, jobId).meta)).toBe(false);
    expect(fs.existsSync(payloadPaths(dir, jobId).bin)).toBe(false);
  });

  it('fails corrupt metadata immediately instead of wedging the queue', async () => {
    const dir = makeDir('corrupt');
    const { queue, store } = await freshModules(dir);

    const jobId = store.createJob('madison-invoice-upload', 'queued');
    fs.writeFileSync(path.join(dir, `${jobId}.json`), '{not-json');
    fs.writeFileSync(path.join(dir, `${jobId}.bin`), 'X');

    const seen: string[] = [];
    queue.start(async (item) => { seen.push(item.jobId); return { ok: true }; });

    expect(seen).toHaveLength(0);
    expect(store.getJob(jobId)?.status).toBe('failed');
    expect(fs.existsSync(payloadPaths(dir, jobId).meta)).toBe(false);
  });

  it('purges stale and orphaned payload files on boot', async () => {
    const dir = makeDir('stale');
    const { queue } = await freshModules(dir);

    // Stale pair (old mtime) and an orphan .bin with no metadata.
    const staleId = 'stale-job';
    const staleBin = path.join(dir, `${staleId}.bin`);
    fs.writeFileSync(path.join(dir, `${staleId}.json`), JSON.stringify({ jobId: staleId, fileName: 's.pdf', mimeType: 'application/pdf' }));
    fs.writeFileSync(staleBin, 'X');
    const past = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);
    fs.utimesSync(path.join(dir, `${staleId}.json`), past, past);
    fs.utimesSync(staleBin, past, past);

    const orphanId = 'orphan-job';
    fs.writeFileSync(path.join(dir, `${orphanId}.bin`), 'X');

    queue.start(async () => ({ ok: true }));

    expect(fs.existsSync(path.join(dir, `${staleId}.json`))).toBe(false);
    expect(fs.existsSync(staleBin)).toBe(false);
    expect(fs.existsSync(path.join(dir, `${orphanId}.bin`))).toBe(false);
  });
});
