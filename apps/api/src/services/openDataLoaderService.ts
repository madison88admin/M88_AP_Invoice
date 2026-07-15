import fs from 'fs';
import path from 'path';
import os from 'os';
import { logger } from '../utils/logger';

/**
 * Extract text from PDF using OpenDataLoader — ranked #1 in extraction benchmarks.
 * Requires Java 11+ on the system.
 * Falls back to pdf2json if Java or OpenDataLoader is not available.
 */
export async function extractTextWithOpenDataLoader(fileBuffer: Buffer): Promise<string> {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opendataloader-'));
  const inputPath = path.join(tmpDir, 'input.pdf');
  const outputPath = path.join(tmpDir, 'output');

  try {
    fs.writeFileSync(inputPath, fileBuffer);

    const { convert } = await import('@opendataloader/pdf');

    await convert(inputPath, {
      outputDir: outputPath,
      format: 'text',
      quiet: true,
      keepLineBreaks: true,
    });

    // Find the .txt output file
    const files = fs.readdirSync(outputPath);
    const txtFile = files.find(f => f.endsWith('.txt'));

    if (!txtFile) {
      throw new Error('OpenDataLoader did not produce a text output file');
    }

    const text = fs.readFileSync(path.join(outputPath, txtFile), 'utf8');
    return text;
  } finally {
    // Cleanup temp files
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {}
  }
}

/**
 * Extract structured JSON from PDF using OpenDataLoader.
 * Returns the parsed JSON content with text, tables, and metadata.
 */
export async function extractJsonWithOpenDataLoader(fileBuffer: Buffer): Promise<any> {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opendataloader-'));
  const inputPath = path.join(tmpDir, 'input.pdf');
  const outputPath = path.join(tmpDir, 'output');

  try {
    fs.writeFileSync(inputPath, fileBuffer);

    const { convert } = await import('@opendataloader/pdf');

    await convert(inputPath, {
      outputDir: outputPath,
      format: 'json,text',
      quiet: true,
      keepLineBreaks: true,
    });

    const files = fs.readdirSync(outputPath);
    const txtFile = files.find(f => f.endsWith('.txt'));
    const jsonFile = files.find(f => f.endsWith('.json'));

    const result: { text: string; json?: any } = {
      text: '',
    };

    if (txtFile) {
      result.text = fs.readFileSync(path.join(outputPath, txtFile), 'utf8');
    }

    if (jsonFile) {
      try {
        result.json = JSON.parse(fs.readFileSync(path.join(outputPath, jsonFile), 'utf8'));
      } catch {}
    }

    if (!result.text) {
      throw new Error('OpenDataLoader did not produce output');
    }

    return result;
  } finally {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {}
  }
}

/**
 * Check if OpenDataLoader is available (Java installed + package installed).
 */
export async function isOpenDataLoaderAvailable(): Promise<boolean> {
  try {
    const { execSync } = await import('child_process');
    execSync('java -version', { stdio: 'ignore', timeout: 5000 });
    await import('@opendataloader/pdf');
    return true;
  } catch {
    return false;
  }
}
