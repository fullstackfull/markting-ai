import 'server-only';

/**
 * PHASE C0.4 — canonical decoding of dynamic route segment params.
 *
 * This deployment's Next build does NOT URL-decode dynamic route segments: a param whose value was
 * produced with encodeURIComponent (e.g. an account/campaign/group/ad id that contains ':' → '%3A')
 * arrives at the page still percent-encoded. Every id in this product is a delimited composite
 * (`sandbox:acc:ramadan`, `…:camp:awareness`, provider:account tuples), so an undecoded segment never
 * matches the seed/live lookup and the drill surface silently falls back / 404s. This was the recorded
 * Phase-B "test-harness divergence": deep drill links built with encodeURIComponent never resolved.
 *
 * Decode exactly once, defensively: a value without a '%' is returned unchanged (so a literal-colon URL
 * keeps working), and a malformed escape falls back to the raw value rather than throwing. Apply at the
 * top of every dynamic route, right after `await params`, before the id is used for authorization,
 * lookup, or building child links (which re-encode with encodeURIComponent).
 */
export function decodeParam(value: string): string {
  if (!value.includes('%')) return value;
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export function decodeParams<T extends Record<string, string>>(params: T): T {
  const out = {} as Record<string, string>;
  for (const [key, value] of Object.entries(params)) out[key] = decodeParam(value);
  return out as T;
}
