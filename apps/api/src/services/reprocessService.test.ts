import { afterEach, describe, expect, it } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { findLocalSiblingPdf } from './reprocessService';

const cleanup: string[] = [];

afterEach(() => {
  for (const directory of cleanup.splice(0)) fs.rmSync(directory, { recursive: true, force: true });
});

describe('invoice PDF path recovery', () => {
  it('finds a PDF moved from processing to failed', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ap-pdf-recovery-'));
    cleanup.push(root);
    const processing = path.join(root, 'processing');
    const failed = path.join(root, 'failed');
    fs.mkdirSync(processing, { recursive: true });
    fs.mkdirSync(failed, { recursive: true });
    const stalePath = path.join(processing, '254616.pdf');
    const recoveredPath = path.join(failed, '254616.pdf');
    fs.writeFileSync(recoveredPath, '%PDF-1.7 test');

    expect(findLocalSiblingPdf(stalePath)).toBe(recoveredPath);
  });
});
