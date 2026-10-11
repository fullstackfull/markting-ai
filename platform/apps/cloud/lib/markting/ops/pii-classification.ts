/**
 * Phase C.6 (26) — PURE PII CLASSIFIER over arbitrary field maps. Generalizes the commerce PII
 * reduction (FORBIDDEN_PII_FIELDS) into a reusable classifier that grades each field by NAME and VALUE
 * heuristics (email/phone/card/IP regexes), emits a redaction/pseudonymization plan, and guards a
 * model-bound projection so no DIRECT_IDENTIFIER / SENSITIVE / PAYMENT field survives. Deterministic;
 * no I/O, no crypto, no network. Matches pii.ts (no 'server-only') — this is pure over its inputs.
 */
import { FORBIDDEN_PII_FIELDS } from '@/lib/markting/commerce/pii';

export type PiiClass = 'NONE' | 'LOW' | 'DIRECT_IDENTIFIER' | 'SENSITIVE' | 'PAYMENT';

/** Severity order so the strictest signal (name OR value) wins. */
const SEVERITY: Record<PiiClass, number> = { NONE: 0, LOW: 1, DIRECT_IDENTIFIER: 2, SENSITIVE: 3, PAYMENT: 4 };
const worse = (a: PiiClass, b: PiiClass): PiiClass => (SEVERITY[a] >= SEVERITY[b] ? a : b);

/** The classes that may never reach a model-bound projection (the guard tripwire). */
export const HIGH_RISK_CLASSES: readonly PiiClass[] = ['DIRECT_IDENTIFIER', 'SENSITIVE', 'PAYMENT'];
export const isHighRisk = (c: PiiClass): boolean => HIGH_RISK_CLASSES.includes(c);

// ---- NAME heuristics: segment/phrase matching (never naive substring — paymentStatus ≠ PAYMENT) ----
interface NameRule { segments: Set<string>; prefixes: string[]; phrases: string[] }
const rule = (segments: string[], prefixes: string[], phrases: string[]): NameRule => ({ segments: new Set(segments), prefixes, phrases });

/** Highest-severity first; first match wins. */
const NAME_RULES: Array<{ cls: PiiClass; rule: NameRule }> = [
  { cls: 'PAYMENT', rule: rule(['card', 'pan', 'cvv', 'cvc', 'iban', 'bic', 'swift', 'cc'], [], ['payment method', 'payment details', 'card number', 'credit card', 'card last', 'account number', 'routing number', 'sort code', 'bank account']) },
  { cls: 'SENSITIVE', rule: rule(['ssn', 'sin', 'nino', 'dob', 'health', 'medical', 'diagnosis', 'religion', 'ethnicity', 'race', 'political', 'biometric', 'genetic', 'passport', 'orientation'], [], ['date of birth', 'national id', 'social security', 'sexual orientation', 'health condition', 'tax id']) },
  { cls: 'DIRECT_IDENTIFIER', rule: rule(['email', 'phone', 'mobile', 'name', 'firstname', 'lastname', 'surname', 'fullname', 'address', 'ip', 'username', 'note', 'notes', 'comment', 'billing', 'shipping'], ['address', 'email', 'phone'], ['first name', 'last name', 'full name', 'ip address', 'phone number', 'email address', 'street address', 'customer note']) },
  { cls: 'LOW', rule: rule(['city', 'zip', 'postcode', 'postal', 'country', 'region', 'state', 'timezone', 'locale', 'gender', 'age'], [], ['postal code', 'zip code']) },
];

/** Known-PII field names from the commerce reduction — never classify any of these as NONE. */
const FORBIDDEN = new Set<string>(FORBIDDEN_PII_FIELDS.map((f) => f.replace(/[^a-z0-9]/g, '')));

/** Split a key on camelCase and non-alphanumeric boundaries into lowercased segments + joined phrase. */
function keyPhrase(key: string): { phrase: string; segments: string[]; squashed: string } {
  const spaced = key.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[^A-Za-z0-9]+/g, ' ').trim().toLowerCase();
  return { phrase: spaced, segments: spaced.split(' ').filter(Boolean), squashed: spaced.replace(/ /g, '') };
}

function classifyByName(key: string): PiiClass {
  const { phrase, segments, squashed } = keyPhrase(key);
  for (const { cls, rule } of NAME_RULES) {
    if (segments.some((s) => rule.segments.has(s) || rule.prefixes.some((p) => s.startsWith(p)))) return cls;
    if (rule.phrases.some((p) => phrase.includes(p))) return cls;
  }
  // Reuse of FORBIDDEN_PII_FIELDS: any known forbidden name never reads as NONE.
  if (FORBIDDEN.has(squashed) || segments.some((s) => FORBIDDEN.has(s))) return 'DIRECT_IDENTIFIER';
  return 'NONE';
}

