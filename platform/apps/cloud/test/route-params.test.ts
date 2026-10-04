import { describe, expect, it } from 'vitest';
import { decodeParam, decodeParams } from '@/lib/cloud/route-params';

/**
 * PHASE C0.4 — route params must be URL-decoded before use. This deployment's Next build delivers
 * dynamic route segments still percent-encoded, so a composite id built with encodeURIComponent
 * (':' → '%3A') arrives encoded and never matches the seed/live lookup — the recorded Phase-B deep-drill
 * divergence. decodeParam fixes that while staying a no-op for literal-colon URLs and malformed escapes.
 */
describe('C0.4 — decodeParam / decodeParams', () => {
  it('decodes a percent-encoded composite id', () => {
    expect(decodeParam('sandbox%3Aacc%3Aramadan')).toBe('sandbox:acc:ramadan');
    expect(decodeParam('sandbox%3Aacc%3Aramadan%3Acamp%3Aawareness%3Aag%3Alanterns'))
      .toBe('sandbox:acc:ramadan:camp:awareness:ag:lanterns');
  });

  it('is a no-op for a value with no percent (literal-colon URL keeps working)', () => {
    expect(decodeParam('sandbox:acc:ramadan')).toBe('sandbox:acc:ramadan');
    expect(decodeParam('plain')).toBe('plain');
  });

  it('falls back to the raw value on a malformed escape rather than throwing', () => {
    expect(decodeParam('100%off')).toBe('100%off');
    expect(decodeParam('%')).toBe('%');
  });

  it('decodes every string value of a params record', () => {
    expect(decodeParams({ accountId: 'a%3A1', campaignId: 'c%3A2', plain: 'x' }))
      .toEqual({ accountId: 'a:1', campaignId: 'c:2', plain: 'x' });
  });
});
