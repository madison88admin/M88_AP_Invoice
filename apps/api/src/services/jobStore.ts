import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

export interface AsyncJob {
  id: string;
  type: string;
  status: 'queued' | 'processing' | 'completed' | 'failed';
  result?: any;
  error?: string;
  createdAt: number;
  updatedAt: number;
}

const JOB_RETENTION_MS = Number(process.env.ASYNC_JOB_RETENTION_MS || 24 * 60 * 60 * 1000);
const JOB_STORE_PATH = process.env.ASYNC_JOB_STORE_PATH
  || path.join(process.cwd(), 'data', 'async-jobs.json');

const jobs = new Map<string, AsyncJob>();

function persistJobs(): void {
  try {
    fs.mkdirSync(path.dirname(JOB_STORE_PATH), { recursive: true });
    const temporaryPath = `${JOB_STORE_PATH}.tmp`;
    fs.writeFileSync(temporaryPath, JSON.stringify(Array.from(jobs.values())), 'utf8');
    fs.renameSync(temporaryPath, JOB_STORE_PATH);
  } catch (error) {
    console.error('[JobStore] Failed to persist async jobs:', error);
  }
}

function loadJobs(): void {
  try {
    if (!fs.existsSync(JOB_STORE_PATH)) return;
    const storedJobs = JSON.parse(fs.readFileSync(JOB_STORE_PATH, 'utf8')) as AsyncJob[];
    const now = Date.now();
    for (const storedJob of storedJobs) {
      if (!storedJob?.id || now - storedJob.createdAt > JOB_RETENTION_MS) continue;
      if (storedJob.status === 'processing') {
        storedJob.status = 'failed';
        storedJob.error = 'Processing was interrupted by an API restart. Please upload the file again.';
        storedJob.updatedAt = now;
      }
      jobs.set(storedJob.id, storedJob);
    }
    persistJobs();
  } catch (error) {
    console.error('[JobStore] Failed to load async jobs:', error);
  }
}

export function createJob(type: string, initialStatus: AsyncJob['status'] = 'processing'): string {
  const id = crypto.randomUUID();
  const now = Date.now();
  jobs.set(id, { id, type, status: initialStatus, createdAt: now, updatedAt: now });
  persistJobs();
  return id;
}

export function markJobProcessing(id: string): void {
  const job = jobs.get(id);
  if (!job) return;
  job.status = 'processing';
  job.error = undefined;
  job.updatedAt = Date.now();
  persistJobs();
}

export function completeJob(id: string, result: any): void {
  const job = jobs.get(id);
  if (!job) return;
  job.status = 'completed';
  job.result = result;
  job.error = undefined;
  job.updatedAt = Date.now();
  persistJobs();
}

export function failJob(id: string, error: string): void {
  const job = jobs.get(id);
  if (!job) return;
  job.status = 'failed';
  job.error = error;
  job.result = undefined;
  job.updatedAt = Date.now();
  persistJobs();
}

export function getJob(id: string): AsyncJob | undefined {
  return jobs.get(id);
}

export function cleanupOldJobs(maxAgeMs: number = JOB_RETENTION_MS): void {
  const now = Date.now();
  let changed = false;
  for (const [id, job] of jobs.entries()) {
    if (now - job.createdAt > maxAgeMs) {
      jobs.delete(id);
      changed = true;
    }
  }
  if (changed) persistJobs();
}

loadJobs();
const cleanupTimer = setInterval(() => cleanupOldJobs(), 60_000);
cleanupTimer.unref();
