import 'server-only';
import { redactLog } from './observability';

/**
 * PHASE C.6 (32) — AI OUTPUT VALIDATOR (pure, no network).
 *
 * Model OUTPUT is UNTRUSTED until it clears this gate. A pure validator over an injected spec that runs:
 * JSON-shape/schema validation, required-field + enum checks, numeric-range sanity, a refusal/empty-output
 * detector, a prompt-injection-echo / instruction-leak detector, and a secret-leak scan (reusing the
 * `redactLog` secret vocabulary). It returns `{valid, violations[], safeOutput?}` — invalid output is
 * QUARANTINED (no `safeOutput`) and never passed through. Deterministic; no I/O.
 */

export type OutputFieldType = 'string' | 'number' | 'boolean' | 'array' | 'object';

export interface OutputFieldSpec {
  name: string;
  type: OutputFieldType;
  required?: boolean;
  /** Allowed values (for string/number fields). */
  enum?: ReadonlyArray<string | number>;
  /** Inclusive numeric bounds (number fields only). */
  min?: number;
  max?: number;
}

export interface OutputSpec {
  format: 'json' | 'text';
  /** For `json`: the top-level object fields to validate. */
  fields?: ReadonlyArray<OutputFieldSpec>;
  /** For `text`: minimum trimmed length to count as non-empty (default 1). */
  minLength?: number;
}

export type ViolationCode =
  | 'EMPTY_OUTPUT'
  | 'REFUSAL'
  | 'INVALID_JSON'
  | 'NOT_OBJECT'
  | 'MISSING_FIELD'
  | 'WRONG_TYPE'
  | 'ENUM_VIOLATION'
  | 'RANGE_VIOLATION'
  | 'INJECTION_ECHO'
  | 'INSTRUCTION_LEAK'
  | 'SECRET_LEAK';

export interface Violation {
  code: ViolationCode;
  field?: string;
  detail: string;
}

export interface ValidationResult<T = unknown> {
  valid: boolean;
  violations: Violation[];
  /** The validated, parsed output — present ONLY when valid. Invalid output is withheld (quarantined). */
  safeOutput?: T;
}

