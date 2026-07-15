import { logger } from '../utils/logger';

// Timeout helper for fetch calls — prevents indefinite hangs
const FETCH_TIMEOUT_MS = 30000; // 30 seconds
function fetchWithTimeout(url: string, options: RequestInit = {}): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  return fetch(url, { ...options, signal: controller.signal })
    .finally(() => clearTimeout(timeoutId));
}

// ─── MPO Header Cache ──────────────────────────────────────────────────────
// Caches all MPO headers to avoid re-fetching 15,000+ records for every invoice
// TTL: 10 minutes (MPOs don't change frequently during processing)
const MPO_CACHE_TTL_MS = 10 * 60 * 1000;
let mpoHeaderCache: any[] | null = null;
let mpoCacheTimestamp = 0;
let mpoCacheFetchPromise: Promise<any[]> | null = null;
let entityBrowserListBroken = false; // Skip GetEntityBrowserList after first 500 error

// ─── NextGen API Types ──────────────────────────────────────────────────────
// Based on actual endpoints at https://nextgen.madison88.com

export interface NextGenPOData {
  po_number: string;
  mpo_number: string;
  vendor_id: string;
  vendor_name: string;
  amount: number;
  currency: string;
  order_date: Date;
  brand: string;
  season: string;
  order_type: string;
  status: string;
  line_items: Array<{
    item_code: string;
    description: string;
    quantity: number;
    unit_price: number;
    total_amount: number;
  }>;
}

/** Kendo DataSourceRequest body used by NextGen grid endpoints */
interface KendoGridRequest {
  page?: number;
  pageSize?: number;
  sort?: Array<{ field: string; dir: 'asc' | 'desc' }>;
  filter?: any;
}

function defaultGridRequest(overrides?: Partial<KendoGridRequest>): KendoGridRequest {
  return {
    page: 1,
    pageSize: 50,
    sort: [{ field: 'OrderDate', dir: 'desc' }],
    ...overrides,
  };
}

export interface POComparisonResult {
  po_found: boolean;
  is_match: boolean;
  nextgen_data?: NextGenPOData;
  comparison: {
    amount_match: boolean;
    vendor_match: boolean;
    brand_match: boolean;
    season_match: boolean;
    order_type_match: boolean;
    differences: string[];
  };
}

/**
 * NextGen API integration for Madison 88 — READ-ONLY
 * Base host: https://nextgen.madison88.com
 *
 * IMPORTANT: This service ONLY fetches data from NextGen. It must NEVER create,
 * update, or delete any records in the NextGen system. All endpoints used are
 * read/query operations (Kendo grid Read endpoints and GET endpoints).
 *
 * Purchase Orders:    POST /PurchaseOrder/Read, /PurchaseOrder/OrderGridRead, GET /PurchaseOrder/Lines
 * Material POs (MPO): POST /MaterialPurchaseOrder/MPOGridRead, /MaterialPurchaseOrder/MPOLIGridRead
 * Sample POs:         POST /SamplePurchaseOrder/Read, /SamplePurchaseOrder/OrderGridRead, GET /SamplePurchaseOrder/Lines
 */
export class NextGenService {
  private static instance: NextGenService;
  private baseUrl: string;
  private username: string;
  private password: string;
  private useMock: boolean;
  private sessionCookie: string | null = null;
  private cookieObtainedAt: number = 0;
  private static readonly COOKIE_MAX_AGE = 4 * 60 * 60 * 1000; // 4 hours

  private constructor() {
    this.baseUrl = process.env.NEXTGEN_API_URL || 'https://nextgen.madison88.com';
    this.username = process.env.NEXTGEN_USERNAME || '';
    this.password = process.env.NEXTGEN_PASSWORD || '';
    this.useMock = !this.username || !this.password;
  }

  static getInstance(): NextGenService {
    if (!NextGenService.instance) {
      NextGenService.instance = new NextGenService();
    }
    return NextGenService.instance;
  }

  // ─── Cookie-based Session Auth (ASP.NET Forms Authentication) ────────────

