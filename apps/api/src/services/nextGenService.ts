import { logger } from '../utils/logger';
import { parseMPOReference } from '../utils/mpoReference';
import { matchMPOLines } from '../utils/mpoLineMatching';

// Timeout helper for fetch calls — prevents indefinite hangs
const FETCH_TIMEOUT_MS = Math.max(1000, Number(process.env.NEXTGEN_REQUEST_TIMEOUT_MS || 30000));
const MAX_CONCURRENT_REQUESTS = Math.max(1, Number(process.env.NEXTGEN_MAX_CONCURRENT_REQUESTS || 2));
const REQUEST_DELAY_MS = Math.max(0, Number(process.env.NEXTGEN_REQUEST_DELAY_MS || 150));
const SERVER_RETRY_DELAY_MS = Math.max(0, Number(process.env.NEXTGEN_RETRY_DELAY_MS || 300));
const AMOUNT_TOLERANCE_PERCENT = Math.max(0, Number(process.env.NEXTGEN_AMOUNT_TOLERANCE_PERCENT || 5));
const AMOUNT_WARNING_PERCENT = Math.min(
  AMOUNT_TOLERANCE_PERCENT,
  Math.max(0, Number(process.env.NEXTGEN_AMOUNT_WARNING_PERCENT || 2))
);
const UNIT_PRICE_TOLERANCE = Math.max(0, Number(process.env.NEXTGEN_UNIT_PRICE_TOLERANCE || 0.01));
const FAILURE_THRESHOLD = Math.max(1, Number(process.env.NEXTGEN_FAILURE_THRESHOLD || 5));
const COOLDOWN_MS = Math.max(1000, Number(process.env.NEXTGEN_COOLDOWN_MS || 60000));
let activeRequests = 0;
const requestWaiters: Array<() => void> = [];
const nextGenMetrics = {
  requests_total: 0,
  requests_succeeded: 0,
  requests_failed: 0,
  retries: 0,
  fallback_used: 0,
  nextgen_unavailable: 0,
  consecutive_failures: 0,
  cooldown_until: 0,
  last_success_at: null as string | null,
  last_failure_at: null as string | null,
};

export function getNextGenMetrics() {
  return {
    ...nextGenMetrics,
    cooldown_active: Date.now() < nextGenMetrics.cooldown_until,
    cooldown_until: nextGenMetrics.cooldown_until
      ? new Date(nextGenMetrics.cooldown_until).toISOString()
      : null,
    alert: nextGenMetrics.nextgen_unavailable >= 3
      ? 'HIGH_NEXTGEN_UNAVAILABLE'
      : null,
  };
}

function delay(ms: number): Promise<void> {
  return ms > 0 ? new Promise(resolve => setTimeout(resolve, ms)) : Promise.resolve();
}

async function acquireRequestSlot(): Promise<void> {
  if (activeRequests >= MAX_CONCURRENT_REQUESTS) {
    await new Promise<void>(resolve => requestWaiters.push(resolve));
  }
  activeRequests++;
}

function releaseRequestSlot(): void {
  activeRequests--;
  requestWaiters.shift()?.();
}

async function fetchWithTimeout(url: string, options: RequestInit = {}): Promise<Response> {
  if (Date.now() < nextGenMetrics.cooldown_until) {
    throw new Error('NEXTGEN_COOLDOWN_ACTIVE');
  }
  await acquireRequestSlot();
  try {
    await delay(REQUEST_DELAY_MS);
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    nextGenMetrics.requests_total++;
    const response = await fetch(url, { ...options, signal: controller.signal })
      .finally(() => clearTimeout(timeoutId));
    if (response.ok) {
      nextGenMetrics.requests_succeeded++;
      nextGenMetrics.consecutive_failures = 0;
      nextGenMetrics.last_success_at = new Date().toISOString();
    } else {
      nextGenMetrics.requests_failed++;
      nextGenMetrics.consecutive_failures++;
      nextGenMetrics.last_failure_at = new Date().toISOString();
      if (nextGenMetrics.consecutive_failures >= FAILURE_THRESHOLD) {
        nextGenMetrics.cooldown_until = Date.now() + COOLDOWN_MS;
      }
    }
    return response;
  } catch (error) {
    nextGenMetrics.requests_failed++;
    nextGenMetrics.consecutive_failures++;
    nextGenMetrics.last_failure_at = new Date().toISOString();
    if (nextGenMetrics.consecutive_failures >= FAILURE_THRESHOLD) {
      nextGenMetrics.cooldown_until = Date.now() + COOLDOWN_MS;
    }
    throw error;
  } finally {
    releaseRequestSlot();
  }
}

// ─── MPO Header Cache ──────────────────────────────────────────────────────
// Caches all MPO headers to avoid re-fetching 15,000+ records for every invoice
// TTL: 10 minutes (MPOs don't change frequently during processing)
const MPO_CACHE_TTL_MS = 60 * 60 * 1000;
let mpoHeaderCache: any[] | null = null;
let mpoCacheTimestamp = 0;
let mpoCacheFetchPromise: Promise<any[]> | null = null;

// Full PO data cache — stores complete PO data (with line items) by MPO number
// This avoids re-fetching PO details for validation checks
const poDataCache = new Map<string, { data: any; timestamp: number }>();
const PO_DATA_CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

export function getCachedPOData(mpoNumber: string): any | null {
  const entry = poDataCache.get(mpoNumber);
  if (entry && (Date.now() - entry.timestamp) < PO_DATA_CACHE_TTL_MS) {
    return entry.data;
  }
  if (entry) {
    poDataCache.delete(mpoNumber); // expired
  }
  return null;
}

export function setCachedPOData(mpoNumber: string, data: any): void {
  poDataCache.set(mpoNumber, { data, timestamp: Date.now() });
  // Clean up old entries periodically
  if (poDataCache.size > 500) {
    const now = Date.now();
    for (const [key, val] of poDataCache.entries()) {
      if (now - val.timestamp > PO_DATA_CACHE_TTL_MS) {
        poDataCache.delete(key);
      }
    }
  }
}

export function clearPODataCache(): void {
  poDataCache.clear();
}
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
    order_id?: number;
    line_id?: number;
    line_reference?: string;
    material_id?: number;
    material_url?: string;
    item_code: string;
    material_name?: string;
    description: string;
    quantity: number;
    selling_quantity?: number;
    unit_price: number;
    total_amount: number;
    external_reference?: string;
    customer_reference?: string;
    purchase_uom?: string;
    selling_uom?: string;
    received_quantity?: number;
    remaining_quantity?: number;
  }>;
  /** False means the line endpoints failed; [] must not be treated as valid zero lines. */
  line_items_available?: boolean;
  line_items_source?: 'FormLinesGridRead' | 'MPOLIGridRead';
  matched_line_items?: NextGenPOData['line_items'];
  match_level?: 'MPO_HEADER' | 'MPO_LINE' | 'MATERIAL_LINE';
}

export interface NextGenLineFetchResult {
  lines: NextGenPOData['line_items'];
  available: boolean;
  source?: NextGenPOData['line_items_source'];
}

export type NextGenValidationStatus =
  | 'MATCH'
  | 'MISMATCH'
  | 'LINE_NOT_FOUND'
  | 'PO_NOT_FOUND'
  | 'NEXTGEN_UNAVAILABLE'
  | 'MANUAL_REVIEW';

export interface InvoiceComparisonLine {
  line_number?: number;
  mpo_order_sequence?: string;
  material_code?: string;
  material_name?: string;
  quantity?: number;
  unit_price?: number;
  line_amount?: number;
}

export interface NextGenLineComparison {
  invoice_line_number?: number;
  status: NextGenValidationStatus;
  match_level: 'MPO_HEADER' | 'MPO_LINE' | 'MATERIAL_LINE';
  matched_mpo_line?: string;
  matched_material?: string;
  quantity?: { invoice: number; nextgen: number; difference: number; match: boolean };
  unit_price?: { invoice: number; nextgen: number; difference: number; match: boolean };
  amount?: { invoice: number; nextgen: number; difference: number; variance_pct: number; match: boolean };
  reason?: string;
}

