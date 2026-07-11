import crypto from 'crypto';

export interface AsyncJob {
  id: string;
  type: string;
  status: 'processing' | 'completed' | 'failed';
  result?: any;
  error?: string;
  createdAt: number;
}

const jobs = new Map<string, AsyncJob>();

export function createJob(type: string): string {
  const id = crypto.randomUUID();
  jobs.set(id, { id, type, status: 'processing', createdAt: Date.now() });
  return id;
}

export function completeJob(id: string, result: any) {
  const job = jobs.get(id);
  if (job) {
    job.status = 'completed';
    job.result = result;
  }
}

export function failJob(id: string, error: string) {
  const job = jobs.get(id);
  if (job) {
    job.status = 'failed';
    job.error = error;
  }
}

export function getJob(id: string): AsyncJob | undefined {
  return jobs.get(id);
}

export function cleanupOldJobs(maxAgeMs: number = 600000) {
  const now = Date.now();
  for (const [id, job] of jobs.entries()) {
    if (now - job.createdAt > maxAgeMs) jobs.delete(id);
  }
}
