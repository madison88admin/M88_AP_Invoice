import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import {
  evaluateCurrencyPolicy,
  getIntakeCurrencyMode,
  getVendorCurrencyMap,
  getGlobalCurrencyAllowlist,
  normalizeToUsd,
  getDefaultFxRates,
} from './currencyPolicyService';

const ENV_KEYS = ['INTAKE_CURRENCY_MODE', 'INTAKE_CURRENCY_ALLOWLIST', 'INTAKE_VENDOR_CURRENCY_MAP', 'INTAKE_DEFAULT_FX_RATES'] as const;

afterEach(() => {
  for (const key of ENV_KEYS) delete process.env[key];
});

describe('currencyPolicyService — mode parsing', () => {
  it('defaults to park', () => {
    expect(getIntakeCurrencyMode()).toBe('park');
  });

  it('accepts exception and auto', () => {
    process.env.INTAKE_CURRENCY_MODE = 'exception';
    expect(getIntakeCurrencyMode()).toBe('exception');
    process.env.INTAKE_CURRENCY_MODE = 'auto';
    expect(getIntakeCurrencyMode()).toBe('auto');
    process.env.INTAKE_CURRENCY_MODE = 'garbage';
    expect(getIntakeCurrencyMode()).toBe('park');
  });
});

describe('currencyPolicyService — allowlist parsing', () => {
  it('parses vendor currency map entries', () => {
    process.env.INTAKE_VENDOR_CURRENCY_MAP = 'C&T Label:HKD;PT UWU:IDR,EUR';
    const map = getVendorCurrencyMap();
    expect(map.get('c&t label')?.has('HKD')).toBe(true);
    expect(map.get('pt uwu')?.has('IDR')).toBe(true);
    expect(map.get('pt uwu')?.has('EUR')).toBe(true);
    expect(map.get('pt uwu')?.has('PHP')).toBe(false);
  });

  it('parses global allowlist with implicit USD', () => {
    process.env.INTAKE_CURRENCY_ALLOWLIST = 'HKD, EUR';
    const set = getGlobalCurrencyAllowlist();
    expect(set.has('USD')).toBe(true);
    expect(set.has('HKD')).toBe(true);
    expect(set.has('EUR')).toBe(true);
    expect(set.has('IDR')).toBe(false);
  });
});

describe('currencyPolicyService — evaluateCurrencyPolicy', () => {
  it('parks blank currency always', () => {
    const r = evaluateCurrencyPolicy(null);
    expect(r.park).toBe(true);
    expect(r.allowed).toBe(false);
  });

  it('park mode: parks non-USD with old reason (backward compatible)', () => {
    const r = evaluateCurrencyPolicy('HKD', 'C&T Label');
    expect(r.park).toBe(true);
    expect(r.allowed).toBe(false);
    expect(r.reason).toMatch(/requires manual review/);
  });

  it('exception mode: allows creation with a currency exception', () => {
    process.env.INTAKE_CURRENCY_MODE = 'exception';
    const r = evaluateCurrencyPolicy('HKD', 'C&T Label');
    expect(r.park).toBe(false);
    expect(r.allowed).toBe(true);
    expect(r.needsException).toBe(true);
    expect(r.reason).toMatch(/accounting review/);
  });

  it('exception mode: ambiguous extraction still gets an exception in auto mode', () => {
    process.env.INTAKE_CURRENCY_MODE = 'auto';
    const r = evaluateCurrencyPolicy('IDR', 'PT UWU', { needsCurrencyConfirmation: true });
    expect(r.allowed).toBe(true);
    expect(r.needsException).toBe(true);
    expect(r.reason).toMatch(/needs confirmation/);
  });

  it('vendor allowlist bypasses the exception entirely', () => {
    process.env.INTAKE_VENDOR_CURRENCY_MAP = 'C&T Label:HKD';
    const r = evaluateCurrencyPolicy('HKD', 'c&t label'); // case-insensitive
    expect(r.allowed).toBe(true);
    expect(r.needsException).toBe(false);
    expect(r.vendorAllowlisted).toBe(true);
  });

  it('vendor allowlist does not leak to other currencies', () => {
    process.env.INTAKE_VENDOR_CURRENCY_MAP = 'C&T Label:HKD';
    const r = evaluateCurrencyPolicy('IDR', 'C&T Label');
    expect(r.allowed).toBe(false); // park mode default
    process.env.INTAKE_CURRENCY_MODE = 'exception';
    const r2 = evaluateCurrencyPolicy('IDR', 'C&T Label');
    expect(r2.needsException).toBe(true);
  });

  it('global allowlist bypasses the exception entirely', () => {
    process.env.INTAKE_CURRENCY_ALLOWLIST = 'HKD';
    const r = evaluateCurrencyPolicy('HKD', 'Unknown Vendor');
    expect(r.allowed).toBe(true);
    expect(r.needsException).toBe(false);
  });

  it('USD never reaches this function but is safe anyway via allowlist', () => {
    const r = evaluateCurrencyPolicy('USD');
    expect(r.allowed).toBe(true);
    expect(r.needsException).toBe(false);
  });

  // ---- USD-only amount normalization ----
  describe('normalizeToUsd', () => {
    beforeEach(() => { delete process.env.INTAKE_DEFAULT_FX_RATES; });

    it('prefers the invoice-stated USD equivalent', () => {
      const r = normalizeToUsd('HKD', 777, { usdEquivalent: 100 });
      expect(r?.usdAmount).toBe(100);
      expect(r?.basis).toBe('invoice_stated_usd');
      expect(r?.originalCurrency).toBe('HKD');
      expect(r?.originalAmount).toBe(777);
    });

    it('divides by the invoice-stated exchange rate when no USD equivalent', () => {
      const r = normalizeToUsd('HKD', 1942.5, { exchangeRateToUsd: 7.7 });
      expect(r?.usdAmount).toBeCloseTo(252.27, 1);
      expect(r?.basis).toBe('invoice_stated_rate');
    });

    it('falls back to the env rate table', () => {
      process.env.INTAKE_DEFAULT_FX_RATES = 'HKD=7.8;IDR=16000';
      const r = normalizeToUsd('HKD', 780);
      expect(r?.usdAmount).toBe(100);
      expect(r?.basis).toBe('env_fallback');
      const r2 = normalizeToUsd('IDR', 1600000);
      expect(r2?.usdAmount).toBe(100);
    });

    it('returns null when no basis exists (caller must park)', () => {
      expect(normalizeToUsd('XYZ', 100)).toBeNull();
    });

    it('uses the built-in default table when env is not set', () => {
      const r = normalizeToUsd('HKD', 780);
      expect(r?.usdAmount).toBeCloseTo(100, 5);
      expect(r?.basis).toBe('env_fallback');
    });

    it('rejects USD, zero, negative, and NaN amounts', () => {
      expect(normalizeToUsd('USD', 100)).toBeNull();
      expect(normalizeToUsd('HKD', 0)).toBeNull();
      expect(normalizeToUsd('HKD', -5)).toBeNull();
      expect(normalizeToUsd('HKD', NaN)).toBeNull();
    });

    it('parses the env rate table', () => {
      process.env.INTAKE_DEFAULT_FX_RATES = 'HKD=7.8;idr=16000;EUR=bogus;X=1';
      const rates = getDefaultFxRates();
      expect(rates.HKD).toBe(7.8);
      expect(rates.IDR).toBe(16000);
      expect(rates.EUR).toBeUndefined();
      expect(rates.X).toBeUndefined();
    });
  });
});