// ---- VALUE heuristics: email / phone / card (Luhn) / IP ----
const EMAIL_RE = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;
const IPV4_RE = /^(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)$/;
const IPV6_RE = /^(?:[0-9a-f]{1,4}:){2,7}[0-9a-f]{0,4}$/i;

function luhn(digits: string): boolean {
  let sum = 0;
  let dbl = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    const ch = digits[i];
    if (ch === undefined) return false;
    let d = ch.charCodeAt(0) - 48;
    if (d < 0 || d > 9) return false;
    if (dbl) { d *= 2; if (d > 9) d -= 9; }
    sum += d;
    dbl = !dbl;
  }
  return sum % 10 === 0;
}

function classifyByValue(value: unknown): PiiClass {
  if (typeof value !== 'string') return 'NONE';
  const v = value.trim();
  if (v === '') return 'NONE';
  if (EMAIL_RE.test(v)) return 'DIRECT_IDENTIFIER';
  const digits = v.replace(/[\s().-]/g, '');
  if (/^\+?\d{13,19}$/.test(digits) && luhn(digits.replace(/^\+/, ''))) return 'PAYMENT';
  if (IPV4_RE.test(v) || (v.includes(':') && IPV6_RE.test(v))) return 'DIRECT_IDENTIFIER';
  if (/^\+?\d[\d\s().-]{5,}\d$/.test(v) && digits.replace(/^\+/, '').length >= 7 && digits.replace(/^\+/, '').length <= 15) return 'DIRECT_IDENTIFIER';
  return 'NONE';
}

export interface FieldClassification {
  field: string;
  class: PiiClass;
  matchedBy: 'none' | 'name' | 'value' | 'both';
  reason: string;
}

/** Classify a single field by its name and (optionally) its value. Deterministic. */
export function classifyField(field: string, value?: unknown): FieldClassification {
  const byName = classifyByName(field);
  const byValue = classifyByValue(value);
  const cls = worse(byName, byValue);
  const nameHit = byName !== 'NONE';
  const valueHit = byValue !== 'NONE';
  const matchedBy = nameHit && valueHit ? 'both' : nameHit ? 'name' : valueHit ? 'value' : 'none';
  const reason = cls === 'NONE'
    ? 'no PII signal in field name or value'
    : `${cls} via ${matchedBy === 'both' ? `name (${byName}) and value (${byValue})` : matchedBy === 'name' ? 'field name' : 'field value'}`;
  return { field, class: cls, matchedBy, reason };
}

/** Classify every field in a flat or nested map. Nested objects are flattened with dotted paths. */
export function classifyMap(record: Record<string, unknown>): FieldClassification[] {
  const out: FieldClassification[] = [];
  const walk = (obj: Record<string, unknown>, prefix: string): void => {
    for (const [k, v] of Object.entries(obj)) {
      const path = prefix ? `${prefix}.${k}` : k;
      if (v && typeof v === 'object' && !Array.isArray(v)) { walk(v as Record<string, unknown>, path); continue; }
      out.push(classifyField(path, Array.isArray(v) ? v.find((x) => typeof x === 'string') : v));
    }
  };
  walk(record, '');
  return out;
}

export type RedactionAction = 'KEEP' | 'MASK' | 'PSEUDONYMIZE' | 'DROP';
export interface RedactionPlanItem { field: string; class: PiiClass; action: RedactionAction; reason: string }

const ACTION_FOR: Record<PiiClass, RedactionAction> = {
  NONE: 'KEEP', LOW: 'MASK', DIRECT_IDENTIFIER: 'PSEUDONYMIZE', SENSITIVE: 'DROP', PAYMENT: 'DROP',
};

/** A deterministic, reviewable redaction/pseudonymization plan for a field map. Performs no mutation. */
export function redactionPlan(record: Record<string, unknown>): RedactionPlanItem[] {
  return classifyMap(record).map((c) => ({
    field: c.field,
    class: c.class,
    action: ACTION_FOR[c.class],
    reason: c.class === 'NONE' ? 'retain — no PII' : `${ACTION_FOR[c.class]} — ${c.reason}`,
  }));
}

export interface ProjectionGuardResult { safe: boolean; violations: Array<{ field: string; class: PiiClass }> }

/** Guard: assert a model-bound projection carries NO DIRECT_IDENTIFIER / SENSITIVE / PAYMENT field. */
export function assertSafeProjection(record: Record<string, unknown>): ProjectionGuardResult {
  const violations = classifyMap(record)
    .filter((c) => isHighRisk(c.class))
    .map((c) => ({ field: c.field, class: c.class }));
  return { safe: violations.length === 0, violations };
}

/** Throwing variant for call sites that must fail closed. */
export function assertNoHighRiskFields(record: Record<string, unknown>): void {
  const { safe, violations } = assertSafeProjection(record);
  if (!safe) throw new Error(`PII guard tripped: ${violations.map((v) => `${v.field}=${v.class}`).join(', ')}`);
}
