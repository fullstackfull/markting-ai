import 'server-only';
import type { RuntimeMode } from '../runtime-mode';
import { SAFE_DEFAULTS } from './safe-defaults';

/**
 * PHASE C.6 (36) — DEPLOYMENT-READINESS MODEL (fail-closed).
 *
 * A PURE checklist evaluator over INJECTED deployment facts (never probing anything, never reading a
 * secret). It produces `{ ready, checks:[{id,severity,pass,reason}] }`. The readiness gate FAILS
 * CLOSED: any CRITICAL fact that is unknown/absent leaves the check `pass:false` and the deployment NOT
 * ready — readiness is never assumed. Security-header and secure-cookie expectations are
 * DOCUMENTATION_DERIVED constants, so the model states the target posture without reaching for live infra.
 */

// ---- documentation-derived hardening expectations ----
/** Response headers every production response must carry. */
export const REQUIRED_SECURITY_HEADERS = [
  'Strict-Transport-Security',
  'Content-Security-Policy',
  'X-Content-Type-Options',
  'X-Frame-Options',
  'Referrer-Policy',
] as const;
export type SecurityHeader = (typeof REQUIRED_SECURITY_HEADERS)[number];

/** The expected flags on every session/auth cookie in production. */
export const SECURE_COOKIE_FLAGS = Object.freeze({ secure: true, httpOnly: true, sameSite: 'lax' as const });

/** Runtime modes considered acceptable for a LIVE production deployment (DEMO is fine for staging). */
export const PRODUCTION_SAFE_RUNTIME_MODES: readonly RuntimeMode[] = [
  'DEMO',
  'LIVE_READ_ONLY',
  'LIVE_RECOMMENDATIONS',
  'LIVE_WRITE_DISABLED',
  'LIVE_WRITE_APPROVAL_ONLY',
];

export type CheckSeverity = 'CRITICAL' | 'WARNING';

export interface ReadinessCheck {
  id: string;
  severity: CheckSeverity;
  pass: boolean;
  /** 'ok' | 'not_satisfied' | 'unknown' | a short code. Never a secret or infra detail. */
  reason: string;
}

export interface DeploymentReadiness {
  ready: boolean;
  checks: ReadinessCheck[];
}

/**
 * Injected deployment facts. Every field is OPTIONAL — an absent fact for a CRITICAL check reads as
 * UNKNOWN and fails closed. Booleans are "is the safe condition satisfied?".
 */
export interface DeploymentFacts {
  /** Required configuration/env shape has validated (see config-validation.ts). */
  requiredConfigValid?: boolean;
  httpsEnforced?: boolean;
  secureCookies?: boolean;
  /** Row-level security is enabled on tenant tables. */
  rlsEnabled?: boolean;
  backupsConfigured?: boolean;
  migrationsApplied?: boolean;
  /** The kill-switch default is safe (global write path starts HALTED). */
  killSwitchDefaultSafe?: boolean;
  modeBHeld?: boolean;
  autonomousOptimizationDisabled?: boolean;
  /** No debug/verbose logging in production. */
  debugDisabled?: boolean;
  runtimeMode?: RuntimeMode;
  /** Per-header presence map; a header absent from the map is treated as absent (unknown). */
  securityHeaders?: Partial<Record<SecurityHeader, boolean>>;
  /** Advisory: a readiness/health probe endpoint is exposed (see health.ts). */
  readinessProbeExposed?: boolean;
}

export interface ReadinessOptions {
  /** 'production' applies the strict posture; 'staging' downgrades the live-mode header checks. */
  profile?: 'production' | 'staging';
}

/** A boolean fact → check: unknown (absent) fails closed; false is not_satisfied; true is ok. */
function boolCheck(id: string, severity: CheckSeverity, fact: boolean | undefined): ReadinessCheck {
  if (fact === undefined) return { id, severity, pass: false, reason: 'unknown' };
  return { id, severity, pass: fact, reason: fact ? 'ok' : 'not_satisfied' };
}

/**
 * Evaluate deployment readiness from injected facts. PURE/deterministic. `ready` is true only when
 * EVERY CRITICAL check passes; WARNING checks never block readiness but are reported.
 */