  /** Login to NextGen via ASP.NET Forms Auth and store session cookies */
  private async login(): Promise<boolean> {
    try {
      // Helper: extract cookies from a Response object (with fallback for older Node.js)
      const extractCookies = (res: Response): string[] => {
        // Preferred: getSetCookie() (Node.js v20+)
        if (typeof res.headers.getSetCookie === 'function') {
          return res.headers.getSetCookie() || [];
        }
        // Fallback: parse raw 'set-cookie' header (splits on comma, but careful with expires dates)
        const raw = res.headers.get('set-cookie');
        if (!raw) return [];
        // Split on comma followed by a known cookie attribute pattern
        return raw.split(/,(?=[^;]+=[^;]+)/g).map(c => c.trim());
      };

      // Step 1: GET /Account/Login to get anti-forgery token + cookie
      const getPage = await fetchWithTimeout(`${this.baseUrl}/Account/Login`);
      const html = await getPage.text();
      const pageCookies = extractCookies(getPage);

      // Extract __RequestVerificationToken from HTML
      const tokenRegex = /name="__RequestVerificationToken"[^>]*value="([^"]+)"/;
      const tokenRegex2 = /__RequestVerificationToken[\s\S]*?value="([^"]+)"/;
      let tokenMatch = html.match(tokenRegex);
      if (!tokenMatch) tokenMatch = html.match(tokenRegex2);

      if (!tokenMatch) {
        logger.error('NextGen login page: could not find __RequestVerificationToken');
        return false;
      }

      const antiForgeryToken = tokenMatch[1];
      const antiForgeryCookie = pageCookies.map((c: string) => c.split(';')[0]).join('; ');

      // Step 2: POST /Account/Login with credentials + anti-forgery token
      const loginBody = new URLSearchParams({
        '__RequestVerificationToken': antiForgeryToken,
        'Username': this.username,
        'Password': this.password,
      });

      const loginRes = await fetchWithTimeout(`${this.baseUrl}/Account/Login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Cookie': antiForgeryCookie,
        },
        body: loginBody.toString(),
        redirect: 'manual',
      });

      const loginCookies = extractCookies(loginRes);

      // Combine anti-forgery + auth cookies (both needed for API calls)
      const allCookies = [
        ...pageCookies.map((c: string) => c.split(';')[0]),
        ...loginCookies.map((c: string) => c.split(';')[0]),
      ].join('; ');

      if (loginRes.status === 302 && loginCookies.length > 0) {
        this.sessionCookie = allCookies;
        this.cookieObtainedAt = Date.now();
        logger.info(`NextGen login successful. Cookies: ${loginCookies.map((c: string) => c.split('=')[0]).join(', ')}`);
        return true;
      }

      logger.error(`NextGen login failed: status ${loginRes.status}, cookies: ${loginCookies.length}`);
      return false;
    } catch (error) {
      logger.error('NextGen login error:', error);
      return false;
    }
  }

  // ─── HTTP Helpers (READ-ONLY — no PUT, PATCH, DELETE allowed) ─────────────

  /** Allowed NextGen read-only paths (POST for Kendo grids, GET for direct reads) */
  private static readonly READ_PATHS = [
    '/Account/Login',
    '/PurchaseOrder/OrderGridRead',
    '/PurchaseOrder/Read',
    '/PurchaseOrder/GetEntityBrowserList',
    '/MaterialPurchaseOrder/MPOGridRead',
    '/MaterialPurchaseOrder/MPOLIGridRead',
    '/MaterialPurchaseOrder/GetEntityBrowserList',
    '/MaterialPurchaseOrder/FormLinesGridRead',
    '/MaterialPurchaseOrder/GetPOTotals',
    '/MaterialPurchaseOrder/GetById',
    '/MaterialPurchaseOrder/Edit',
    '/MaterialPurchaseOrder/FormPage',
    '/MaterialPurchaseOrder/GetHeader',
    '/MaterialPurchaseOrder/GetOrder',
    '/MaterialPurchaseOrder/Details',
    '/MaterialPurchaseOrder/FormHeaderRead',
    '/MaterialPurchaseOrder/GetFormData',
    '/MaterialPurchaseOrder/GetEntity',
    '/MaterialPurchaseOrder/GetEditorValues',
    '/MaterialPurchaseOrder/GetFormValues',
    '/MaterialPurchaseOrder/HeaderGridRead',
    '/SamplePurchaseOrder/OrderGridRead',
    '/ViewCache/MaterialManagerMaterialGrid',
    '/ViewCache/MaterialManagerMaterialLines',
  ];

  private assertReadOnly(path: string): void {
    const isAllowed = NextGenService.READ_PATHS.some(p => path.startsWith(p));
    if (!isAllowed) {
      throw new Error(
        `NextGen service is READ-ONLY. Path "${path}" is not in the allowed list. ` +
        `This service must NEVER write to NextGen.`
      );
    }
  }

  /** POST to Kendo grid Read endpoints (read-only despite using POST method) */
  private async post<T>(path: string, body: any): Promise<T | null> {
    this.assertReadOnly(path);

    if (this.useMock) {
      logger.warn(`NextGen credentials not configured. Using mock for ${path}`);
      return null;
    }

    // Ensure we have a valid session
    if (!this.sessionCookie || Date.now() - this.cookieObtainedAt > NextGenService.COOKIE_MAX_AGE) {
      const loggedIn = await this.login();
      if (!loggedIn) {
        logger.error(`NextGen login failed, cannot fetch ${path}`);
        return null;
      }
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    // Set auth — cookie or Authorization header
    if (this.sessionCookie!.startsWith('Bearer ') || this.sessionCookie!.startsWith('Basic ')) {
      headers['Authorization'] = this.sessionCookie!;
    } else {
      headers['Cookie'] = this.sessionCookie!;
    }

    const response = await fetchWithTimeout(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });

    // If 401/403, session expired — re-login and retry once
    if (response.status === 401 || response.status === 403) {
      logger.warn(`NextGen session expired for ${path} (status ${response.status}), re-logging in...`);
      const loggedIn = await this.login();
      if (!loggedIn) return null;

      if (this.sessionCookie!.startsWith('Bearer ') || this.sessionCookie!.startsWith('Basic ')) {
        headers['Authorization'] = this.sessionCookie!;
        delete headers['Cookie'];
      } else {
        headers['Cookie'] = this.sessionCookie!;
      }

      const retryResponse = await fetchWithTimeout(`${this.baseUrl}${path}`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      });

      if (!retryResponse.ok) {
        logger.error(`NextGen ${path} returned ${retryResponse.status} after re-login`);
        return null;
      }

      const retryText = await retryResponse.text();
      if (retryText.includes('Log In - VisionPLM') || retryText.includes('<!doctype html>')) {
        logger.error(`NextGen ${path} still returning login page after re-login`);
        return null;
      }
      try { return JSON.parse(retryText) as T; } catch { return null; }
    }

    if (!response.ok) {
      logger.error(`NextGen ${path} returned ${response.status}: ${response.statusText}`);
      return null;
    }

    // Detect login page redirect (200 with HTML instead of JSON)
    const responseText = await response.text();
    if (responseText.includes('Log In - VisionPLM') || responseText.includes('<!doctype html>')) {
      logger.warn(`NextGen ${path} returned login page (session invalid), re-logging in...`);
      const loggedIn = await this.login();
      if (!loggedIn) return null;

      if (this.sessionCookie!.startsWith('Bearer ') || this.sessionCookie!.startsWith('Basic ')) {
        headers['Authorization'] = this.sessionCookie!;
        delete headers['Cookie'];
      } else {
        headers['Cookie'] = this.sessionCookie!;
      }

      const retryResponse = await fetchWithTimeout(`${this.baseUrl}${path}`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      });

      if (!retryResponse.ok) {
        logger.error(`NextGen ${path} returned ${retryResponse.status} after re-login (HTML retry)`);
        return null;
      }

      const retryText = await retryResponse.text();
      if (retryText.includes('Log In - VisionPLM') || retryText.includes('<!doctype html>')) {
        logger.error(`NextGen ${path} still returning login page after re-login`);
        return null;
      }
      try { return JSON.parse(retryText) as T; } catch { return null; }
    }

    try { return JSON.parse(responseText) as T; } catch { return null; }
  }

  /** GET from NextGen direct read endpoints */
  private async get<T>(path: string): Promise<T | null> {
    this.assertReadOnly(path);

    if (this.useMock) {
      logger.warn(`NextGen credentials not configured. Using mock for ${path}`);
      return null;
    }

    // Ensure we have a valid session
    if (!this.sessionCookie || Date.now() - this.cookieObtainedAt > NextGenService.COOKIE_MAX_AGE) {
      const loggedIn = await this.login();
      if (!loggedIn) {
        logger.error(`NextGen login failed, cannot fetch ${path}`);
        return null;
      }
    }

    const headers: Record<string, string> = {};

    if (this.sessionCookie!.startsWith('Bearer ') || this.sessionCookie!.startsWith('Basic ')) {
      headers['Authorization'] = this.sessionCookie!;
    } else {
      headers['Cookie'] = this.sessionCookie!;
    }

    const response = await fetchWithTimeout(`${this.baseUrl}${path}`, {
      method: 'GET',
      headers,
    });

    // If 401/403, session expired — re-login and retry once
    if (response.status === 401 || response.status === 403) {
      logger.warn(`NextGen session expired for ${path}, re-logging in...`);
      const loggedIn = await this.login();
      if (!loggedIn) return null;

      if (this.sessionCookie!.startsWith('Bearer ') || this.sessionCookie!.startsWith('Basic ')) {
        headers['Authorization'] = this.sessionCookie!;
        delete headers['Cookie'];
      } else {
        headers['Cookie'] = this.sessionCookie!;
      }

      const retryResponse = await fetchWithTimeout(`${this.baseUrl}${path}`, {
        method: 'GET',
        headers,
      });

      if (!retryResponse.ok) {
        logger.error(`NextGen ${path} returned ${retryResponse.status} after re-login`);
        return null;
      }

      const retryText = await retryResponse.text();
      if (retryText.includes('Log In - VisionPLM') || retryText.includes('<!doctype html>')) {
        logger.error(`NextGen ${path} still returning login page after re-login`);
        return null;
      }
      try { return JSON.parse(retryText) as T; } catch { return null; }
    }

    if (!response.ok) {
      logger.error(`NextGen ${path} returned ${response.status}: ${response.statusText}`);
      return null;
    }

    // Detect login page redirect (200 with HTML instead of JSON)
    const responseText = await response.text();
    if (responseText.includes('Log In - VisionPLM') || responseText.includes('<!doctype html>')) {
      logger.warn(`NextGen ${path} returned login page (session invalid), re-logging in...`);
      const loggedIn = await this.login();
      if (!loggedIn) return null;

      if (this.sessionCookie!.startsWith('Bearer ') || this.sessionCookie!.startsWith('Basic ')) {
        headers['Authorization'] = this.sessionCookie!;
        delete headers['Cookie'];
      } else {
        headers['Cookie'] = this.sessionCookie!;
      }

      const retryResponse = await fetchWithTimeout(`${this.baseUrl}${path}`, {
        method: 'GET',
        headers,
      });

      if (!retryResponse.ok) {
        logger.error(`NextGen ${path} returned ${retryResponse.status} after re-login (HTML retry)`);
        return null;
      }

      const retryText = await retryResponse.text();
      if (retryText.includes('Log In - VisionPLM') || retryText.includes('<!doctype html>')) {
        logger.error(`NextGen ${path} still returning login page after re-login`);
        return null;
      }
      try { return JSON.parse(retryText) as T; } catch { return null; }
    }

    try { return JSON.parse(responseText) as T; } catch { return null; }
  }

  /** POST form-encoded data to NextGen endpoints */
  private async postForm<T>(path: string, body: URLSearchParams): Promise<T | null> {
    this.assertReadOnly(path);
    if (this.useMock) return null;

    if (!this.sessionCookie || Date.now() - this.cookieObtainedAt > NextGenService.COOKIE_MAX_AGE) {
      const loggedIn = await this.login();
      if (!loggedIn) return null;
    }

    const response = await fetchWithTimeout(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Cookie': this.sessionCookie!,
      },
      body: body.toString(),
    });

    if (response.status === 401 || response.status === 403) {
      const loggedIn = await this.login();
      if (!loggedIn) return null;
      const retry = await fetchWithTimeout(`${this.baseUrl}${path}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Cookie': this.sessionCookie!,
        },
        body: body.toString(),
      });
      if (!retry.ok) return null;
      const retryText = await retry.text();
      if (retryText.includes('Log In - VisionPLM') || retryText.includes('<!doctype html>')) return null;
      try { return JSON.parse(retryText) as T; } catch { return null; }
    }

    if (!response.ok) {
      logger.error(`NextGen postForm ${path} returned ${response.status}`);
      return null;
    }

    const responseText = await response.text();
    if (responseText.includes('Log In - VisionPLM') || responseText.includes('<!doctype html>')) {
      logger.warn(`NextGen postForm ${path} returned login page, re-logging in...`);
      const loggedIn = await this.login();
      if (!loggedIn) return null;
      const retry = await fetchWithTimeout(`${this.baseUrl}${path}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Cookie': this.sessionCookie!,
        },
        body: body.toString(),
      });
      if (!retry.ok) return null;
      const retryText = await retry.text();
      if (retryText.includes('Log In - VisionPLM') || retryText.includes('<!doctype html>')) return null;
      try { return JSON.parse(retryText) as T; } catch { return null; }
    }

    try { return JSON.parse(responseText) as T; } catch { return null; }
  }

  // ─── PO Mapping ─────────────────────────────────────────────────────────────
  // Maps NextGen response fields to our internal NextGenPOData shape.
  // Adjust field names once you confirm the actual NextGen response structure.

  /**
   * Parse raw order_type string into clean enum value
   * NextGen returns labels like "SMS PO Header", "BULK PO Header", etc.
   * This extracts the core order type token.
   */
  private parseOrderType(rawOrderType: string): string {
    if (!rawOrderType) return '';

    const normalized = rawOrderType.toUpperCase();

    if (normalized.includes('SMS')) return 'SMS';
    if (normalized.includes('SAMPLE')) return 'SAMPLE';
    if (normalized.includes('BULK')) return 'BULK';

    // If none of the known tokens match, keep the raw string
    // visible for debugging rather than silently returning empty
    return rawOrderType;
  }

  private mapToPOData(raw: any): NextGenPOData {
    return {
      po_number: raw.Name || raw.PONumber || raw.po_number || '',
      mpo_number: raw.MPONumber || raw.mpo_number || '',
      vendor_id: raw.SupplierId || raw.VendorID || raw.vendor_id || '',
      vendor_name: raw.SupplierName || raw.VendorName || raw.vendor_name || '',
      amount: Number(raw.TotalValue || raw.TotalCost || raw.TotalAmount || raw.amount || 0),
      currency: raw.CurrencyName || raw.Currency || raw.currency || 'USD',
      order_date: raw.KeyDate ? new Date(raw.KeyDate) : (raw.CreatedDateTime ? new Date(raw.CreatedDateTime) : new Date()),
      brand: raw.CustomerName || raw.Brand || raw.brand || '',
      season: raw.RangeName || raw.Season || raw.season || '',
      order_type: this.parseOrderType(raw.TemplateName || raw.OrderType || raw.order_type || ''),
      status: raw.StatusName || raw.Status || raw.status || '',
      line_items: (raw.Lines || raw.line_items || []).map((li: any) => ({
        item_code: li.CommodityName || li.ItemCode || li.item_code || '',
        description: li.CommodityDescription || li.Description || li.description || '',
        quantity: Number(li.Quantity || li.TotalQuantity || li.quantity || 0),
        unit_price: Number(li.PurchasePrice || li.UnitPrice || li.unit_price || 0),
        total_amount: Number(li.TotalAmount || li.total_amount || (Number(li.Quantity || 0) * Number(li.PurchasePrice || 0))),
      })),
    };
  }

  // ─── Public Methods ─────────────────────────────────────────────────────────

  /**
   * Fetch full PO data (header + lines) by PO number
   * This merges the header endpoint and lines endpoint into one combined object
   */
  async getFullPO(poNumber: string): Promise<NextGenPOData | null> {
    try {
      const header = await this.fetchPOByNumber(poNumber);
      if (!header) return null;

      // In mock mode, header already includes line_items - don't overwrite
      if (this.useMock) {
        return header;
      }

      // Use po_number as the ID for lines fetch since NextGen uses the PO number
      const lines = await this.fetchPOLines(header.po_number);

      return {
        ...header,
        line_items: lines ?? [],
      };
    } catch (error) {
      logger.error(`Error fetching full PO ${poNumber} from NextGen:`, error);
      return null;
    }
  }

  /**
   * Fetch full PO data (header + lines) by MPO number
   * This merges the header endpoint and lines endpoint into one combined object
   */
  async getFullPOByMPO(
    mpoNumber: string,
    hint?: { vendor_name?: string; amount?: number }
  ): Promise<NextGenPOData | null> {
    try {
      const header = await this.fetchPOByMPO(mpoNumber, hint);
      if (!header) return null;

      // In mock mode, header already includes line_items - don't overwrite
      if (this.useMock) {
        return header;
      }

      // Use mpo_number as the ID for lines fetch
      const lines = await this.fetchMPOLines(header.mpo_number);

      return {
        ...header,
        line_items: lines ?? [],
      };
    } catch (error) {
      logger.error(`Error fetching full PO by MPO ${mpoNumber} from NextGen:`, error);
      return null;
    }
  }

  /**
   * Fetch PO data by PO number
   * Endpoint: GET /PurchaseOrder/GetById (for exact match by numeric ID)
   * Falls back to POST /PurchaseOrder/OrderGridRead (Kendo grid with filter) if GetById fails
   */
  async fetchPOByNumber(poNumber: string): Promise<NextGenPOData | null> {
    try {
      if (this.useMock) return this.getMockPOData(poNumber);

      // Try GetById first if poNumber is numeric
      const numericId = parseInt(poNumber);
      if (!isNaN(numericId)) {
        try {
          const result = await this.get<any>(`/PurchaseOrder/GetById?id=${numericId}`);
          if (result) {
            return this.mapToPOData(result);
          }
        } catch (error) {
          logger.warn(`GetById failed for ${poNumber}, falling back to grid search`);
        }
      }

      // Fallback to grid search with contains (more reliable than eq)
      const result = await this.post<any>('/PurchaseOrder/OrderGridRead', {
        ...defaultGridRequest(),
        filter: { field: 'Name', operator: 'contains', value: poNumber },
      });

      const items = result?.Data || result?.data || result;
      if (!Array.isArray(items) || items.length === 0) return null;

      // Try to find exact match first
      const exactMatch = items.find((item: any) => 
        (item.Name || item.PONumber || item.po_number) === poNumber
      );
      if (exactMatch) return this.mapToPOData(exactMatch);

      // If no exact match, return null instead of first result
      return null;
    } catch (error) {
      logger.error(`Error fetching PO ${poNumber} from NextGen:`, error);
      return null;
    }
  }

  /**
   * Step 1: Find numeric OrderId from MPO number string
   * e.g. "MPO15371" → 73
   */
  private async getMPOOrderId(mpoNumber: string): Promise<number | null> {
    // Skip if EntityBrowserList is known to be broken (returns 500)
    if (entityBrowserListBroken) {
      logger.info(`MPO ${mpoNumber}: Skipping EntityBrowserList (known broken)`);
      return null;
    }
    try {
      const result = await this.get<any>(
        `/MaterialPurchaseOrder/GetEntityBrowserList` 
      );
      const items = result?.Data || result?.data || result || [];
      if (!Array.isArray(items)) return null;

      const match = items.find((i: any) =>
        i.Name === mpoNumber ||
        i.MPONumber === mpoNumber ||
        (i.Name || '').includes(mpoNumber)
      );

      const orderId = match?.Id || match?.OrderId || match?.id || null;
      if (!orderId) {
        logger.warn(`MPO ${mpoNumber} not found in EntityBrowserList`);
        return null;
      }

      logger.info(`MPO ${mpoNumber} resolved to OrderId ${orderId}`);
      return Number(orderId);
    } catch (error: any) {
      if (error?.message?.includes('500') || error?.status === 500) {
        entityBrowserListBroken = true;
        logger.warn(`MPO ${mpoNumber}: EntityBrowserList returned 500 — will skip on future calls`);
      }
      logger.error(`Error resolving MPO ${mpoNumber} to OrderId:`, error);
      return null;
    }
  }

  /**
   * Step 2: Get MPO totals by numeric OrderId
   * Endpoint: POST /MaterialPurchaseOrder/GetPOTotals (form-encoded)
   */
  private async getMPOTotals(orderId: number): Promise<{ amount: number; quantity: number } | null> {
    try {
      const body = new URLSearchParams({ id: String(orderId) });
      const result = await this.postForm<any>(
        '/MaterialPurchaseOrder/GetPOTotals', body
      );
      if (!result) return null;

      return {
        amount: Number(result.TotalValue || result.TotalCost || 0),
        quantity: Number(result.TotalQuantity || 0),
      };
    } catch (error) {
      logger.error(`Error fetching MPO totals for OrderId ${orderId}:`, error);
      return null;
    }
  }

  /**
   * Fetch MPO headers — smart targeted fetch.
   * Sorted by Name desc. Extracts numeric suffix from mpoNumber to estimate
   * which page to start from (avoids fetching all 15,000+ records).
   * Falls back to scanning all pages if estimation fails.
   */
  private async fetchAllMPOHeaders(mpoNumber?: string): Promise<any[]> {
    const PAGE_SIZE = 500;

    // ── Check cache first ──
    const now = Date.now();
    if (mpoHeaderCache && (now - mpoCacheTimestamp) < MPO_CACHE_TTL_MS) {
      logger.info(`MPO cache hit: ${mpoHeaderCache.length} headers cached (age: ${Math.round((now - mpoCacheTimestamp) / 1000)}s)`);
      return mpoHeaderCache;
    }

    // If a fetch is already in progress, wait for it instead of starting another
    if (mpoCacheFetchPromise) {
      logger.info('MPO cache: waiting for in-progress fetch');
      return mpoCacheFetchPromise;
    }

    // Start a fresh fetch (with cache wrapper)
    mpoCacheFetchPromise = this._fetchAllMPOHeadersUncached(mpoNumber).then(headers => {
      mpoHeaderCache = headers;
      mpoCacheTimestamp = Date.now();
      mpoCacheFetchPromise = null;
      logger.info(`MPO cache: populated with ${headers.length} headers`);
      return headers;
    }).catch(err => {
      mpoCacheFetchPromise = null;
      throw err;
    });

    return mpoCacheFetchPromise;
  }

  private async _fetchAllMPOHeadersUncached(mpoNumber?: string): Promise<any[]> {
    const PAGE_SIZE = 500;

    // If we have a specific MPO number, try a direct filtered search first
    // Note: NextGen's MPOGridRead ignores Kendo filters server-side, so this may not work
    // but it's worth trying as it would be much faster than pagination
    if (mpoNumber) {
      const normalizedMPO = mpoNumber.replace(/^MPO/i, '').replace(/^0+/, '');
      const mpoWithPrefix = `MPO${normalizedMPO.padStart(6, '0')}`;
      const mpoWithPrefixShort = `MPO${normalizedMPO}`;

      // Try: Kendo grid filter search (may work on some NextGen versions)
      const filterFormats = [mpoNumber, mpoWithPrefix, mpoWithPrefixShort, normalizedMPO];
      for (const fmt of filterFormats) {
        try {
          const filtered = await this.post<any>('/MaterialPurchaseOrder/MPOGridRead', {
            page: 1,
            pageSize: 50,
            sort: [{ field: 'Name', dir: 'desc' }],
            filter: {
              logic: 'or',
              filters: [
                { field: 'Name', operator: 'eq', value: fmt },
                { field: 'Name', operator: 'contains', value: fmt },
                { field: 'Comments', operator: 'contains', value: fmt },
                { field: 'Description', operator: 'contains', value: fmt },
                { field: 'SupplierDescription', operator: 'contains', value: fmt },
              ],
            },
          });
          // Verify the filter actually worked (server may ignore filters)
          const filteredItems: any[] = filtered?.Data || filtered?.data || [];
          if (filteredItems.length > 0 && filteredItems.length < 500) {
            // Check if results actually match (filter wasn't ignored)
            const hasMatch = filteredItems.some((i: any) =>
              i.Name === mpoNumber || i.Name === mpoWithPrefix ||
              i.Name === mpoWithPrefixShort || i.Name?.includes(normalizedMPO)
            );
            if (hasMatch) {
              logger.info(`MPO ${mpoNumber}: Filter search found ${filteredItems.length} results using "${fmt}"`);
              return filteredItems;
            }
          }
        } catch (e) {
          // Fall through to pagination
        }
      }

      logger.info(`MPO ${mpoNumber}: Filter search ineffective, using pagination`);
    }

    // Page 1 to get total count
    const first = await this.post<any>('/MaterialPurchaseOrder/MPOGridRead', {
      page: 1,
      pageSize: PAGE_SIZE,
      sort: [{ field: 'Name', dir: 'desc' }],
      filter: null,
    });
    const total: number = first?.Total || first?.total || 0;
    const firstItems: any[] = first?.Data || first?.data || [];
    if (firstItems.length === 0) return [];

    // If target is on page 1 or no mpoNumber given, return all pages
    if (!mpoNumber || total <= PAGE_SIZE) {
      const all = [...firstItems];
      let page = 2;
      while (all.length < total) {
        const r = await this.post<any>('/MaterialPurchaseOrder/MPOGridRead', {
          page,
          pageSize: PAGE_SIZE,
          sort: [{ field: 'Name', dir: 'desc' }],
          filter: null,
        });
        const items: any[] = r?.Data || r?.data || [];
        if (!items.length) break;
        all.push(...items);
        page++;
      }
      return all;
    }

    // Server ignores sort direction — MPOs appear in natural DB insertion order.
    // Use total count to estimate which page the target MPO is on.
    // Extract numeric suffix (e.g. "MPO015713" → 15713)
    const numMatch = mpoNumber.match(/(\d+)$/);
    const mpoNum = numMatch ? parseInt(numMatch[1]) : null;

    // total = 15337 records. If mpoNum = 15713, it's near the end.
    // Estimated position from start ≈ mpoNum (since MPOs are created sequentially).
    // Clamp to valid page range.
    const totalPages = Math.ceil(total / PAGE_SIZE);
    let startPage = 1;
    if (mpoNum !== null && total > 0) {
      const estimatedPos = Math.min(mpoNum, total);
      startPage = Math.max(1, Math.ceil(estimatedPos / PAGE_SIZE) - 1);
    }

    logger.info(`MPO pagination: total=${total}, totalPages=${totalPages}, mpoNum=${mpoNum}, startPage=${startPage}, firstItem=${firstItems[0]?.Name}`);

    // Fetch more pages around estimated position for safety (expand to 15 pages)
    const pages = new Set<number>();
    for (let p = Math.max(1, startPage - 5); p <= Math.min(totalPages, startPage + 10); p++) pages.add(p);

    const results: any[] = [];
    for (const p of pages) {
      if (p === 1 && pages.has(1)) {
        results.push(...firstItems);
        continue;
      }
      const r = await this.post<any>('/MaterialPurchaseOrder/MPOGridRead', {
        page: p,
        pageSize: PAGE_SIZE,
      });
      results.push(...(r?.Data || r?.data || []));
    }

    // If target not found in targeted pages, search all pages
    // Use flexible matching formats
    const normalizedMPO = mpoNumber.replace(/^MPO/i, '').replace(/^0+/, '');
    const mpoWithPrefix = `MPO${normalizedMPO.padStart(6, '0')}`; // 6-digit padding
    const mpoWithPrefixShort = `MPO${normalizedMPO}`;

    const found = results.find((i: any) =>
      i.Name === mpoNumber ||
      i.Name === mpoWithPrefix ||
      i.Name === mpoWithPrefixShort ||
      i.Name === normalizedMPO ||
      i.Name?.includes(mpoNumber)
    );

    if (mpoNumber && !found) {
      logger.warn(`MPO ${mpoNumber} not found in targeted pages, searching all pages`);
      const allResults = [...firstItems];
      let page = 2;
      while (allResults.length < total) {
        const r = await this.post<any>('/MaterialPurchaseOrder/MPOGridRead', {
          page,
          pageSize: PAGE_SIZE,
        });
        const pageData = r?.Data || r?.data || [];
        allResults.push(...pageData);
        if (pageData.length === 0) break;
        page++;
      }
      return allResults;
    }

    return results;
  }

  /**
   * Build a NextGenPOData from an MPO header record + its line items
   */
  private async buildMPOData(match: any, mpoNumber: string): Promise<NextGenPOData> {
    const orderId = match.Id;
    logger.info(`MPO ${mpoNumber} resolved to OrderId ${orderId} (Name: ${match.Name})`);
    const lines = await this.fetchMPOLines(orderId);
    const calculatedTotal = lines.reduce((sum, li) => sum + (li.total_amount || 0), 0);
    return {
      po_number: match.Name || mpoNumber,
      mpo_number: match.Name || mpoNumber,
      vendor_id: String(match.SupplierId || ''),
      vendor_name: match.SupplierName || '',
      amount: Number(match.TotalCost || match.TotalValue || calculatedTotal || 0),
      currency: match.SupplierCurrencyName || match.CurrencyName || 'USD',
      order_date: match.KeyDate ? new Date(match.KeyDate) : new Date(),
      brand: match.CustomerName || '',
      season: match.RangeName || match.Season || '',
      order_type: this.parseOrderType(match.TemplateName || ''),
      status: match.StatusName || '',
      line_items: lines,
    };
  }

  /**
   * Fetch MPO by MPO number — 3-tier resolution strategy:
   * Tier 1: Exact Name match (MPO000XXX → NextGen native name)
   * Tier 2: Header reference fields (Comments, Description, SupplierDescription)
   * Tier 3: Supplier + amount fuzzy match (scored)
   */
  async fetchPOByMPO(
    mpoNumber: string,
    hint?: { vendor_name?: string; amount?: number; material_code?: string }
  ): Promise<NextGenPOData | null> {
    try {
      if (this.useMock) return this.getMockPOData(mpoNumber);

      // ── Fast path: Try GetEntityBrowserList to find OrderId, then GetById ──
      // Skip if EntityBrowserList is known to be broken (500 errors)
      try {
        const orderId = await this.getMPOOrderId(mpoNumber);
        if (orderId) {
          logger.info(`MPO ${mpoNumber}: Fast path — GetEntityBrowserList resolved to OrderId ${orderId}`);
          const result = await this.get<any>(`/MaterialPurchaseOrder/GetById?id=${orderId}`);
          if (result) {
            const mapped = this.mapToPOData(result);
            if (mapped && (mapped.po_number || mapped.mpo_number || mapped.vendor_name)) {
              logger.info(`MPO ${mpoNumber}: Fast path succeeded via GetById`);
              // Fetch lines separately
              const lines = await this.fetchMPOLines(orderId);
              return { ...mapped, line_items: lines ?? [], mpo_number: mapped.mpo_number || mpoNumber };
            }
          }
        }
      } catch (e) {
        logger.warn(`MPO ${mpoNumber}: Fast path failed, falling back to pagination`);
      }

      const allHeaders = await this.fetchAllMPOHeaders(mpoNumber);
      if (allHeaders.length === 0) return null;

      // Normalize MPO number for flexible matching
      // Remove "MPO" prefix and leading zeros for comparison
      const normalizedMPO = mpoNumber.replace(/^MPO/i, '').replace(/^0+/, '');
      const mpoWithPrefix = `MPO${normalizedMPO.padStart(6, '0')}`; // 6-digit padding based on sample MPO013402
      const mpoWithPrefixShort = `MPO${normalizedMPO}`;

      logger.info(`MPO ${mpoNumber}: Searching with formats: ${mpoNumber}, ${mpoWithPrefix}, ${mpoWithPrefixShort}, ${normalizedMPO}`);
      logger.info(`MPO ${mpoNumber}: Sample results from search: ${allHeaders.slice(0, 5).map((h: any) => h.Name).join(', ')}`);

      // ── Tier 1: Exact Name match (try multiple formats) ─────────────────────
      const exactMatch = allHeaders.find((i: any) =>
        i.Name === mpoNumber ||
        i.Name === mpoWithPrefix ||
        i.Name === mpoWithPrefixShort ||
        i.Name === normalizedMPO
      );
      if (exactMatch) {
        logger.info(`MPO ${mpoNumber}: Tier-1 exact name match (found as ${exactMatch.Name})`);
        return this.buildMPOData(exactMatch, mpoNumber);
      }

      // ── Tier 2: Reference field match (Comments / Description / SupplierDescription) ──
      const refMatch = allHeaders.find((i: any) => {
        const refs = [i.Comments, i.Description, i.SupplierDescription].filter(Boolean).join(' ');
        return refs.includes(mpoNumber) || refs.includes(normalizedMPO) || refs.includes(mpoWithPrefix);
      });
      if (refMatch) {
        logger.info(`MPO ${mpoNumber}: Tier-2 reference field match (OrderId ${refMatch.Id})`);
        return this.buildMPOData(refMatch, mpoNumber);
      }

      // ── Tier 2.5: Material code match — search reference fields for material code (e.g., ZVC, ZVCT0014) ──
      if (hint?.material_code) {
        const mc = hint.material_code.toUpperCase();
        const materialMatch = allHeaders.find((i: any) => {
          const refs = [i.Comments, i.Description, i.SupplierDescription, i.Name].filter(Boolean).join(' ').toUpperCase();
          // Match material code as substring (ZVC matches ZVCT0014)
          return refs.includes(mc);
        });
        if (materialMatch) {
          logger.info(`MPO ${mpoNumber}: Tier-2.5 material code match (${mc}, OrderId ${materialMatch.Id}, Name ${materialMatch.Name})`);
          return this.buildMPOData(materialMatch, mpoNumber);
        }
      }

      // ── Tier 3: Supplier + amount + material code fuzzy match (requires hint) ─────────────
      if (hint?.vendor_name || hint?.amount || hint?.material_code) {
        const scored = allHeaders.map((i: any) => {
          let score = 0;
          if (hint.vendor_name) {
            const vn = (i.SupplierName || '').toLowerCase();
            const hv = hint.vendor_name.toLowerCase();
            if (vn.includes(hv) || hv.includes(vn)) score += 70;
          }
          if (hint.amount && i.TotalCost) {
            const diff = Math.abs(Number(i.TotalCost) - hint.amount) / hint.amount;
            if (diff < 0.01) score += 20;
            else if (diff < 0.05) score += 10;
          }
          // Material code match adds significant score
          if (hint.material_code) {
            const mc = hint.material_code.toUpperCase();
            const refs = [i.Comments, i.Description, i.SupplierDescription, i.Name].filter(Boolean).join(' ').toUpperCase();
            if (refs.includes(mc)) score += 50;
          }
          return { item: i, score };
        });

        scored.sort((a, b) => b.score - a.score);
        const best = scored[0];
        if (best && best.score >= 50) {
          logger.info(`MPO ${mpoNumber}: Tier-3 fuzzy match (score ${best.score}, OrderId ${best.item.Id}, Name ${best.item.Name})`);
          return this.buildMPOData(best.item, mpoNumber);
        }

        logger.warn(`MPO ${mpoNumber}: Tier-3 best score ${best?.score ?? 0} — no confident match`);
      } else {
        logger.warn(`MPO ${mpoNumber}: no exact/ref match and no hint provided for fuzzy matching`);
      }

      return null;
    } catch (error) {
      logger.error(`Error fetching MPO ${mpoNumber}:`, error);
      return null;
    }
  }

  /**
   * Search MPOs by material name or description.
   * Fetches all MPO headers and searches reference fields (Comments, Description, SupplierDescription, Name)
   * for the given material name keyword (e.g., "M4NP 32mm", "ZVCT0014").
   * Returns matching MPOs with their line items.
   */
  async searchMPOByMaterialName(
    materialName: string,
    hint?: { vendor_name?: string; amount?: number }
  ): Promise<NextGenPOData[]> {
    try {
      if (this.useMock) {
        logger.warn('NextGen credentials not configured. Material name search not available.');
        return [];
      }

      const searchKey = materialName.toUpperCase().trim();
      logger.info(`[MaterialSearch] Searching MPOs for material name: "${searchKey}"`);

      // Fetch all MPO headers (no MPO number to filter by — search all)
      const allHeaders = await this.fetchAllMPOHeaders();
      if (allHeaders.length === 0) {
        logger.info(`[MaterialSearch] No MPO headers found`);
        return [];
      }

      // Search reference fields for material name
      // Also try the base code without measurement (e.g., "M4NP" from "M4NP 32mm")
      const baseCode = searchKey.split(/\s+/)[0];
      const matches: any[] = [];

      for (const header of allHeaders) {
        const refs = [
          header.Comments,
          header.Description,
          header.SupplierDescription,
          header.Name,
        ].filter(Boolean).join(' ').toUpperCase();

        // Full material name match (e.g., "M4NP 32MM")
        if (refs.includes(searchKey)) {
          matches.push({ item: header, score: 100, reason: 'full_name_match' });
          continue;
        }

        // Base code match (e.g., "M4NP" matches even if "32mm" not in description)
        if (baseCode.length >= 3 && refs.includes(baseCode)) {
          let score = 70;
          // Boost score if vendor name also matches
          if (hint?.vendor_name) {
            const vn = (header.SupplierName || '').toLowerCase();
            const hv = hint.vendor_name.toLowerCase();
            if (vn.includes(hv) || hv.includes(vn)) score += 20;
          }
          // Boost score if amount is close
          if (hint?.amount && header.TotalCost) {
            const diff = Math.abs(Number(header.TotalCost) - hint.amount) / hint.amount;
            if (diff < 0.05) score += 15;
          }
          matches.push({ item: header, score, reason: 'base_code_match' });
          continue;
        }
      }

      if (matches.length === 0) {
        logger.info(`[MaterialSearch] No MPOs found matching material name "${searchKey}"`);
        return [];
      }

      // Sort by score descending
      matches.sort((a, b) => b.score - a.score);

      // Build full PO data for top matches (limit to 10 to avoid excessive API calls)
      const results: NextGenPOData[] = [];
      for (const match of matches.slice(0, 10)) {
        try {
          const poData = await this.buildMPOData(match.item, match.item.Name);
          results.push(poData);
          logger.info(`[MaterialSearch] Match: ${match.item.Name} (score: ${match.score}, reason: ${match.reason})`);
        } catch (e) {
          logger.warn(`[MaterialSearch] Failed to build MPO data for ${match.item.Name}:`, e);
        }
      }

      return results;
    } catch (error) {
      logger.error(`[MaterialSearch] Error searching MPOs by material name "${materialName}":`, error);
      return [];
    }
  }

  /**
   * Fetch PO line items
   * Endpoint: POST /PurchaseOrder/Read?poId={poId} (Kendo grid)
   */
  async fetchPOLines(poId: string | number): Promise<any[]> {
    try {
      if (this.useMock) return [];

      const result = await this.post<any>(`/PurchaseOrder/Read?poId=${poId}`, {
        page: 1,
        pageSize: 200,
        sort: [{ field: 'LineItem', dir: 'asc' }],
        filter: null,
      });
      if (!result) return [];

      const items = result?.Data || result?.data || [];
      const lineItems = Array.isArray(items) ? items : [];
      return lineItems.map((li: any) => ({
        item_code: li.CommodityName || li.ItemCode || li.item_code || '',
        description: li.CommodityDescription || li.Description || li.description || '',
        quantity: Number(li.Quantity || li.quantity || 0),
        unit_price: Number(li.PurchasePrice || li.UnitPrice || li.unit_price || 0),
        total_amount: Number(li.TotalAmount || li.total_amount || (Number(li.Quantity || 0) * Number(li.PurchasePrice || 0))),
        color: li.OptionColourName || '',
        size: li.SizeName || '',
        delivery_date: li.DeliveryDate ? new Date(li.DeliveryDate) : null,
        transport: li.TransportMethodName || '',
      }));
    } catch (error) {
      logger.error(`Error fetching PO lines for ${poId}:`, error);
      return [];
    }
  }

  /**
   * Fetch MPO line items by numeric OrderId
   * Endpoint: POST /MaterialPurchaseOrder/FormLinesGridRead (form-encoded)
   */
  async fetchMPOLines(orderId: number | string): Promise<any[]> {
    try {
      if (this.useMock) return [];

      const body = new URLSearchParams({
        sort: '',
        page: '1',
        pageSize: '200',
        group: '',
        filter: '',
        OrderId: String(orderId),
      });

      const result = await this.postForm<any>(
        '/MaterialPurchaseOrder/FormLinesGridRead', body
      );
      if (!result) return [];

      const items = result?.Data || result?.data || [];
      return (Array.isArray(items) ? items : []).map((li: any) => ({
        item_code: li.CommodityName || li.ItemCode || li.item_code || '',
        description: li.CommodityDescription || li.Description || li.description || '',
        quantity: Number(li.Quantity || li.TotalQuantity || li.quantity || 0),
        unit_price: Number(li.LinePurchasePrice || li.PurchasePrice || li.UnitPrice || li.unit_price || 0),
        total_amount: Number(li.TotalAmount || li.total_amount || (Number(li.Quantity || 0) * Number(li.LinePurchasePrice || 0))),
        color: li.ColourName || li.OptionColourName || '',
        size: li.SizeName || '',
      }));
    } catch (error) {
      logger.error(`Error fetching MPO lines for OrderId ${orderId}:`, error);
      return [];
    }
  }

  /**
   * Compare invoice data against NextGen PO data
   * Returns match status and detailed comparison
  */
  async compareInvoiceWithPO(
    invoiceData: {
      po_number?: string;
      mpo_number?: string;
      amount: number;
      vendor_name: string;
      brand?: string;
      season?: string;
      order_type?: string;
    }
  ): Promise<POComparisonResult> {
    const poNumber = invoiceData.po_number || invoiceData.mpo_number;
    
    if (!poNumber) {
      return {
        po_found: false,
        is_match: false,
        comparison: {
          amount_match: false,
          vendor_match: false,
          brand_match: false,
          season_match: false,
          order_type_match: false,
          differences: ['No PO/MPO number provided'],
        },
      };
    }

    // Fetch PO data from NextGen — use MPO-specific method with hint for fuzzy matching
    const nextgenData = invoiceData.mpo_number
      ? await this.fetchPOByMPO(invoiceData.mpo_number, {
          vendor_name: invoiceData.vendor_name,
          amount: invoiceData.amount,
        })
      : await this.fetchPOByNumber(poNumber);

    if (!nextgenData) {
      return {
        po_found: false,
        is_match: false,
        comparison: {
          amount_match: false,
          vendor_match: false,
          brand_match: false,
          season_match: false,
          order_type_match: false,
          differences: ['PO not found in NextGen'],
        },
      };
    }

    // Compare fields
    const differences: string[] = [];
    let amountMatch = false;
    let vendorMatch = false;
    let brandMatch = false;
    let seasonMatch = false;
    let orderTypeMatch = false;

    // Amount comparison (2% warning, 5% blocking thresholds)
    const amountDiff = Math.abs(invoiceData.amount - nextgenData.amount) / nextgenData.amount;
    amountMatch = amountDiff <= 0.02; // Strict match: within 2%
    if (amountDiff > 0.05) {
      differences.push(`Amount mismatch: Invoice $${invoiceData.amount.toFixed(2)} vs PO $${nextgenData.amount.toFixed(2)} (${(amountDiff * 100).toFixed(1)}% variance)`);
    } else if (amountDiff > 0.02) {
      differences.push(`Amount variance warning: Invoice $${invoiceData.amount.toFixed(2)} vs PO $${nextgenData.amount.toFixed(2)} (${(amountDiff * 100).toFixed(1)}% variance)`);
    }

    // Vendor comparison (fuzzy matching for full company names)
    const normalizeVendorName = (name: string): string => {
      return name
        .toLowerCase()
        .replace(/\s+/g, ' ')
        .replace(/\b(b\.v\.|ltd|limited|inc|corp|corporation|llc|co|company|h\.k\.|pte)\.?/gi, '')
        .trim();
    };

    const invVendorNorm = normalizeVendorName(invoiceData.vendor_name);
    const poVendorNorm = normalizeVendorName(nextgenData.vendor_name);

    // Check if one contains the other (for full vs short names)
    vendorMatch = invVendorNorm === poVendorNorm ||
                  invVendorNorm.includes(poVendorNorm) ||
                  poVendorNorm.includes(invVendorNorm);

    if (!vendorMatch) {
      differences.push(`Vendor mismatch: Invoice "${invoiceData.vendor_name}" vs PO "${nextgenData.vendor_name}"`);
    }

    // Brand comparison — empty/missing on either side counts as match
    const invBrand = (invoiceData.brand || '').trim();
    const poBrand = (nextgenData.brand || '').trim();
    if (!invBrand || !poBrand || invBrand.toLowerCase() === poBrand.toLowerCase()) {
      brandMatch = true;
    } else {
      brandMatch = false;
      differences.push(`Brand mismatch: Invoice "${invBrand}" vs PO "${poBrand}"`);
    }

    // Season comparison — empty/missing on either side counts as match
    const invSeason = (invoiceData.season || '').trim();
    const poSeason = (nextgenData.season || '').trim();
    if (!invSeason || !poSeason || invSeason === poSeason) {
      seasonMatch = true;
    } else {
      seasonMatch = false;
      differences.push(`Season mismatch: Invoice "${invSeason}" vs PO "${poSeason}"`);
    }

    // Order type comparison — empty/missing on either side counts as match
    const invOrderType = (invoiceData.order_type || '').trim();
    const poOrderType = (nextgenData.order_type || '').trim();
    if (!invOrderType || !poOrderType || invOrderType.toLowerCase() === poOrderType.toLowerCase()) {
      orderTypeMatch = true;
    } else {
      orderTypeMatch = false;
      differences.push(`Order type mismatch: Invoice "${invOrderType}" vs PO "${poOrderType}"`);
    }

    const isMatch = amountMatch && vendorMatch && brandMatch && seasonMatch && orderTypeMatch;

    return {
      po_found: true,
      is_match: isMatch,
      nextgen_data: nextgenData,
      comparison: {
        amount_match: amountMatch,
        vendor_match: vendorMatch,
        brand_match: brandMatch,
        season_match: seasonMatch,
        order_type_match: orderTypeMatch,
        differences,
      },
    };
  }

  /**
   * List recent POs (for discovery/testing)
   * Endpoint: POST /PurchaseOrder/OrderGridRead (no filters)
   */
  async listPOs(limit: number = 20): Promise<NextGenPOData[]> {
    try {
      if (this.useMock) {
        logger.warn('NextGen credentials not configured. PO list not available.');
        return [];
      }

      const result = await this.post<any>('/PurchaseOrder/OrderGridRead', {
        page: 1,
        pageSize: limit,
        sort: [{ field: 'OrderDate', dir: 'desc' }],
        filter: null,
      });

      const items = result?.Data || result?.data || result || [];
      return (Array.isArray(items) ? items : []).map((item: any) => this.mapToPOData(item));
    } catch (error) {
      logger.error('Error listing POs from NextGen:', error);
      return [];
    }
  }

  /**
   * Search for POs by vendor name and optional date range
   * Endpoint: POST /PurchaseOrder/OrderGridRead (with Kendo filter)
   */
  async searchPOs(
    vendorName: string,
    startDate?: Date,
    endDate?: Date
  ): Promise<NextGenPOData[]> {
    try {
      if (this.useMock) {
        logger.warn(`NextGen credentials not configured. PO search not available for vendor ${vendorName}`);
        return [];
      }

      // Try multiple possible field names for vendor
      const vendorFilters: any[] = [
        { field: 'VendorName', operator: 'contains', value: vendorName },
        { field: 'SupplierName', operator: 'contains', value: vendorName },
        { field: 'Name', operator: 'contains', value: vendorName },
      ];

      const filters: any[] = [
        { logic: 'or', filters: vendorFilters },
      ];
      if (startDate) {
        filters.push({ field: 'OrderDate', operator: 'gte', value: startDate.toISOString() });
      }
      if (endDate) {
        filters.push({ field: 'OrderDate', operator: 'lte', value: endDate.toISOString() });
      }

      const result = await this.post<any>('/PurchaseOrder/OrderGridRead', {
        ...defaultGridRequest(),
        filter: { logic: 'and', filters },
      });

      const items = result?.Data || result?.data || result || [];
      return (Array.isArray(items) ? items : []).map((item: any) => this.mapToPOData(item));
    } catch (error) {
      logger.error(`Error searching POs for vendor ${vendorName}:`, error);
      return [];
    }
  }

  /**
   * Fetch Sample Purchase Order by number
   * Endpoint: POST /SamplePurchaseOrder/OrderGridRead (Kendo grid with filter)
   */
  async fetchSamplePO(samplePONumber: string): Promise<NextGenPOData | null> {
    try {
      if (this.useMock) return null;

      const result = await this.post<any>('/SamplePurchaseOrder/OrderGridRead', {
        ...defaultGridRequest(),
        filter: { field: 'Name', operator: 'contains', value: samplePONumber },
      });

      const items = result?.Data || result?.data || result || [];
      const match = Array.isArray(items) ? items[0] : null;
      if (!match) return null;

      return this.mapToPOData(match);
    } catch (error) {
      logger.error(`Error fetching Sample PO ${samplePONumber} from NextGen:`, error);
      return null;
    }
  }

  /**
   * No mock PO data is returned. When NextGen is not configured, external PO lookups return null.
   */
  private getMockPOData(_poNumber: string): NextGenPOData | null {
    return null;
  }

  /**
   * Check if NextGen API is configured and accessible
   */
  isConfigured(): boolean {
    return !!(this.baseUrl && !this.useMock);
  }

  /**
   * DEBUG: Get MPO totals by OrderId
   */
  async debugGetMPOTotals(orderId: number): Promise<any> {
    const body = new URLSearchParams({ id: String(orderId) });
    return this.postForm<any>('/MaterialPurchaseOrder/GetPOTotals', body);
  }

  /**
   * DEBUG: Get MPO lines by OrderId
   */
  async debugGetMPOLines(orderId: number): Promise<any> {
    const body = new URLSearchParams({
      sort: '', page: '1', pageSize: '25',
      group: '', filter: '',
      OrderId: String(orderId),
    });
    return this.postForm<any>('/MaterialPurchaseOrder/FormLinesGridRead', body);
  }

  /**
   * DEBUG: Get MPO list
   */
  async debugGetMPOList(): Promise<any> {
    return this.get<any>('/MaterialPurchaseOrder/GetEntityBrowserList');
  }
}

// Export singleton instance
export const nextGenService = NextGenService.getInstance();