// ---- detectors ----
const REFUSAL_PATTERNS = [
  /\bi(?:'m| am) (?:sorry|unable|not able)\b/i,
  /\bi (?:cannot|can't|can not|won't|will not)\b/i,
  /\bi(?:'m| am) just an (?:ai|assistant)\b/i,
  /\bas an ai (?:language )?model\b/i,
  /\bi(?:'m| am) not able to (?:help|assist|comply)\b/i,
  /\bi (?:must|have to) (?:decline|refuse)\b/i,
];

const INJECTION_PATTERNS = [
  /\bignore (?:all |any |the )?(?:previous|prior|above|earlier) (?:instructions|prompts?|messages?)\b/i,
  /\bdisregard (?:all |any |the )?(?:previous|prior|above) (?:instructions|rules)\b/i,
  /\byou are now\b/i,
  /\bnew instructions?:/i,
  /\bdeveloper mode\b/i,
  /\bjailbreak\b/i,
];

const INSTRUCTION_LEAK_PATTERNS = [
  /\bsystem prompt\b/i,
  /\byour (?:system )?instructions (?:are|were)\b/i,
  /\bthe (?:system|developer) message\b/i,
  /\byou were (?:told|instructed) to\b/i,
  /<\s*system\s*>/i,
];

const SECRET_TEXT_PATTERNS = [
  /\bsk-[A-Za-z0-9]{8,}\b/,
  /\bbearer\s+[A-Za-z0-9._-]{12,}\b/i,
  /\b(?:api[_-]?key|access[_-]?token|refresh[_-]?token|secret|password)\s*[:=]\s*\S+/i,
  /\bAKIA[0-9A-Z]{12,}\b/,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
];

function anyMatch(patterns: RegExp[], text: string): boolean {
  return patterns.some((p) => p.test(text));
}

/** True when `redactLog` would redact a key anywhere in the object (reuses its secret vocabulary). */
function objectHasSecretKey(obj: unknown): boolean {
  return JSON.stringify(redactLog(obj)).includes('[REDACTED]');
}

function typeOf(v: unknown): OutputFieldType | 'null' | 'undefined' {
  if (v === null) return 'null';
  if (v === undefined) return 'undefined';
  if (Array.isArray(v)) return 'array';
  const t = typeof v;
  if (t === 'string' || t === 'number' || t === 'boolean' || t === 'object') return t;
  return 'object';
}

/**
 * Validate one model output string against the spec. The scan order puts cheap, categorical rejects first
 * (empty / refusal / injection / leaks) before structural checks, and `safeOutput` is set only when zero
 * violations remain — so invalid output is never returned to the caller.
 */
export function validateAIOutput<T = unknown>(raw: string, spec: OutputSpec): ValidationResult<T> {
  const violations: Violation[] = [];
  const text = raw ?? '';
  const trimmed = text.trim();

  // Empty / refusal — the output carries no usable content.
  if (trimmed.length < (spec.format === 'text' ? spec.minLength ?? 1 : 1)) {
    violations.push({ code: 'EMPTY_OUTPUT', detail: 'output is empty or below minimum length' });
  }
  if (anyMatch(REFUSAL_PATTERNS, trimmed)) {
    violations.push({ code: 'REFUSAL', detail: 'output looks like a refusal, not an answer' });
  }

  // Safety scans on the raw text (always run, even for json).
  if (anyMatch(INJECTION_PATTERNS, text)) {
    violations.push({ code: 'INJECTION_ECHO', detail: 'output echoes prompt-injection phrasing' });
  }
  if (anyMatch(INSTRUCTION_LEAK_PATTERNS, text)) {
    violations.push({ code: 'INSTRUCTION_LEAK', detail: 'output appears to leak system/developer instructions' });
  }
  if (anyMatch(SECRET_TEXT_PATTERNS, text)) {
    violations.push({ code: 'SECRET_LEAK', detail: 'output contains a secret-looking token' });
  }

  let parsed: unknown = trimmed;
  if (spec.format === 'json') {
    let obj: unknown;
    try {
      obj = JSON.parse(trimmed);
    } catch {
      violations.push({ code: 'INVALID_JSON', detail: 'output is not valid JSON' });
      return { valid: false, violations };
    }
    parsed = obj;
    if (typeOf(obj) !== 'object') {
      violations.push({ code: 'NOT_OBJECT', detail: 'top-level JSON is not an object' });
    } else {
      // Secret-key scan on the structured object (reuses redactLog semantics).
      if (objectHasSecretKey(obj)) {
        violations.push({ code: 'SECRET_LEAK', field: '*', detail: 'object contains a secret-looking key' });
      }
      const rec = obj as Record<string, unknown>;
      for (const f of spec.fields ?? []) {
        const present = Object.prototype.hasOwnProperty.call(rec, f.name) && rec[f.name] !== undefined && rec[f.name] !== null;
        if (!present) {
          if (f.required) violations.push({ code: 'MISSING_FIELD', field: f.name, detail: `required field '${f.name}' missing` });
          continue;
        }
        const val = rec[f.name];
        if (typeOf(val) !== f.type) {
          violations.push({ code: 'WRONG_TYPE', field: f.name, detail: `field '${f.name}' expected ${f.type}, got ${typeOf(val)}` });
          continue;
        }
        if (f.enum && !f.enum.includes(val as string | number)) {
          violations.push({ code: 'ENUM_VIOLATION', field: f.name, detail: `field '${f.name}' not in allowed set` });
        }
        if (f.type === 'number' && typeof val === 'number') {
          if (!Number.isFinite(val)) {
            violations.push({ code: 'RANGE_VIOLATION', field: f.name, detail: `field '${f.name}' is not finite` });
          } else if ((f.min != null && val < f.min) || (f.max != null && val > f.max)) {
            violations.push({ code: 'RANGE_VIOLATION', field: f.name, detail: `field '${f.name}' out of [${f.min ?? '-inf'}, ${f.max ?? '+inf'}]` });
          }
        }
      }
    }
  }

  const valid = violations.length === 0;
  return valid ? { valid, violations, safeOutput: parsed as T } : { valid, violations };
}