export function evaluateDeploymentReadiness(facts: DeploymentFacts, opts: ReadinessOptions = {}): DeploymentReadiness {
  const profile = opts.profile ?? 'production';
  const checks: ReadinessCheck[] = [];

  checks.push(boolCheck('required_config_valid', 'CRITICAL', facts.requiredConfigValid));
  checks.push(boolCheck('https_enforced', 'CRITICAL', facts.httpsEnforced));
  checks.push(boolCheck('secure_cookies', 'CRITICAL', facts.secureCookies));
  checks.push(boolCheck('rls_enabled', 'CRITICAL', facts.rlsEnabled));
  checks.push(boolCheck('backups_configured', 'CRITICAL', facts.backupsConfigured));
  checks.push(boolCheck('migrations_applied', 'CRITICAL', facts.migrationsApplied));
  checks.push(boolCheck('kill_switch_default_safe', 'CRITICAL', facts.killSwitchDefaultSafe));
  checks.push(boolCheck('mode_b_held', 'CRITICAL', facts.modeBHeld));
  checks.push(boolCheck('autonomous_optimization_disabled', 'CRITICAL', facts.autonomousOptimizationDisabled));
  checks.push(boolCheck('debug_disabled', 'CRITICAL', facts.debugDisabled));

  // Runtime mode: unknown fails closed; an unrecognized/unsafe mode fails; otherwise ok.
  checks.push(
    facts.runtimeMode === undefined
      ? { id: 'runtime_mode_production_safe', severity: 'CRITICAL', pass: false, reason: 'unknown' }
      : {
          id: 'runtime_mode_production_safe',
          severity: 'CRITICAL',
          pass: PRODUCTION_SAFE_RUNTIME_MODES.includes(facts.runtimeMode),
          reason: PRODUCTION_SAFE_RUNTIME_MODES.includes(facts.runtimeMode) ? 'ok' : 'unsafe_mode',
        },
  );

  // Security headers: every required header must be explicitly present. Absent map OR any missing
  // header fails closed. Severity is CRITICAL in production, WARNING on staging.
  const headerSeverity: CheckSeverity = profile === 'production' ? 'CRITICAL' : 'WARNING';
  if (facts.securityHeaders === undefined) {
    checks.push({ id: 'security_headers', severity: headerSeverity, pass: false, reason: 'unknown' });
  } else {
    const headers = facts.securityHeaders;
    const missing = REQUIRED_SECURITY_HEADERS.filter((h) => headers[h] !== true);
    checks.push({
      id: 'security_headers',
      severity: headerSeverity,
      pass: missing.length === 0,
      reason: missing.length === 0 ? 'ok' : `missing:${missing.length}`,
    });
  }

  // Advisory probe exposure — WARNING only, never blocks readiness.
  checks.push(boolCheck('readiness_probe_exposed', 'WARNING', facts.readinessProbeExposed));

  const ready = checks.filter((c) => c.severity === 'CRITICAL').every((c) => c.pass);
  return { ready, checks };
}

/**
 * The fail-closed readiness GATE. Returns true only when every CRITICAL check passes. An empty/partial
 * facts object is therefore NOT ready — readiness is never assumed from missing information.
 */
export function readinessGate(facts: DeploymentFacts, opts?: ReadinessOptions): boolean {
  return evaluateDeploymentReadiness(facts, opts).ready;
}

/** The failing critical checks, for an operator-facing "why not ready" summary (no secrets). */
export function blockingChecks(readiness: DeploymentReadiness): ReadinessCheck[] {
  return readiness.checks.filter((c) => c.severity === 'CRITICAL' && !c.pass);
}

/**
 * The safe-default expectations deployment facts SHOULD reflect, derived from the canonical safe-default
 * set so the deployment model and the runtime defaults can never silently diverge.
 */
export const EXPECTED_SAFE_DEPLOYMENT = Object.freeze({
  modeBHeld: SAFE_DEFAULTS.modeB === 'HELD',
  autonomousOptimizationDisabled: SAFE_DEFAULTS.autonomousOptimization === 'DISABLED',
  killSwitchDefaultSafe: SAFE_DEFAULTS.globalWriteHalted,
});
