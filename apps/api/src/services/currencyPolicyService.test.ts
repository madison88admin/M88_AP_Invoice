import { describe, it, expect, afterEach } from 'vitest';
import {
  evaluateCurrencyPolicy,
  getIntakeCurrencyMode,
  getVendorCurrencyMap,
  getGlobalCurrencyAllowlist,
} from './currencyPolicyService';

const ENV_KEYS = ['INTAKE_CURRENCY_MODE', 'INTAKE_CURRENCY_ALLOWLIST', 'INTAKE_VENDOR_CURRENCY_MAP'] as const;

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
});
