import { afterEach, describe, expect, it, vi } from 'vitest';

const SAVED: Record<string, string | undefined> = {};
for (const key of ['OPENROUTER_API_KEY', 'OPENROUTER_MODEL', 'OPENROUTER_TIMEOUT', 'OPENROUTER_MAX_IMAGE_PAGES', 'OPENROUTER_MAX_TEXT_LENGTH']) {
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
  const mod = await import('./openrouterOCRService');
  return mod.openrouterOCRService;
}

function mockFetchJson(content: string, ok = true, status = 200) {
  vi.stubGlobal('fetch', vi.fn(async () => ({
    ok,
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    json: async () => ({ choices: [{ message: { content } }] }),
    text: async () => content,
  })));
}

afterEach(() => {
  vi.unstubAllGlobals();
  clearEnv();
  for (const [key, value] of Object.entries(SAVED)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  vi.resetModules();
});

describe('OpenRouterOCRService', () => {
  it('is unavailable without an API key', async () => {
    clearEnv();
    const service = await loadService();
    expect(service.isAvailable()).toBe(false);
    const result = await service.extractFromText('some invoice text');
    expect(result).toBeNull();
  });

  it('extracts from text and returns engine metadata', async () => {
    setEnv({ OPENROUTER_API_KEY: 'sk-test' });
    mockFetchJson('{"invoice_number":"PCI-26031836","vendor_name":"PT. PAXAR INDONESIA","total_amount":54.82,"currency":"USD"}');
    const service = await loadService();
    const result = await service.extractFromText('PCI-26031836 text');
    expect(result).not.toBeNull();
    expect(result!.invoice_number).toBe('PCI-26031836');
    expect(result!.vendor_name).toBe('PT. PAXAR INDONESIA');
    expect(result!.engine_name).toBe('openrouter');
    expect(result!.extraction_method).toBe('openrouter-text');

    const fetchMock = vi.mocked(fetch);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, any];
    expect(url).toBe('https://openrouter.ai/api/v1/chat/completions');
    expect(init.headers.Authorization).toBe('Bearer sk-test');
    const body = JSON.parse(init.body);
    expect(body.model).toBe('qwen/qwen-2.5-vl-72b-instruct:free');
    expect(body.messages[1].content).toContain('PCI-26031836');
  });

  it('sends page images as vision content and respects the page cap', async () => {
    setEnv({ OPENROUTER_API_KEY: 'sk-test' });
    mockFetchJson('{"invoice_number":"INV-IMG","total_amount":12.5}');
    const service = await loadService();
    const pages = Array.from({ length: 8 }, (_, i) => `png-base64-page-${i + 1}`);
    const result = await service.extractFromImages(pages);
    expect(result!.invoice_number).toBe('INV-IMG');
    expect(result!.extraction_method).toBe('openrouter-vision');

    const fetchMock = vi.mocked(fetch);
    const [, init] = fetchMock.mock.calls[0] as [string, any];
    const body = JSON.parse(init.body);
    const content = body.messages[1].content as any[];
    expect(content[0].type).toBe('text');
    const images = content.slice(1);
    expect(images).toHaveLength(5); // default OPENROUTER_MAX_IMAGE_PAGES
    expect(images[0]).toMatchObject({ type: 'image_url' });
    expect(images[0].image_url.url).toContain('data:image/png;base64,');
  });

  it('recovers JSON wrapped in markdown fences', async () => {
    setEnv({ OPENROUTER_API_KEY: 'sk-test' });
    mockFetchJson('```json\n{"invoice_number":"INV-42","total_amount":99.99}\n```');
    const service = await loadService();
    const result = await service.extractFromText('text');
    expect(result!.invoice_number).toBe('INV-42');
    expect(result!.total_amount).toBe(99.99);
  });

  it('returns null on non-OK responses', async () => {
    setEnv({ OPENROUTER_API_KEY: 'sk-test' });
    mockFetchJson('rate limited', false, 429);
    const service = await loadService();
    expect(await service.extractFromText('text')).toBeNull();
  });

  it('returns null when the model returns no usable JSON', async () => {
    setEnv({ OPENROUTER_API_KEY: 'sk-test' });
    mockFetchJson('I cannot extract any data from this document.');
    const service = await loadService();
    expect(await service.extractFromText('text')).toBeNull();
  });
});
