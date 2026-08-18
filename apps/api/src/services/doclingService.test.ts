import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  execFile: vi.fn(),
  spawnSync: vi.fn(),
}));

vi.mock('child_process', () => ({
  execFile: mocks.execFile,
  spawnSync: mocks.spawnSync,
}));

const SAVED: Record<string, string | undefined> = {};
for (const key of ['DOCLING_FALLBACK_ENABLED', 'DOCLING_PYTHON', 'DOCLING_SCRIPT', 'DOCLING_TIMEOUT_MS']) {
  SAVED[key] = process.env[key];
}

function setEnv(overrides: Record<string, string>) {
  for (const [key, value] of Object.entries(overrides)) process.env[key] = value;
}

function clearEnv() {
  for (const key of Object.keys(SAVED)) delete process.env[key];
}

async function loadService() {
  vi.resetModules();
  const mod = await import('./doclingService');
  return mod.doclingService;
}

beforeEach(() => {
  mocks.execFile.mockReset();
  mocks.spawnSync.mockReset();
});

afterEach(() => {
  vi.resetModules();
  clearEnv();
  for (const [key, value] of Object.entries(SAVED)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe('DoclingService', () => {
  it('is unavailable when the fallback is disabled', async () => {
    setEnv({ DOCLING_FALLBACK_ENABLED: 'false', DOCLING_PYTHON: 'fake-python', DOCLING_SCRIPT: '/fake/docling_extract.py' });
    const service = await loadService();
    expect(service.isAvailable()).toBe(false);
    await expect(service.extractMarkdown(Buffer.from('pdf'))).rejects.toThrow(/not available/);
  });

  it('is unavailable when python/docling probe fails', async () => {
    setEnv({ DOCLING_FALLBACK_ENABLED: 'true', DOCLING_PYTHON: 'fake-python', DOCLING_SCRIPT: '/fake/docling_extract.py' });
    mocks.spawnSync.mockReturnValue({ status: 1, stderr: Buffer.from('ModuleNotFoundError') });
    const service = await loadService();
    expect(service.isAvailable()).toBe(false);
  });

  it('extracts markdown via the python script and caches by content', async () => {
    setEnv({ DOCLING_FALLBACK_ENABLED: 'true', DOCLING_PYTHON: 'fake-python', DOCLING_SCRIPT: '/fake/docling_extract.py' });
    mocks.spawnSync.mockReturnValue({ status: 0, stderr: Buffer.alloc(0) });
    mocks.execFile.mockImplementation((_cmd, _args, _opts, cb) => cb(null, { stdout: '## Invoice\nInvoice No.: 1609160\nTotal USD 1,441.20\n', stderr: '' }));

    const service = await loadService();
    expect(service.isAvailable()).toBe(true);

    const buffer = Buffer.from('%PDF-1.4 fake invoice');
    const markdown = await service.extractMarkdown(buffer);
    expect(markdown).toContain('1609160');
    expect(mocks.execFile).toHaveBeenCalledTimes(1);
    expect(mocks.execFile.mock.calls[0][0]).toBe('fake-python');
    expect(mocks.execFile.mock.calls[0][1][0]).toBe('/fake/docling_extract.py');

    // Second call with the same buffer hits the cache — no new subprocess.
    await service.extractMarkdown(buffer);
    expect(mocks.execFile).toHaveBeenCalledTimes(1);
  });

  it('rejects when the python script fails', async () => {
    setEnv({ DOCLING_FALLBACK_ENABLED: 'true', DOCLING_PYTHON: 'fake-python', DOCLING_SCRIPT: '/fake/docling_extract.py' });
    mocks.spawnSync.mockReturnValue({ status: 0, stderr: Buffer.alloc(0) });
    mocks.execFile.mockImplementation((_cmd, _args, _opts, cb) => cb(new Error('docling crashed')));

    const service = await loadService();
    await expect(service.extractMarkdown(Buffer.from('pdf'))).rejects.toThrow(/Docling extraction failed/);
  });

  it('rejects when docling produces no usable markdown', async () => {
    setEnv({ DOCLING_FALLBACK_ENABLED: 'true', DOCLING_PYTHON: 'fake-python', DOCLING_SCRIPT: '/fake/docling_extract.py' });
    mocks.spawnSync.mockReturnValue({ status: 0, stderr: Buffer.alloc(0) });
    mocks.execFile.mockImplementation((_cmd, _args, _opts, cb) => cb(null, { stdout: '  \n', stderr: '' }));

    const service = await loadService();
    await expect(service.extractMarkdown(Buffer.from('pdf'))).rejects.toThrow(/no usable markdown/);
  });
});
