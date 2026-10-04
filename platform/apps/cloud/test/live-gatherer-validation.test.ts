import { describe, expect, it } from 'vitest';
import type { ReportRow } from '@adport/core';
import { validateReportRow } from '@/lib/cloud/live-gatherer';

/** PHASE A (A4): deterministic row validation — classify/reject, never silently coerce. */
const base: ReportRow = { provider: 'meta', accountId: 'act_1', currency: 'USD', entity: { level: 'campaign', id: 'c1', name: 'C1' }, metrics: { spend: 100, conversions: 5 } };

describe('validateReportRow', () => {
  it('accepts a well-formed row', () => {
    expect(validateReportRow(base).ok).toBe(true);
  });
  it('rejects a missing account identity', () => {
    const r = validateReportRow({ ...base, accountId: '' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/account identity/);
  });
  it('rejects a missing entity identity', () => {
    expect(validateReportRow({ ...base, entity: { level: 'campaign', id: '', name: 'x' } }).ok).toBe(false);
  });
  it('rejects a non-finite metric (NaN/Infinity) rather than coercing', () => {
    expect(validateReportRow({ ...base, metrics: { spend: Number.NaN } }).ok).toBe(false);
    expect(validateReportRow({ ...base, metrics: { spend: Number.POSITIVE_INFINITY } }).ok).toBe(false);
  });
  it('rejects an impossible negative metric', () => {
    expect(validateReportRow({ ...base, metrics: { spend: -5 } }).ok).toBe(false);
  });
  it('rejects an unsupported currency (unknown decimal exponent)', () => {
    const r = validateReportRow({ ...base, currency: 'ZZZ' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/currency/);
  });
  it('allows a row with no currency (counts-only)', () => {
    expect(validateReportRow({ ...base, currency: undefined, metrics: { clicks: 10 } }).ok).toBe(true);
  });
});
