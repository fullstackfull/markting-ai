import { CONNECTION_ERROR_CLASSES, ERROR_REMEDIATION, type ConnectionErrorClass } from './vocabulary';

/**
 * CONNECTIONS CONTROL PLANE — deterministic error classification.
 *
 * Maps a raw provider/connection failure (or a stored `last_error` string, or a known error class) to the
 * canonical error taxonomy + its deterministic remediation. NO model is involved. This is the single place
 * that turns "something failed" into an actionable class + recommended action for both tenant and admin
 * surfaces. It never echoes tokens — it only reads the message text to pattern-match a class.
 */

const PATTERNS: Array<{ re: RegExp; cls: ConnectionErrorClass }> = [
  // Order matters: most specific first.
  { re: /\b(429|rate[\s_-]?limit|too many requests)\b/i, cls: 'RATE_LIMIT' },
  { re: /\b(invalid_grant|token (?:is )?expired|expired token|refresh token (?:is )?expired|code 190)\b/i, cls: 'TOKEN_EXPIRED' },
  { re: /\b(unauthorized|invalid[\s_]?token|malformed access token|revoked|40105|40102)\b/i, cls: 'AUTH_ERROR' },
  { re: /\b(401)\b/i, cls: 'AUTH_ERROR' },
  { re: /\b(user_permission_denied|caller does not have permission|insufficient (?:permission|scope)|missing (?:permission|scope)|not authorized|403)\b/i, cls: 'PERMISSION_ERROR' },
  { re: /\b(account (?:is )?(?:disabled|suspended|deactivated)|ACCOUNT_DISABLED|advertiser (?:is )?(?:disabled|suspended))\b/i, cls: 'ACCOUNT_DISABLED' },
  { re: /\b(unknown field|unexpected field|unrecognized (?:field|parameter)|schema|deprecated version|unsupported version|no longer supported)\b/i, cls: 'SCHEMA_CHANGED' },
  { re: /\b(unsupported|not supported|capability not available)\b/i, cls: 'UNSUPPORTED_CAPABILITY' },
  { re: /\b(webhook|signature (?:verification )?failed|invalid signature)\b/i, cls: 'WEBHOOK_ERROR' },
  { re: /\b(sync (?:failed|error)|dead[\s_-]?letter|ingest(?:ion)? failed)\b/i, cls: 'SYNC_ERROR' },
  { re: /\b(5\d{2})\b|\b(internal server error|bad gateway|service unavailable|gateway timeout)\b/i, cls: 'PROVIDER_5XX' },
  { re: /\b(ENOTFOUND|ECONNRESET|ECONNREFUSED|ETIMEDOUT|network|fetch failed|socket hang up|timed out)\b/i, cls: 'NETWORK_ERROR' },
  { re: /\b(400|invalid[\s_]?request|malformed|bad request|validation (?:error|failed))\b/i, cls: 'INVALID_REQUEST' },
];

export interface ClassifiedError {
  errorClass: ConnectionErrorClass;
  action: string;
  detail: string;
}

/** Classify a raw error / message into the canonical taxonomy. Returns UNKNOWN when nothing matches. */
export function classifyConnectionError(input: unknown): ClassifiedError {
  if (typeof input === 'string' && (CONNECTION_ERROR_CLASSES as readonly string[]).includes(input)) {
    const cls = input as ConnectionErrorClass;
    return { errorClass: cls, ...ERROR_REMEDIATION[cls] };
  }
  const raw = input instanceof Error ? input.message : String(input ?? '');
  for (const { re, cls } of PATTERNS) {
    if (re.test(raw)) return { errorClass: cls, ...ERROR_REMEDIATION[cls] };
  }
  return { errorClass: 'UNKNOWN', ...ERROR_REMEDIATION.UNKNOWN };
}

/** True when the error class means the tenant must reauthorize (vs. retry / escalate). */
export function errorRequiresReauth(cls: ConnectionErrorClass): boolean {
  return cls === 'AUTH_ERROR' || cls === 'TOKEN_EXPIRED' || cls === 'PERMISSION_ERROR';
}
