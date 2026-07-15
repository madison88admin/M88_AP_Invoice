import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import prisma from '../config/database';
import { logger } from '../utils/logger';

export interface FineTuneDatasetEntry {
  instruction: string;
  input: string;
  output: string;
}

export class OllamaFineTuneService {
  private static instance: OllamaFineTuneService;
  private isRunning: boolean = false;
  private lastStatus: string = 'idle';
  private lastError: string | null = null;
  private lastModelName: string | null = null;

  static getInstance(): OllamaFineTuneService {
    if (!OllamaFineTuneService.instance) {
      OllamaFineTuneService.instance = new OllamaFineTuneService();
    }
    return OllamaFineTuneService.instance;
  }

  private getDatasetDir(): string {
    return path.join(process.cwd(), 'finetune-data');
  }

  private ensureDatasetDir(): string {
    const dir = this.getDatasetDir();
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    return dir;
  }

  async buildDataset(minCorrections: number = 5): Promise<{ path: string; count: number }> {
    const corrections = await prisma.correctionLog.findMany({
      orderBy: { created_at: 'desc' },
    });

    if (corrections.length < minCorrections) {
      throw new Error(`Need at least ${minCorrections} corrections. Currently have ${corrections.length}.`);
    }

    const entries: FineTuneDatasetEntry[] = corrections.map((c: { raw_text: string | null; original_fields: any; corrected_fields: any }) => {
      const original = (c.original_fields as any) || {};
      const corrected = (c.corrected_fields as any) || {};
      return {
        instruction: 'Extract invoice data from the provided text and return valid JSON only.',
        input: c.raw_text || '',
        output: JSON.stringify(corrected),
      };
    });

    const dir = this.ensureDatasetDir();
    const datasetPath = path.join(dir, 'invoice_dataset.jsonl');
    const lines = entries.map((e) => JSON.stringify(e)).join('\n');
    fs.writeFileSync(datasetPath, lines, 'utf8');

    logger.info(`Fine-tune dataset exported: ${entries.length} entries to ${datasetPath}`);
    return { path: datasetPath, count: entries.length };
  }

  async startFineTune(options?: {
    baseModel?: string;
    minCorrections?: number;
    epochs?: number;
    batchSize?: number;
    learningRate?: number;
  }): Promise<{ jobId: string; datasetCount: number }> {
    if (this.isRunning) {
      throw new Error('Fine-tuning already in progress');
    }

    const baseModel = options?.baseModel || process.env.HF_BASE_MODEL || 'Qwen/Qwen2.5-1.5B-Instruct';
    const ollamaModel = process.env.OLLAMA_MODEL || 'qwen2.5vl:latest';
    const minCorrections = options?.minCorrections || 5;
    const epochs = options?.epochs || 3;
    const batchSize = options?.batchSize || 1;
    const learningRate = options?.learningRate || 2e-4;

    const { path: datasetPath, count } = await this.buildDataset(minCorrections);

    const jobId = `ft-${Date.now()}`;
    this.isRunning = true;
    this.lastStatus = 'running';
    this.lastError = null;
    this.lastModelName = `${ollamaModel}-invoice-ft`;

    const pythonScript = path.join(process.cwd(), 'src', 'python', 'ollama_finetune.py');
    const outputDir = path.join(this.getDatasetDir(), 'output', jobId);

    const args = [
      pythonScript,
      '--base-model', baseModel,
      '--ollama-model', ollamaModel,
      '--dataset', datasetPath,
      '--output-dir', outputDir,
      '--epochs', String(epochs),
      '--batch-size', String(batchSize),
      '--learning-rate', String(learningRate),
    ];

    const python = process.env.PYTHON_PATH || 'python3';
    logger.info(`Starting fine-tuning job ${jobId}: ${python} ${args.join(' ')}`);

    const child = spawn(python, args, {
      cwd: process.cwd(),
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    child.unref();

    const logFile = path.join(this.getDatasetDir(), `${jobId}.log`);
    const logStream = fs.createWriteStream(logFile, { flags: 'a' });
    child.stdout.pipe(logStream);
    child.stderr.pipe(logStream);

    child.on('error', (error) => {
      logger.error(`Fine-tune job ${jobId} failed to start:`, error);
      this.isRunning = false;
      this.lastStatus = 'failed';
      this.lastError = error.message;
    });

    child.on('exit', (code) => {
      this.isRunning = false;
      if (code === 0) {
        this.lastStatus = 'completed';
        logger.info(`Fine-tune job ${jobId} completed`);
      } else {
        this.lastStatus = 'failed';
        this.lastError = `Process exited with code ${code}`;
        logger.error(`Fine-tune job ${jobId} failed with code ${code}`);
      }
    });

    return { jobId, datasetCount: count };
  }

  getStatus(): {
    isRunning: boolean;
    status: string;
    lastError: string | null;
    lastModelName: string | null;
  } {
    return {
      isRunning: this.isRunning,
      status: this.lastStatus,
      lastError: this.lastError,
      lastModelName: this.lastModelName,
    };
  }
}

export const ollamaFineTuneService = OllamaFineTuneService.getInstance();
