/**
 * PHASE C.5 (item 10 support) — PURE provider-response SANITIZER for live contract capture.
 *
 * A single, deterministic, side-effect-free function that takes a raw provider response (parsed JSON)
 * and returns a structurally-identical copy with every sensitive value REMOVED/REDACTED, plus an honest
 * provenance envelope. It exists so that, IF a real provider response is ever captured (item 9/10 live
 * tooling, which is OFF by default and BLOCKED_EXTERNAL), the only thing that can ever be written to a
 * fixture file is a scrubbed shape — never a token, a customer email, a person's name, or any other
 * secret or PII.
 *
 * Design rules:
 *   - PURE: no I/O, no clock reads beyond an optional caller-supplied captureDate (defaults are explicit),
 *     no mutation of the input (a deep copy is produced).
 *   - CONSERVATIVE / over-redact: it is always safe to redact one field too many. A value is redacted if
 *     EITHER its key matches the denylist OR the value itself looks sensitive (e.g. an email string, a
 *     bearer/JWT-looking token). Structural keys that merely contain a generic word (e.g. `campaign_name`,
 *     `account_id`) are intentionally NOT redacted so the result is still usable as a contract fixture.
 *   - SHAPE-PRESERVING: objects/arrays keep their keys/indices and nesting; only leaf (and whole sensitive
 *     subtree) values become the sentinel string so the result is a faithful structural contract.
 *   - IDEMPOTENT: sanitizing an already-sanitized payload yields the same payload (the sentinel is inert).
 *   - NEVER fabricates data and NEVER un-redacts.
 *
 * This is NOT server-only: it is a pure utility shared with the capture CLI tooling (scripts/*.mjs). It
 * never touches credentials, the DB, or the network.
 */

export const REDACTED = '[REDACTED]' as const;

export interface SanitizeProvenance {
  /** Provider id (e.g. 'meta', 'google') — caller-supplied, never read from the payload. */
  provider: string;
  /** The provider API version the capture was taken against (e.g. 'v23.0', 'v1.3'). */
  apiVersion: string;
  /** ISO date (YYYY-MM-DD) of capture; caller may supply for determinism, else "today" (UTC) is used. */
  captureDate: string;
  /** Always true — a sanitized payload is the only thing this module ever emits. */
  sanitized: true;
}

export interface SanitizeResult {
  /** A structurally-identical, fully-scrubbed copy of the input payload. */
  sanitized: unknown;
  provenance: SanitizeProvenance;
}

export interface SanitizeOptions {
  provider: string;
  apiVersion: string;
  /** Optional ISO date override (YYYY-MM-DD) so captures are reproducible in tests. */
  captureDate?: string;
}

/**
 * Keys whose VALUE is sensitive regardless of content. Substring, case-insensitive. Covers the required
 * denylist (token|secret|password|authorization|email|phone|address|ssn|card) plus the explicit
 * categories: access/refresh/id tokens, bearer/secrets, credentials/api keys, personal names and customer
 * identifiers. Note the patterns are scoped so generic structural keys survive: `*_name` forms that are
 * personal (first/last/full/given/family/display/contact) match, but `campaign_name`/`ad_name` do not;
 * `customer_id`/`customer_email`/`customer_name` match, but a `customer_count` metric does not.
 */
const DENYLIST_KEY =
  /(access[_-]?token|refresh[_-]?token|id[_-]?token|\btoken\b|bearer|secret|password|passwd|authorization|\bauth\b|credential|api[_-]?key|client[_-]?secret|private[_-]?key|session[_-]?id|\bcookie\b|e[_-]?mail|\bemail\b|\bphone\b|mobile[_-]?number|\baddress\b|street|\bzip\b|postal[_-]?code|\bssn\b|social[_-]?security|card[_-]?number|\bcard\b|\bcvv\b|\bcvc\b|\biban\b|account[_-]?number|first[_-]?name|last[_-]?name|full[_-]?name|given[_-]?name|family[_-]?name|display[_-]?name|contact[_-]?name|customer[_-]?id|customer[_-]?name|customer[_-]?email|customer[_-]?phone)/i;

/** An email anywhere, under any key. */
const EMAIL_VALUE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
/** A long opaque/bearer/JWT-ish token value (3 base64url segments, or a long high-entropy blob). */
const TOKEN_VALUE = /^(ey[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}|[A-Za-z0-9_-]{40,})$/;

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** True if a scalar string value looks sensitive on its own merits (independent of its key). */
function valueLooksSensitive(v: string): boolean {
  if (v === REDACTED) return false; // already scrubbed — keep idempotent
  return EMAIL_VALUE.test(v) || TOKEN_VALUE.test(v);
}

/**
 * Recursively redact. `keyIsSensitive` carries down from the parent key: once a key matches the denylist,
 * its ENTIRE subtree is redacted to the sentinel (so a nested `{ authorization: { header: '...' } }` never
 * leaks a value). Otherwise each leaf is checked against the value heuristics.
 */
function scrub(value: unknown, keyIsSensitive: boolean): unknown {
  if (keyIsSensitive) return REDACTED;

  if (typeof value === 'string') return valueLooksSensitive(value) ? REDACTED : value;
  if (typeof value === 'number' || typeof value === 'boolean' || value === null || value === undefined) {
    return value;
  }
  if (Array.isArray(value)) return value.map((item) => scrub(item, false));
  if (isPlainObject(value)) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = scrub(v, DENYLIST_KEY.test(k));
    }
    return out;
  }
  // Unknown exotic types (functions, symbols, bigints) are never safe to serialize into a fixture.
  return REDACTED;
}

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Sanitize a raw provider response into a structurally-faithful, fully-scrubbed contract fixture body
 * with an honest provenance envelope (provider, apiVersion, captureDate, sanitized:true).
 */
export function sanitizeProviderResponse(raw: unknown, opts: SanitizeOptions): SanitizeResult {
  const sanitized = scrub(raw, false);
  return {
    sanitized,
    provenance: {
      provider: opts.provider,
      apiVersion: opts.apiVersion,
      captureDate: opts.captureDate ?? todayUtc(),
      sanitized: true,
    },
  };
}