/** Convert the actual NextGen MPO-line payload into stable AP validation fields. */
export function mapNextGenMPOLine(li: any) {
  const quantity = Number(li.Quantity ?? li.TotalQuantity ?? li.quantity ?? 0);
  const sellingQuantity = Number(li.SellingLineQuantityTotal ?? li.SellingQuantity ?? li.selling_quantity ?? 0);
  // In FormLinesGridRead, LinePurchasePrice is the extended line total while
  // PurchasePrice is the per-unit amount (e.g. 1050 × .05 = 52.50).
  const explicitLineTotal = Number(li.LinePurchasePrice ?? li.TotalAmount ?? li.total_amount ?? 0);
  const explicitUnitPrice = Number(li.PurchasePrice ?? li.UnitPrice ?? li.unit_price ?? 0);
  const unitPrice = explicitUnitPrice || (quantity > 0 && explicitLineTotal > 0 ? explicitLineTotal / quantity : 0);
  const totalAmount = explicitLineTotal || quantity * unitPrice;
  const materialName = String(li.CommodityName ?? li.MaterialName ?? li.material_name ?? '').trim();
  const externalReference = String(li.CommodityExternalReference ?? li.MaterialExternalReference ?? '').trim();
  const customerReference = String(li.CommodityCustomerReference ?? li.MaterialCustomerReference ?? '').trim();
  const itemCode = String(externalReference || customerReference || li.ItemCode || li.item_code || materialName).trim();
  const materialId = Number(li.CommodityId ?? li.MaterialId ?? li.material_id ?? 0) || undefined;

  return {
    order_id: Number(li.OrderId ?? li.order_id ?? 0) || undefined,
    line_id: Number(li.Id ?? li.LineId ?? li.line_id ?? 0) || undefined,
    line_reference: String(li.LineItem ?? li.LineNumber ?? li.line_reference ?? '').trim() || undefined,
    material_id: materialId,
    material_url: materialId ? `https://nextgen.madison88.com/Material/Edit/${materialId}` : undefined,
    item_code: itemCode,
    material_name: materialName,
    description: String(li.CommodityDescription ?? li.Description ?? li.description ?? '').trim(),
    quantity,
    selling_quantity: sellingQuantity,
    unit_price: unitPrice,
    total_amount: totalAmount,
    external_reference: externalReference || undefined,
    customer_reference: customerReference || undefined,
    purchase_uom: String(li.PurchaseUnitOfMeasureName ?? li.purchase_uom ?? '').trim() || undefined,
    selling_uom: String(li.SellingUnitOfMeasureName ?? li.selling_uom ?? '').trim() || undefined,
    received_quantity: Number(li.Received ?? li.received_quantity ?? 0) || undefined,
    remaining_quantity: Number(li.Balance ?? li.remaining_quantity ?? 0) || undefined,
    color: li.ColourName || li.OptionColourName || '',
    size: li.SizeName || '',
  };
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
  status?: NextGenValidationStatus;
  reason?: string;
  nextgen_data?: NextGenPOData;
  comparison: {
    amount_match: boolean;
    vendor_match: boolean;
    brand_match: boolean;
    season_match: boolean;
    order_type_match: boolean;
    currency_match?: boolean;
    invoice_amount?: number;
    nextgen_amount?: number;
    amount_difference?: number;
    variance_pct?: number;
    line_comparisons?: NextGenLineComparison[];
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

  private writeEnabled: boolean;
  private writeBaseUrl: string;

  private constructor() {
    this.baseUrl = process.env.NEXTGEN_API_URL || 'https://nextgen.madison88.com';
    this.username = process.env.NEXTGEN_USERNAME || '';
    this.password = process.env.NEXTGEN_PASSWORD || '';
    this.useMock = !this.username || !this.password;
    // Write mode: only enabled when NEXTGEN_WRITE_ENABLED=true AND a separate test URL is configured
    this.writeEnabled = process.env.NEXTGEN_WRITE_ENABLED === 'true';
    this.writeBaseUrl = process.env.NEXTGEN_TEST_API_URL || '';
  }

  static getInstance(): NextGenService {
    if (!NextGenService.instance) {
      NextGenService.instance = new NextGenService();
    }
    return NextGenService.instance;
  }

  private async refreshSessionForPagination(page: number): Promise<void> {
    // Live NextGen sessions can expire during long grid scans even though the
    // authentication cookie's nominal lifetime is much longer.
    if (page > 1 && (page - 1) % 3 === 0) {
      logger.info(`Refreshing NextGen session before MPO pagination page ${page}`);
      const loggedIn = await this.login();
      if (!loggedIn) {
        throw new Error(`Unable to refresh NextGen session before MPO pagination page ${page}`);
      }
    }
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
      // Browser sends FrReturnUrl=/ cookie — include it for successful auth
      const loginBody = new URLSearchParams({
        '__RequestVerificationToken': antiForgeryToken,
        'UserName': this.username,
        'Password': this.password,
        'FromAdobeIllustrator': 'False',
      });

      const loginRes = await fetchWithTimeout(`${this.baseUrl}/Account/Login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Cookie': `${antiForgeryCookie}; FrReturnUrl=/`,
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

  /** Allowed NextGen write paths (test env only — requires NEXTGEN_WRITE_ENABLED=true) */
  private static readonly WRITE_PATHS = [
    '/MaterialPurchaseOrder/FormLinesGridCreate',
    '/MaterialPurchaseOrder/FormLinesGridUpdate',
    '/MaterialPurchaseOrder/FormLinesGridDestroy',
    '/MaterialPurchaseOrder/MPOLIGridCreate',
    '/MaterialPurchaseOrder/MPOLIGridUpdate',
    '/MaterialPurchaseOrder/MPOLIGridDestroy',
    '/MaterialPurchaseOrder/CreateLine',
    '/MaterialPurchaseOrder/UpdateLine',
    '/MaterialPurchaseOrder/DeleteLine',
    '/MaterialPurchaseOrder/SaveLine',
    '/MaterialPurchaseOrder/FormLinesSave',
    '/MaterialPurchaseOrder/FormLinesUpdate',
  ];

  private assertReadOnly(path: string): void {
    const pathname = path.split('?')[0];
    const isAllowed = NextGenService.READ_PATHS.includes(pathname);
    if (!isAllowed) {
      throw new Error(
        `NextGen service is READ-ONLY. Path "${path}" is not in the allowed list. ` +
        `This service must NEVER write to NextGen.`
      );
    }
  }

  /** Assert that write mode is enabled and we're targeting a test environment */
  private assertWriteEnabled(path: string): void {
    const pathname = path.split('?')[0];
    const isAllowed = NextGenService.WRITE_PATHS.includes(pathname);
    if (!isAllowed) {
      throw new Error(
        `NextGen write path "${path}" is not in the allowed write paths list.`
      );
    }
    if (!this.writeEnabled) {
      throw new Error(
        'NextGen write mode is DISABLED. Set NEXTGEN_WRITE_ENABLED=true and NEXTGEN_TEST_API_URL to enable writes to a test environment.'
      );
    }
    if (!this.writeBaseUrl) {
      throw new Error(
        'NEXTGEN_TEST_API_URL is not configured. Write operations require a separate test environment URL.'
      );
    }
    // Safety: never allow writes to the production URL
    if (this.writeBaseUrl === this.baseUrl) {
      throw new Error(
        'NEXTGEN_TEST_API_URL must differ from NEXTGEN_API_URL. Writes are blocked against the production environment.'
      );
    }
  }

  /** Check if write mode is enabled */
  isWriteEnabled(): boolean {
    return this.writeEnabled && !!this.writeBaseUrl && this.writeBaseUrl !== this.baseUrl;
  }

  /** Get the effective base URL for write operations */
  private get writeUrl(): string {
    return this.writeBaseUrl || this.baseUrl;
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

    const execute = () => fetchWithTimeout(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Cookie': this.sessionCookie!,
      },
      body: body.toString(),
    });

    const parseResponse = async (response: Response): Promise<T | null> => {
      if (!response.ok) return null;
      const responseText = await response.text();
      if (responseText.includes('Log In - VisionPLM') || responseText.includes('<!doctype html>')) {
        return null;
      }
      try { return JSON.parse(responseText) as T; } catch { return null; }
    };

    let response = await execute();
    let responseText: string | null = null;
    if (response.ok) {
      responseText = await response.text();
      const isLoginPage = responseText.includes('Log In - VisionPLM') || responseText.includes('<!doctype html>');
      if (!isLoginPage) {
        try { return JSON.parse(responseText) as T; } catch { return null; }
      }
      logger.warn(`NextGen postForm ${path} returned login page, forcing a fresh session...`);
    } else if (response.status >= 500) {
      logger.warn(`NextGen postForm ${path} returned ${response.status}, forcing a fresh session and retrying once...`);
    } else if (response.status === 401 || response.status === 403) {
      logger.warn(`NextGen postForm session expired for ${path} (${response.status}), re-logging in...`);
    } else {
      logger.error(`NextGen postForm ${path} returned ${response.status}`);
      return null;
    }

    await delay(SERVER_RETRY_DELAY_MS);
    nextGenMetrics.retries++;
    const loggedIn = await this.login();
    if (!loggedIn) return null;
    response = await execute();
    const parsed = await parseResponse(response);
    if (parsed === null) {
      logger.error(`NextGen postForm ${path} failed after forced re-login (status ${response.status})`);
    }
    return parsed;
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

      // fetchPOByMPO already resolves the numeric OrderId and loads its lines.
      if (header.line_items_available !== undefined) {
        return header;
      }

      // Use mpo_number as the ID for lines fetch
      const lineResult = await this.fetchMPOLinesWithStatus(header.mpo_number);

      return {
        ...header,
        line_items: lineResult.lines,
        line_items_available: lineResult.available,
        line_items_source: lineResult.source,
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
    const normalizedMPO = mpoNumber.replace(/^MPO/i, '').replace(/^0+/, '');
    const mpoWithPrefix = `MPO${normalizedMPO.padStart(6, '0')}`;
    const mpoWithPrefixShort = `MPO${normalizedMPO}`;

    // ── Fastest path: Check in-memory MPO header cache first ──
    const now = Date.now();
    if (mpoHeaderCache && (now - mpoCacheTimestamp) < MPO_CACHE_TTL_MS) {
      const match = mpoHeaderCache.find((i: any) =>
        i.Name === mpoNumber ||
        i.Name === mpoWithPrefix ||
        i.Name === mpoWithPrefixShort ||
        (i.Name || '').includes(normalizedMPO)
      );
      if (match) {
        const orderId = match?.Id || match?.OrderId || match?.id || null;
        if (orderId) {
          logger.info(`MPO ${mpoNumber}: Cache hit — OrderId ${orderId} (age: ${Math.round((now - mpoCacheTimestamp) / 1000)}s)`);
          return Number(orderId);
        }
      }
    }

    // Skip EntityBrowserList if known to be broken (returns 500)
    if (entityBrowserListBroken) {
      logger.info(`MPO ${mpoNumber}: Skipping EntityBrowserList (known broken)`);
      // Fall through to MPOGridRead which may still work
    }

    try {
      // Try MPOGridRead with filter first (faster than EntityBrowserList)
      const filterFormats = [mpoNumber, mpoWithPrefix, mpoWithPrefixShort];
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
              ],
            },
          });
          const items: any[] = filtered?.Data || filtered?.data || [];
          if (items.length > 0 && items.length < 500) {
            const match = items.find((i: any) =>
              i.Name === mpoNumber || i.Name === mpoWithPrefix ||
              i.Name === mpoWithPrefixShort || i.Name?.includes(normalizedMPO)
            );
            if (match) {
              const orderId = match?.Id || match?.OrderId || match?.id || null;
              if (orderId) {
                logger.info(`MPO ${mpoNumber}: GridRead filter found OrderId ${orderId} using "${fmt}"`);
                return Number(orderId);
              }
            }
          }
        } catch (e) {
          // Try next format
        }
      }

      // Fall back to EntityBrowserList (only if not known to be broken)
      if (!entityBrowserListBroken) {
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
      }

      // EntityBrowserList is broken — try fetching all headers as last resort
      logger.info(`MPO ${mpoNumber}: EntityBrowserList broken, trying full header fetch`);
      const allHeaders = await this.fetchAllMPOHeaders(mpoNumber);
      const match = allHeaders.find((i: any) =>
        i.Name === mpoNumber ||
        i.Name === mpoWithPrefix ||
        i.Name === mpoWithPrefixShort ||
        (i.Name || '').includes(normalizedMPO)
      );
      if (match) {
        const orderId = match?.Id || match?.OrderId || match?.id || null;
        if (orderId) {
          logger.info(`MPO ${mpoNumber}: Found OrderId ${orderId} via full header fetch`);
          return Number(orderId);
        }
      }
      return null;
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
    if (!mpoNumber && mpoCacheFetchPromise) {
      logger.info('MPO cache: waiting for in-progress fetch');
      return mpoCacheFetchPromise;
    }

    // Start a fresh fetch (with cache wrapper)
    const fetchPromise = this._fetchAllMPOHeadersUncached(mpoNumber).then(result => {
      if (result.complete) {
        mpoHeaderCache = result.headers;
        mpoCacheTimestamp = Date.now();
        logger.info(`MPO cache: populated with ${result.headers.length} complete headers`);
      } else {
        logger.info(`MPO targeted lookup returned ${result.headers.length} headers; global cache not updated`);
      }
      return result.headers;
    });

    if (!mpoNumber) {
      mpoCacheFetchPromise = fetchPromise.finally(() => {
        mpoCacheFetchPromise = null;
      });
      return mpoCacheFetchPromise;
    }
    return fetchPromise;
  }

  private async _fetchAllMPOHeadersUncached(
    mpoNumber?: string
  ): Promise<{ headers: any[]; complete: boolean }> {
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
              return { headers: filteredItems, complete: false };
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
    if (firstItems.length === 0) return { headers: [], complete: total === 0 };

    // If target is on page 1 or no mpoNumber given, return all pages
    if (!mpoNumber || total <= PAGE_SIZE) {
      const all = [...firstItems];
      let page = 2;
      while (all.length < total) {
        await this.refreshSessionForPagination(page);
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
      if (all.length < total) {
        throw new Error(`Incomplete MPO cache refresh: expected ${total} headers, received ${all.length}`);
      }
      return { headers: all, complete: true };
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
      await this.refreshSessionForPagination(p);
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
        await this.refreshSessionForPagination(page);
        const r = await this.post<any>('/MaterialPurchaseOrder/MPOGridRead', {
          page,
          pageSize: PAGE_SIZE,
        });
        const pageData = r?.Data || r?.data || [];
        allResults.push(...pageData);
        if (pageData.length === 0) break;
        page++;
      }
      if (allResults.length < total) {
        throw new Error(`Incomplete MPO cache refresh: expected ${total} headers, received ${allResults.length}`);
      }
      return { headers: allResults, complete: true };
    }

    return { headers: results, complete: false };
  }

  /**
   * Build a NextGenPOData from an MPO header record + its line items
   */
  private async buildMPOData(match: any, mpoNumber: string): Promise<NextGenPOData> {
    const orderId = match.Id;
    logger.info(`MPO ${mpoNumber} resolved to OrderId ${orderId} (Name: ${match.Name})`);
    const lineResult = await this.fetchMPOLinesWithStatus(orderId);
    const calculatedTotal = lineResult.lines.reduce((sum, li) => sum + (li.total_amount || 0), 0);
    const _po: NextGenPOData = {
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
      line_items: lineResult.lines,
      line_items_available: lineResult.available,
      line_items_source: lineResult.source,
    };
    setCachedPOData(mpoNumber, _po);
    return _po;
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
    // Check PO data cache first
    const cached = getCachedPOData(mpoNumber);
    if (cached) {
      logger.info(`MPO ${mpoNumber}: PO data cache hit`);
      return cached;
    }
    try {
      if (this.useMock) return this.getMockPOData(mpoNumber);

      const parsedReference = parseMPOReference(mpoNumber);
      const lookupMpo = parsedReference.baseMpo || mpoNumber.trim().toUpperCase();
      const effectiveHint = {
        ...hint,
        material_code: hint?.material_code || parsedReference.materialCode,
      };

      // ── Fast path: Try GetEntityBrowserList to find OrderId, then GetById ──
      // Skip if EntityBrowserList is known to be broken (500 errors)
      try {
        const orderId = await this.getMPOOrderId(lookupMpo);
        if (orderId) {
          logger.info(`MPO ${mpoNumber}: Fast path — GetEntityBrowserList resolved to OrderId ${orderId}`);
          const result = await this.get<any>(`/MaterialPurchaseOrder/GetById?id=${orderId}`);
          if (result) {
            const mapped = this.mapToPOData(result);
            if (mapped && (mapped.po_number || mapped.mpo_number || mapped.vendor_name)) {
              logger.info(`MPO ${mpoNumber}: Fast path succeeded via GetById`);
              // Fetch lines separately
              const lineResult = await this.fetchMPOLinesWithStatus(orderId);
              const _po = { ...mapped, line_items: lineResult.lines, line_items_available: lineResult.available, line_items_source: lineResult.source, mpo_number: mapped.mpo_number || lookupMpo };
              setCachedPOData(mpoNumber, _po);
              return _po;
            }
          }
        }
      } catch (e) {
        logger.warn(`MPO ${mpoNumber}: Fast path failed, falling back to pagination`);
      }

      const allHeaders = await this.fetchAllMPOHeaders(lookupMpo);
      if (allHeaders.length === 0) return null;

      // Normalize MPO number for flexible matching
      // Remove "MPO" prefix and leading zeros for comparison
      const normalizedMPO = lookupMpo.replace(/^MPO/i, '').replace(/^0+/, '');
      const mpoWithPrefix = `MPO${normalizedMPO.padStart(6, '0')}`; // 6-digit padding based on sample MPO013402
      const mpoWithPrefixShort = `MPO${normalizedMPO}`;

      logger.info(`MPO ${lookupMpo}: Searching with formats: ${lookupMpo}, ${mpoWithPrefix}, ${mpoWithPrefixShort}, ${normalizedMPO}`);
      logger.info(`MPO ${mpoNumber}: Sample results from search: ${allHeaders.slice(0, 5).map((h: any) => h.Name).join(', ')}`);

      // ── Tier 1: Exact Name match (try multiple formats) ─────────────────────
      const exactMatch = allHeaders.find((i: any) =>
        i.Name === lookupMpo ||
        i.Name === mpoWithPrefix ||
        i.Name === mpoWithPrefixShort ||
        i.Name === normalizedMPO
      );
      if (exactMatch) {
        logger.info(`MPO ${mpoNumber}: Tier-1 exact name match (found as ${exactMatch.Name})`);
        return this.buildMPOData(exactMatch, lookupMpo);
      }

      // ── Tier 2: Reference field match (Comments / Description / SupplierDescription) ──
      const refMatch = allHeaders.find((i: any) => {
        const refs = [i.Comments, i.Description, i.SupplierDescription].filter(Boolean).join(' ');
        return refs.includes(lookupMpo) || refs.includes(normalizedMPO) || refs.includes(mpoWithPrefix);
      });
      if (refMatch) {
        logger.info(`MPO ${mpoNumber}: Tier-2 reference field match (OrderId ${refMatch.Id})`);
        return this.buildMPOData(refMatch, lookupMpo);
      }

      // ── Tier 2.5: Material code match — search reference fields for material code (e.g., ZVC, ZVCT0014) ──
      if (effectiveHint.material_code) {
        const mc = effectiveHint.material_code.toUpperCase();
        const materialMatch = allHeaders.find((i: any) => {
          const refs = [i.Comments, i.Description, i.SupplierDescription, i.Name].filter(Boolean).join(' ').toUpperCase();
          // Match material code as substring (ZVC matches ZVCT0014)
          return refs.includes(mc);
        });
        if (materialMatch) {
          logger.info(`MPO ${mpoNumber}: Tier-2.5 material code match (${mc}, OrderId ${materialMatch.Id}, Name ${materialMatch.Name})`);
          return this.buildMPOData(materialMatch, lookupMpo);
        }
      }

      // ── Tier 3: Supplier + amount + material code fuzzy match (requires hint) ─────────────
      if (effectiveHint.vendor_name || effectiveHint.amount || effectiveHint.material_code) {
        const scored = allHeaders.map((i: any) => {
          let score = 0;
          if (effectiveHint.vendor_name) {
            const vn = (i.SupplierName || '').toLowerCase();
            const hv = effectiveHint.vendor_name.toLowerCase();
            if (vn.includes(hv) || hv.includes(vn)) score += 70;
          }
          if (effectiveHint.amount && i.TotalCost) {
            const diff = Math.abs(Number(i.TotalCost) - effectiveHint.amount) / effectiveHint.amount;
            if (diff < 0.01) score += 20;
            else if (diff < 0.05) score += 10;
          }
          // Material code match adds significant score
          if (effectiveHint.material_code) {
            const mc = effectiveHint.material_code.toUpperCase();
            const refs = [i.Comments, i.Description, i.SupplierDescription, i.Name].filter(Boolean).join(' ').toUpperCase();
            if (refs.includes(mc)) score += 50;
          }
          return { item: i, score };
        });

        scored.sort((a, b) => b.score - a.score);
        const best = scored[0];
        if (best && best.score >= 50) {
          logger.info(`MPO ${mpoNumber}: Tier-3 fuzzy match (score ${best.score}, OrderId ${best.item.Id}, Name ${best.item.Name})`);
          return this.buildMPOData(best.item, lookupMpo);
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
    const result = await this.fetchMPOLinesWithStatus(orderId);
    return result.lines;
  }

  async fetchMPOLinesWithStatus(orderId: number | string): Promise<NextGenLineFetchResult> {
    try {
      if (this.useMock) return { lines: [], available: false };

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
      if (result) {
        const items = result?.Data || result?.data || [];
        return {
          lines: (Array.isArray(items) ? items : []).map(mapNextGenMPOLine),
          available: true,
          source: 'FormLinesGridRead',
        };
      }

      logger.warn(`NextGen FormLinesGridRead unavailable for OrderId ${orderId}; trying MPOLIGridRead fallback`);
      nextGenMetrics.fallback_used++;
      const fallback = await this.postForm<any>(
        '/MaterialPurchaseOrder/MPOLIGridRead', body
      );
      if (fallback) {
        const items = fallback?.Data || fallback?.data || [];
        return {
          lines: (Array.isArray(items) ? items : []).map(mapNextGenMPOLine),
          available: true,
          source: 'MPOLIGridRead',
        };
      }

      logger.error(`NextGen line data unavailable for OrderId ${orderId} after primary and fallback requests`);
      nextGenMetrics.nextgen_unavailable++;
      return { lines: [], available: false };
    } catch (error) {
      logger.error(`Error fetching MPO lines for OrderId ${orderId}:`, error);
      nextGenMetrics.nextgen_unavailable++;
      return { lines: [], available: false };
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
      mpo_order_sequence?: string;
      material_code?: string;
      material_name?: string;
      currency?: string;
      line_items?: InvoiceComparisonLine[];
    }
  ): Promise<POComparisonResult> {
    const poNumber = invoiceData.po_number || invoiceData.mpo_number;
    
    if (!poNumber) {
      return {
        po_found: false,
        is_match: false,
        status: 'PO_NOT_FOUND',
        reason: 'No PO/MPO number provided',
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
        status: 'PO_NOT_FOUND',
        reason: 'PO not found in NextGen',
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

    if (nextgenData.line_items_available === false) {
      return {
        po_found: true,
        is_match: false,
        status: 'NEXTGEN_UNAVAILABLE',
        reason: 'MPO line data could not be retrieved',
        nextgen_data: nextgenData,
        comparison: {
          amount_match: false,
          vendor_match: false,
          brand_match: false,
          season_match: false,
          order_type_match: false,
          differences: ['NEXTGEN_UNAVAILABLE: MPO line data could not be retrieved; comparison deferred'],
        },
      };
    }

    const parsedReference = parseMPOReference(invoiceData.mpo_number);
    const lineResolution = matchMPOLines(nextgenData.line_items || [], {
      orderSequence: invoiceData.mpo_order_sequence || parsedReference.orderSequence,
      materialCode: invoiceData.material_code || parsedReference.materialCode,
      materialName: invoiceData.material_name,
    });
    const hasLineSelector = Boolean(
      invoiceData.mpo_order_sequence || parsedReference.orderSequence ||
      invoiceData.material_code || parsedReference.materialCode || invoiceData.material_name
    );
    if (hasLineSelector && lineResolution.error) {
      return {
        po_found: true,
        is_match: false,
        status: lineResolution.error === 'AMBIGUOUS_MATERIAL' ? 'MANUAL_REVIEW' : 'LINE_NOT_FOUND',
        reason: lineResolution.error,
        nextgen_data: { ...nextgenData, matched_line_items: lineResolution.lines, match_level: lineResolution.matchLevel },
        comparison: {
          amount_match: false,
          vendor_match: false,
          brand_match: false,
          season_match: false,
          order_type_match: false,
          differences: [`NextGen ${lineResolution.error}: requested MPO line/material was not resolved under ${nextgenData.mpo_number}`],
        },
      };
    }
    const targetLines = hasLineSelector ? lineResolution.lines : [];
    const comparisonAmount = targetLines.length
      ? targetLines.reduce((sum, line) => sum + Number(line.total_amount || 0), 0)
      : nextgenData.amount;
    const resolvedNextGenData: NextGenPOData = {
      ...nextgenData,
      matched_line_items: targetLines,
      match_level: hasLineSelector ? lineResolution.matchLevel : 'MPO_HEADER',
    };
    const lineComparisons: NextGenLineComparison[] = [];
    for (const invoiceLine of invoiceData.line_items || []) {
      const resolution = matchMPOLines(nextgenData.line_items || [], {
        orderSequence: invoiceLine.mpo_order_sequence,
        materialCode: invoiceLine.material_code,
        materialName: invoiceLine.material_name,
      });
      if (resolution.error || resolution.lines.length !== 1) {
        lineComparisons.push({
          invoice_line_number: invoiceLine.line_number,
          status: resolution.error === 'AMBIGUOUS_MATERIAL' || resolution.lines.length > 1
            ? 'MANUAL_REVIEW'
            : 'LINE_NOT_FOUND',
          match_level: resolution.matchLevel,
          reason: resolution.error === 'AMBIGUOUS_MATERIAL' || resolution.lines.length > 1
            ? 'More than one NextGen material line matched'
            : 'Invoice line could not be resolved to one NextGen line',
        });
        continue;
      }

      const nextGenLine = resolution.lines[0];
      const quantityDifference = Number(invoiceLine.quantity || 0) - Number(nextGenLine.quantity || 0);
      const unitPriceDifference = Number(invoiceLine.unit_price || 0) - Number(nextGenLine.unit_price || 0);
      const amountDifference = Number(invoiceLine.line_amount || 0) - Number(nextGenLine.total_amount || 0);
      const amountVariance = Number(nextGenLine.total_amount || 0) > 0
        ? Math.abs(amountDifference) / Number(nextGenLine.total_amount) * 100
        : 0;
      const quantityMatch = Math.abs(quantityDifference) < 0.0001;
      const unitPriceMatch = Math.abs(unitPriceDifference) <= UNIT_PRICE_TOLERANCE;
      const lineAmountMatch = amountVariance <= AMOUNT_TOLERANCE_PERCENT;

      lineComparisons.push({
        invoice_line_number: invoiceLine.line_number,
        status: quantityMatch && unitPriceMatch && lineAmountMatch ? 'MATCH' : 'MISMATCH',
        match_level: resolution.matchLevel,
        matched_mpo_line: nextGenLine.line_reference,
        matched_material: nextGenLine.item_code || nextGenLine.material_name,
        quantity: {
          invoice: Number(invoiceLine.quantity || 0),
          nextgen: Number(nextGenLine.quantity || 0),
          difference: quantityDifference,
          match: quantityMatch,
        },
        unit_price: {
          invoice: Number(invoiceLine.unit_price || 0),
          nextgen: Number(nextGenLine.unit_price || 0),
          difference: unitPriceDifference,
          match: unitPriceMatch,
        },
        amount: {
          invoice: Number(invoiceLine.line_amount || 0),
          nextgen: Number(nextGenLine.total_amount || 0),
          difference: amountDifference,
          variance_pct: Number(amountVariance.toFixed(2)),
          match: lineAmountMatch,
        },
        reason: quantityMatch && unitPriceMatch && lineAmountMatch
          ? 'Invoice line matches NextGen quantity, unit price, and amount'
          : 'One or more line values differ from NextGen',
      });
    }

    // Compare fields
    const differences: string[] = [];
    let amountMatch = false;
    let vendorMatch = false;
    let brandMatch = false;
    let seasonMatch = false;
    let orderTypeMatch = false;

    // Amount comparison (2% warning, 5% blocking thresholds)
    const amountDiff = comparisonAmount > 0
      ? Math.abs(invoiceData.amount - comparisonAmount) / comparisonAmount
      : 0;
    amountMatch = amountDiff * 100 <= AMOUNT_TOLERANCE_PERCENT;
    if (amountDiff * 100 > AMOUNT_TOLERANCE_PERCENT) {
      differences.push(`Amount mismatch: Invoice $${invoiceData.amount.toFixed(2)} vs PO line $${comparisonAmount.toFixed(2)} (${(amountDiff * 100).toFixed(1)}% variance)`);
    } else if (amountDiff * 100 > AMOUNT_WARNING_PERCENT) {
      differences.push(`Amount variance warning: Invoice $${invoiceData.amount.toFixed(2)} vs PO line $${comparisonAmount.toFixed(2)} (${(amountDiff * 100).toFixed(1)}% variance)`);
    }

    const invoiceCurrency = String(invoiceData.currency || '').trim().toUpperCase();
    const nextGenCurrency = String(nextgenData.currency || '').trim().toUpperCase();
    const currencyMatch = !invoiceCurrency || !nextGenCurrency || invoiceCurrency === nextGenCurrency;
    if (!currencyMatch) {
      differences.push(`Currency mismatch: Invoice ${invoiceCurrency} vs PO ${nextGenCurrency}`);
    }
    for (const line of lineComparisons) {
      if (line.status !== 'MATCH') {
        differences.push(`Line ${line.invoice_line_number ?? '?'}: ${line.reason || line.status}`);
      }
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

    const hasManualReview = lineComparisons.some(line => line.status === 'MANUAL_REVIEW');
    const hasLineNotFound = lineComparisons.some(line => line.status === 'LINE_NOT_FOUND');
    const hasLineMismatch = lineComparisons.some(line => line.status === 'MISMATCH');
    const isMatch = amountMatch && currencyMatch && vendorMatch && brandMatch && seasonMatch && orderTypeMatch
      && lineComparisons.every(line => line.status === 'MATCH');
    const status: NextGenValidationStatus = hasManualReview
      ? 'MANUAL_REVIEW'
      : hasLineNotFound
        ? 'LINE_NOT_FOUND'
        : isMatch
          ? 'MATCH'
          : hasLineMismatch || differences.length
            ? 'MISMATCH'
            : 'MANUAL_REVIEW';

    return {
      po_found: true,
      is_match: isMatch,
      status,
      reason: isMatch ? 'Invoice matches NextGen' : differences.join('; '),
      nextgen_data: resolvedNextGenData,
      comparison: {
        amount_match: amountMatch,
        vendor_match: vendorMatch,
        brand_match: brandMatch,
        season_match: seasonMatch,
        order_type_match: orderTypeMatch,
        currency_match: currencyMatch,
        invoice_amount: invoiceData.amount,
        nextgen_amount: comparisonAmount,
        amount_difference: invoiceData.amount - comparisonAmount,
        variance_pct: Number((amountDiff * 100).toFixed(2)),
        line_comparisons: lineComparisons,
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

  /**
   * Preload the full MPO header cache at startup.
   * Fetches all 15,000+ MPO headers so subsequent lookups are instant.
   * This runs in the background and takes ~30-60 seconds.
   */
  async preloadMPOCache(): Promise<void> {
    const start = Date.now();
    logger.info('[MPO Cache] Pre-loading all MPO headers from NextGen...');
    try {
      const headers = await this.fetchAllMPOHeaders();
      const elapsed = ((Date.now() - start) / 1000).toFixed(1);
      logger.info(`[MPO Cache] Pre-loaded ${headers.length} MPO headers in ${elapsed}s`);
    } catch (error) {
      logger.error('[MPO Cache] Pre-load failed:', error);
    }
  }

  // ─── Write Methods (TEST ENV ONLY) ──────────────────────────────────────────

  /** POST JSON to a NextGen write endpoint (test env only) */
  private async postWrite<T>(path: string, body: any): Promise<T | null> {
    this.assertWriteEnabled(path);

    if (this.useMock) {
      logger.warn(`NextGen credentials not configured. Cannot write to ${path}`);
      return null;
    }

    // Use a separate session for the test env
    if (!this.sessionCookie || Date.now() - this.cookieObtainedAt > NextGenService.COOKIE_MAX_AGE) {
      const loggedIn = await this.loginToTestEnv();
      if (!loggedIn) {
        logger.error(`NextGen test env login failed, cannot write to ${path}`);
        return null;
      }
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (this.sessionCookie!.startsWith('Bearer ') || this.sessionCookie!.startsWith('Basic ')) {
      headers['Authorization'] = this.sessionCookie!;
    } else {
      headers['Cookie'] = this.sessionCookie!;
    }

    const response = await fetchWithTimeout(`${this.writeUrl}${path}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });

    if (response.status === 401 || response.status === 403) {
      logger.warn(`NextGen test env session expired for ${path}, re-logging in...`);
      const loggedIn = await this.loginToTestEnv();
      if (!loggedIn) return null;

      if (this.sessionCookie!.startsWith('Bearer ') || this.sessionCookie!.startsWith('Basic ')) {
        headers['Authorization'] = this.sessionCookie!;
        delete headers['Cookie'];
      } else {
        headers['Cookie'] = this.sessionCookie!;
      }

      const retryResponse = await fetchWithTimeout(`${this.writeUrl}${path}`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      });

      if (!retryResponse.ok) {
        logger.error(`NextGen test env ${path} returned ${retryResponse.status} after re-login`);
        return null;
      }

      const retryText = await retryResponse.text();
      try { return JSON.parse(retryText) as T; } catch { return null; }
    }

    if (!response.ok) {
      logger.error(`NextGen test env ${path} returned ${response.status}: ${response.statusText}`);
      return null;
    }

    const responseText = await response.text();
    try { return JSON.parse(responseText) as T; } catch { return null; }
  }

  /** POST form-encoded data to a NextGen write endpoint (test env only) */
  private async postWriteForm<T>(path: string, body: URLSearchParams): Promise<T | null> {
    this.assertWriteEnabled(path);

    if (this.useMock) return null;

    if (!this.sessionCookie || Date.now() - this.cookieObtainedAt > NextGenService.COOKIE_MAX_AGE) {
      const loggedIn = await this.loginToTestEnv();
      if (!loggedIn) return null;
    }

    const execute = () => fetchWithTimeout(`${this.writeUrl}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Cookie': this.sessionCookie!,
      },
      body: body.toString(),
    });

    const parseResponse = async (response: Response): Promise<T | null> => {
      if (!response.ok) return null;
      const responseText = await response.text();
      if (responseText.includes('Log In - VisionPLM') || responseText.includes('<!doctype html>')) {
        return null;
      }
      try { return JSON.parse(responseText) as T; } catch { return null; }
    };

    let response = await execute();
    if (response.ok) {
      const parsed = await parseResponse(response);
      if (parsed !== null) return parsed;
      logger.warn(`NextGen test env postWriteForm ${path} returned login page, forcing fresh session...`);
    } else if (response.status === 401 || response.status === 403) {
      logger.warn(`NextGen test env session expired for ${path}, re-logging in...`);
    } else {
      logger.error(`NextGen test env postWriteForm ${path} returned ${response.status}`);
      return null;
    }

    await delay(SERVER_RETRY_DELAY_MS);
    const loggedIn = await this.loginToTestEnv();
    if (!loggedIn) return null;
    response = await execute();
    return parseResponse(response);
  }

  /** Login to the test environment (separate URL) */
  private loginInProgress = false;

  private async loginToTestEnv(): Promise<boolean> {
    // Prevent concurrent login attempts that could trigger account lockout
    if (this.loginInProgress) {
      logger.warn('[TestEnv] Login already in progress, waiting...');
      await delay(2000);
      return !!this.sessionCookie && Date.now() - this.cookieObtainedAt < NextGenService.COOKIE_MAX_AGE;
    }
    this.loginInProgress = true;

    try {
      const extractCookies = (res: Response): string[] => {
        if (typeof res.headers.getSetCookie === 'function') {
          return res.headers.getSetCookie() || [];
        }
        const raw = res.headers.get('set-cookie');
        if (!raw) return [];
        return raw.split(/,(?=[^;]+=[^;]+)/g).map(c => c.trim());
      };

      const testUrl = this.writeUrl;
      logger.info(`Logging into NextGen test env: ${testUrl}`);

      // Step 1: Get login page and extract anti-forgery token
      // Use direct fetch (not fetchWithTimeout) to avoid rate limiter/cooldown interference
      const getPage = await fetch(`${testUrl}/Account/Login`);
      const html = await getPage.text();
      const pageCookies = extractCookies(getPage);

      const tokenRegex = /name="__RequestVerificationToken"[^>]*value="([^"]+)"/;
      const tokenRegex2 = /__RequestVerificationToken[\s\S]*?value="([^"]+)"/;
      let tokenMatch = html.match(tokenRegex);
      if (!tokenMatch) tokenMatch = html.match(tokenRegex2);

      if (!tokenMatch) {
        logger.error('NextGen test env login page: could not find __RequestVerificationToken');
        return false;
      }

      const antiForgeryToken = tokenMatch[1];
      const antiForgeryCookie = pageCookies.map((c: string) => c.split(';')[0]).join('; ');

      logger.info(`[TestEnv] Login page cookies: ${antiForgeryCookie.substring(0, 50)}...`);
      logger.info(`[TestEnv] Anti-forgery token: ${antiForgeryToken.substring(0, 20)}...`);

      const loginBody = new URLSearchParams({
        '__RequestVerificationToken': antiForgeryToken,
        'UserName': this.username,
        'Password': this.password,
        'FromAdobeIllustrator': 'False',
      });

      // Step 2: POST login with redirect:manual to catch 302 and auth cookies
      // Use direct fetch (not fetchWithTimeout) to avoid rate limiter/cooldown interference
      const loginRes = await fetch(`${testUrl}/Account/Login?ReturnUrl=%2F`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Cookie': antiForgeryCookie,
        },
        body: loginBody.toString(),
        redirect: 'manual',
      });

      const loginCookies = extractCookies(loginRes);
      const allCookies = [
        ...pageCookies.map((c: string) => c.split(';')[0]),
        ...loginCookies.map((c: string) => c.split(';')[0]),
      ].join('; ');

      // Check for account lockout in response body (only readable on 200)
      if (loginRes.status === 200) {
        const responseText = await loginRes.text();
        logger.info(`[TestEnv] Login response body (first 300): ${responseText.substring(0, 300)}`);
        if (responseText.includes('temporarily disabled') || responseText.includes('failed logins')) {
          const lockoutMatch = responseText.match(/try again in (\d+) minutes/);
          const minutes = lockoutMatch ? lockoutMatch[1] : 'unknown';
          logger.error(`NextGen test env account temporarily locked. Try again in ${minutes} minutes.`);
          return false;
        }
        logger.error(`NextGen test env login failed: status 200, still on login page`);
        return false;
      }

      // Success: 302 redirect with FastReactAuthentication cookie
      const hasAuthCookie = loginCookies.some((c: string) =>
        c.toLowerCase().includes('fastreactauthentication') ||
        c.toLowerCase().includes('.aspxauth') ||
        c.toLowerCase().includes('aspnet')
      );

      if (loginRes.status === 302 && hasAuthCookie) {
        this.sessionCookie = allCookies;
        this.cookieObtainedAt = Date.now();
        logger.info(`NextGen test env login successful.`);
        return true;
      }

      logger.error(`NextGen test env login failed: status ${loginRes.status}, cookies: ${loginCookies.length}`);
      return false;
    } catch (error) {
      logger.error('NextGen test env login error:', error);
      return false;
    } finally {
      this.loginInProgress = false;
    }
  }

  // ─── Public Write API (test env only) ───────────────────────────────────────

  /**
   * Resolve MPO number to numeric OrderId by querying the TEST env.
   * Uses postWriteForm/postWrite to hit the test env's MPOGridRead.
   */
  private async getMPOOrderIdFromTestEnv(mpoNumber: string): Promise<number | null> {
    try {
      // Login once before the loop — avoid repeated login attempts that trigger lockout
      if (!this.sessionCookie || Date.now() - this.cookieObtainedAt > NextGenService.COOKIE_MAX_AGE) {
        const loggedIn = await this.loginToTestEnv();
        if (!loggedIn) {
          logger.warn(`[TestEnv] Cannot resolve MPO ${mpoNumber} — login to test env failed`);
          return null;
        }
      }

      const normalizedMPO = mpoNumber.replace(/^MPO/i, '').replace(/^0+/, '');
      const mpoWithPrefix = `MPO${normalizedMPO.padStart(6, '0')}`;
      const mpoWithPrefixShort = `MPO${normalizedMPO}`;
      const filterFormats = [mpoNumber, mpoWithPrefix, mpoWithPrefixShort];

      for (const fmt of filterFormats) {
        try {
          const response = await fetchWithTimeout(`${this.writeUrl}/MaterialPurchaseOrder/MPOGridRead`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Cookie': this.sessionCookie!,
            },
            body: JSON.stringify({
              page: 1,
              pageSize: 50,
              sort: [{ field: 'Name', dir: 'desc' }],
              filter: {
                logic: 'or',
                filters: [
                  { field: 'Name', operator: 'eq', value: fmt },
                  { field: 'Name', operator: 'contains', value: fmt },
                ],
              },
            }),
          });

          if (!response.ok) continue;
          const text = await response.text();
          if (text.includes('Log In - VisionPLM') || text.includes('<!doctype html>')) {
            // Session expired — try one re-login, then stop
            const relogged = await this.loginToTestEnv();
            if (!relogged) break;
            continue;
          }
          let result: any;
          try { result = JSON.parse(text); } catch { continue; }

          const items: any[] = result?.Data || result?.data || [];
          if (items.length > 0 && items.length < 500) {
            const match = items.find((i: any) =>
              i.Name === mpoNumber || i.Name === mpoWithPrefix ||
              i.Name === mpoWithPrefixShort || i.Name?.includes(normalizedMPO)
            );
            if (match) {
              const orderId = match?.Id || match?.OrderId || match?.id || null;
              if (orderId) {
                logger.info(`[TestEnv] MPO ${mpoNumber}: GridRead found OrderId ${orderId} using "${fmt}"`);
                return Number(orderId);
              }
            }
          }
        } catch (e) {
          // Try next format
        }
      }

      logger.warn(`[TestEnv] MPO ${mpoNumber}: Could not resolve OrderId from test env`);
      return null;
    } catch (error) {
      logger.error(`[TestEnv] Error resolving MPO ${mpoNumber} from test env:`, error);
      return null;
    }
  }

  /**
   * Fetch MPO lines from the TEST env by OrderId.
   */
  private async fetchMPOLinesWithStatusFromTestEnv(orderId: number | string): Promise<NextGenLineFetchResult> {
    try {
      if (!this.sessionCookie || Date.now() - this.cookieObtainedAt > NextGenService.COOKIE_MAX_AGE) {
        const loggedIn = await this.loginToTestEnv();
        if (!loggedIn) {
          logger.warn(`[TestEnv] Cannot fetch lines — login to test env failed`);
          return { lines: [], available: false };
        }
      }

      const body = new URLSearchParams({
        sort: '',
        page: '1',
        pageSize: '200',
        group: '',
        filter: '',
        OrderId: String(orderId),
      });

      const response = await fetchWithTimeout(`${this.writeUrl}/MaterialPurchaseOrder/FormLinesGridRead`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Cookie': this.sessionCookie!,
        },
        body: body.toString(),
      });

      if (response.ok) {
        const text = await response.text();
        if (!text.includes('Log In - VisionPLM') && !text.includes('<!doctype html>')) {
          try {
            const result = JSON.parse(text);
            const items = result?.Data || result?.data || [];
            return {
              lines: (Array.isArray(items) ? items : []).map(mapNextGenMPOLine),
              available: true,
              source: 'FormLinesGridRead',
            };
          } catch { /* fall through */ }
        }
      }

      // Fallback: MPOLIGridRead
      const fallbackResponse = await fetchWithTimeout(`${this.writeUrl}/MaterialPurchaseOrder/MPOLIGridRead`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Cookie': this.sessionCookie!,
        },
        body: body.toString(),
      });

      if (fallbackResponse.ok) {
        const text = await fallbackResponse.text();
        if (!text.includes('Log In - VisionPLM') && !text.includes('<!doctype html>')) {
          try {
            const result = JSON.parse(text);
            const items = result?.Data || result?.data || [];
            return {
              lines: (Array.isArray(items) ? items : []).map(mapNextGenMPOLine),
              available: true,
              source: 'MPOLIGridRead',
            };
          } catch { /* fall through */ }
        }
      }

      logger.error(`[TestEnv] Line data unavailable for OrderId ${orderId} from test env`);
      return { lines: [], available: false };
    } catch (error) {
      logger.error(`[TestEnv] Error fetching MPO lines for OrderId ${orderId} from test env:`, error);
      return { lines: [], available: false };
    }
  }

  /**
   * Upload/create MPO line items to NextGen test env.
   * Accepts an array of line items and creates them on the specified MPO.
   */
  async uploadMPOLines(
    mpoNumber: string,
    lines: Array<{
      material_code?: string;
      material_name?: string;
      description?: string;
      quantity?: number;
      unit_price?: number;
      total_amount?: number;
      size?: string;
      color?: string;
      purchase_uom?: string;
      external_reference?: string;
      customer_reference?: string;
    }>
  ): Promise<{ success: boolean; created: number; errors: string[]; details?: any }> {
    if (!this.isWriteEnabled()) {
      return {
        success: false,
        created: 0,
        errors: ['Write mode is not enabled. Set NEXTGEN_WRITE_ENABLED=true and NEXTGEN_TEST_API_URL to a test environment.'],
      };
    }

    const errors: string[] = [];
    let created = 0;
    const details: any[] = [];

    // Resolve MPO to OrderId from the TEST env
    const orderId = await this.getMPOOrderIdFromTestEnv(mpoNumber);
    if (!orderId) {
      return {
        success: false,
        created: 0,
        errors: [`MPO ${mpoNumber} not found in NextGen test env — cannot resolve OrderId for line creation`],
      };
    }

    for (const line of lines) {
      try {
        // Kendo grid create format — matches FormLinesGridRead structure
        const createBody = {
          OrderId: orderId,
          CommodityExternalReference: line.material_code || line.external_reference || '',
          CommodityName: line.material_name || '',
          CommodityDescription: line.description || '',
          Quantity: line.quantity || 0,
          PurchasePrice: line.unit_price || 0,
          TotalAmount: line.total_amount || ((line.quantity || 0) * (line.unit_price || 0)),
          SizeName: line.size || '',
          OptionColourName: line.color || '',
          PurchaseUnitOfMeasureName: line.purchase_uom || '',
          CommodityCustomerReference: line.customer_reference || '',
        };

        const result = await this.postWriteForm<any>(
          '/MaterialPurchaseOrder/FormLinesGridCreate',
          new URLSearchParams({
            OrderId: String(orderId),
            CommodityExternalReference: createBody.CommodityExternalReference,
            CommodityName: createBody.CommodityName,
            CommodityDescription: createBody.CommodityDescription,
            Quantity: String(createBody.Quantity),
            PurchasePrice: String(createBody.PurchasePrice),
            TotalAmount: String(createBody.TotalAmount),
            SizeName: createBody.SizeName,
            OptionColourName: createBody.OptionColourName,
            PurchaseUnitOfMeasureName: createBody.PurchaseUnitOfMeasureName,
            CommodityCustomerReference: createBody.CommodityCustomerReference,
          })
        );

        if (result) {
          created++;
          details.push({ line: line.material_code || line.material_name, status: 'created', result });
        } else {
          // Try JSON-based endpoint as fallback
          const jsonResult = await this.postWrite<any>('/MaterialPurchaseOrder/CreateLine', createBody);
          if (jsonResult) {
            created++;
            details.push({ line: line.material_code || line.material_name, status: 'created', result: jsonResult });
          } else {
            errors.push(`Failed to create line for ${line.material_code || line.material_name || 'unknown'}`);
            details.push({ line: line.material_code || line.material_name, status: 'failed' });
          }
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        errors.push(`Error creating line ${line.material_code || line.material_name || 'unknown'}: ${msg}`);
        details.push({ line: line.material_code || line.material_name, status: 'error', error: msg });
      }
    }

    return { success: created > 0, created, errors, details };
  }

  /**
   * Upload/update sizes on an existing MPO line in NextGen test env.
   * Accepts an array of size definitions and applies them to the MPO's lines.
   */
  async uploadSizes(
    mpoNumber: string,
    sizes: Array<{
      line_id?: number;
      material_code?: string;
      size_name: string;
      quantity?: number;
      colour_name?: string;
    }>
  ): Promise<{ success: boolean; updated: number; errors: string[]; details?: any }> {
    if (!this.isWriteEnabled()) {
      return {
        success: false,
        updated: 0,
        errors: ['Write mode is not enabled. Set NEXTGEN_WRITE_ENABLED=true and NEXTGEN_TEST_API_URL to a test environment.'],
      };
    }

    const errors: string[] = [];
    let updated = 0;
    const details: any[] = [];

    // Resolve MPO to OrderId from the TEST env
    const orderId = await this.getMPOOrderIdFromTestEnv(mpoNumber);
    if (!orderId) {
      return {
        success: false,
        updated: 0,
        errors: [`MPO ${mpoNumber} not found in NextGen test env — cannot resolve OrderId for size upload`],
      };
    }

    // Fetch existing lines from the TEST env to match against
    const existingLines = await this.fetchMPOLinesWithStatusFromTestEnv(orderId);
    if (!existingLines.available) {
      return {
        success: false,
        updated: 0,
        errors: [`Could not fetch existing lines for MPO ${mpoNumber} — cannot update sizes`],
      };
    }

    for (const sizeEntry of sizes) {
      try {
        // Find the matching line by line_id or material_code
        let targetLine: any = null;
        if (sizeEntry.line_id) {
          targetLine = existingLines.lines.find(l => l.line_id === sizeEntry.line_id);
        }
        if (!targetLine && sizeEntry.material_code) {
          const mc = sizeEntry.material_code.toUpperCase();
          targetLine = existingLines.lines.find(l =>
            (l.item_code || '').toUpperCase().includes(mc) ||
            (l.external_reference || '').toUpperCase().includes(mc)
          );
        }

        if (!targetLine) {
          errors.push(`No matching line found for size "${sizeEntry.size_name}" (material: ${sizeEntry.material_code || 'n/a'}, line_id: ${sizeEntry.line_id || 'n/a'})`);
          details.push({ size: sizeEntry.size_name, status: 'line_not_found' });
          continue;
        }

        // Update the line with the new size
        const updateBody = new URLSearchParams({
          OrderId: String(orderId),
          Id: String(targetLine.line_id || ''),
          CommodityExternalReference: targetLine.external_reference || '',
          CommodityName: targetLine.material_name || targetLine.item_code || '',
          CommodityDescription: targetLine.description || '',
          Quantity: String(sizeEntry.quantity ?? targetLine.quantity ?? 0),
          PurchasePrice: String(targetLine.unit_price || 0),
          TotalAmount: String((sizeEntry.quantity ?? targetLine.quantity ?? 0) * (targetLine.unit_price || 0)),
          SizeName: sizeEntry.size_name,
          OptionColourName: sizeEntry.colour_name || targetLine.color || '',
          PurchaseUnitOfMeasureName: targetLine.purchase_uom || '',
        });

        const result = await this.postWriteForm<any>(
          '/MaterialPurchaseOrder/FormLinesGridUpdate',
          updateBody
        );

        if (result) {
          updated++;
          details.push({ size: sizeEntry.size_name, line: targetLine.item_code, status: 'updated', result });
        } else {
          // Try JSON endpoint as fallback
          const jsonResult = await this.postWrite<any>('/MaterialPurchaseOrder/UpdateLine', {
            OrderId: orderId,
            Id: targetLine.line_id,
            SizeName: sizeEntry.size_name,
            Quantity: sizeEntry.quantity ?? targetLine.quantity,
            OptionColourName: sizeEntry.colour_name || targetLine.color,
          });
          if (jsonResult) {
            updated++;
            details.push({ size: sizeEntry.size_name, line: targetLine.item_code, status: 'updated', result: jsonResult });
          } else {
            errors.push(`Failed to update size "${sizeEntry.size_name}" on line ${targetLine.item_code}`);
            details.push({ size: sizeEntry.size_name, line: targetLine.item_code, status: 'failed' });
          }
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        errors.push(`Error updating size "${sizeEntry.size_name}": ${msg}`);
        details.push({ size: sizeEntry.size_name, status: 'error', error: msg });
      }
    }

    return { success: updated > 0, updated, errors, details };
  }
}

// Export singleton instance
export const nextGenService = NextGenService.getInstance();
