import 'server-only';
import { RUNTIME_MODES, type RuntimeMode } from '../runtime-mode';
import { DEFAULT_BUDGET_CONFIG, type BudgetConfig } from './cost-budgets';
import { DEFAULT_GLOBAL_POLICY, DEFAULT_RATE_POLICY, type RatePolicy } from './rate-limit-policy';

/**
 * PHASE C.6 (38) — CANONICAL SAFE DEFAULTS + opt-in guard.
 *
 * The one source of truth for the DANGEROUS-OFF defaults every deployment starts from: runtime mode
 * DEMO, Mode B HELD, autonomous optimization DISABLED, provider writes OFF, live model OFF, the global
 * write kill default-HALTED, conservative rate-limit/cost-budget defaults, and non-verbose logging.
 * `assertSafeDefaults` is PURE/deterministic — it inspects an INJECTED effective-config map (never the
 * live process env, never a secret) and reports every default that has been flipped to its dangerous
 * state without an explicit, audited opt-in. Autonomous WRITE cannot even be represented as ON here
 * (its default type has exactly one inhabitant), mirroring runtime-mode's missing FULL_AUTONOMOUS_WRITE.
 */

// ---- log levels (safe default is non-verbose) ----
export const LOG_LEVELS = ['error', 'warn', 'info', 'debug', 'trace'] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];
/** Levels that emit request/payload detail — forbidden as a production default. */
export const VERBOSE_LOG_LEVELS: ReadonlySet<LogLevel> = new Set(['debug', 'trace']);

// ---- type-level guard: an autonomous-write default ON is unrepresentable ----
/**
 * The autonomous-optimization DEFAULT type has a SINGLE inhabitant. There is deliberately no
 * `'ENABLED'` member, so no configuration literal, cast-free, can express "autonomous writes default
 * ON" at the type level — the dangerous default cannot be written down, only a runtime opt-in path exists.
 */
export type AutonomousOptimizationDefault = 'DISABLED';
export type ModeBDefault = 'HELD';
export type ProviderWritesDefault = 'OFF';
export type LiveModelDefault = 'OFF';

/** The canonical safe-default set. Frozen so it cannot be mutated into an unsafe state at runtime. */
export interface SafeDefaults {
  readonly runtimeMode: RuntimeMode;
  readonly modeB: ModeBDefault;
  readonly autonomousOptimization: AutonomousOptimizationDefault;
  readonly providerWrites: ProviderWritesDefault;
  readonly liveModel: LiveModelDefault;
  /** Kill-switch default-safe: the GLOBAL write path starts HALTED until an operator clears it. */
  readonly globalWriteHalted: boolean;
  readonly logLevel: LogLevel;
  readonly rateLimit: { readonly perOrgProvider: RatePolicy; readonly global: RatePolicy };
  readonly costBudget: BudgetConfig;
}

export const SAFE_DEFAULTS: SafeDefaults = Object.freeze({
  runtimeMode: 'DEMO',
  modeB: 'HELD',
  autonomousOptimization: 'DISABLED',
  providerWrites: 'OFF',
  liveModel: 'OFF',
  globalWriteHalted: true,
  logLevel: 'info',
  rateLimit: { perOrgProvider: DEFAULT_RATE_POLICY, global: DEFAULT_GLOBAL_POLICY },
  costBudget: DEFAULT_BUDGET_CONFIG,
});

// ---- audited opt-in ----
/** A dangerous toggle may only deviate from its safe default with a complete audited opt-in. */
export const DANGEROUS_TOGGLES = [
  'liveRuntimeMode', 'modeB', 'providerWrites', 'liveModel', 'clearGlobalWriteHalt', 'verboseLogging',
] as const;
export type DangerousToggle = (typeof DANGEROUS_TOGGLES)[number];

export interface AuditedOptIn {
  approvedBy: string;
  ticket: string;
  reason: string;
  at: string;
}

/** An opt-in is honored only when every field is a non-empty string (no blank audit trail). */
export function isCompleteOptIn(o: AuditedOptIn | undefined): o is AuditedOptIn {
  return !!o && [o.approvedBy, o.ticket, o.reason, o.at].every((v) => typeof v === 'string' && v.trim().length > 0);
}

/**
 * The effective runtime config to audit. Every field is OPTIONAL: an absent field is read as its safe
 * default (so an empty map is fully safe). `autonomousOptimization` accepts the dangerous literal so a
 * misconfiguration can be DETECTED and rejected — it is never a legal default.
 */
export interface EffectiveRuntimeConfig {
  runtimeMode?: RuntimeMode;
  modeB?: 'HELD' | 'ENABLED';
  autonomousOptimization?: 'DISABLED' | 'ENABLED';
  providerWrites?: 'OFF' | 'ON';
  liveModel?: 'OFF' | 'ON';
  globalWriteHalted?: boolean;
  logLevel?: LogLevel;
  optIns?: Partial<Record<DangerousToggle, AuditedOptIn>>;
}

export type ViolationSeverity = 'CRITICAL' | 'HIGH';
export interface SafeDefaultViolation {
  toggle: DangerousToggle | 'autonomousOptimization';
  severity: ViolationSeverity;
  reason: string;
}

export interface SafeDefaultsReport {
  safe: boolean;
  violations: SafeDefaultViolation[];
}

/**
 * Audit an effective config against the canonical safe defaults. PURE and deterministic. A dangerous
 * flip is a violation UNLESS a complete audited opt-in accompanies it. Autonomous optimization ENABLED
 * is ALWAYS a CRITICAL violation — no opt-in can clear it in this phase (there is no governed
 * autonomous-write path), so the guard cannot be talked around at runtime either.
 */
export function assertSafeDefaults(config: EffectiveRuntimeConfig = {}): SafeDefaultsReport {
  const violations: SafeDefaultViolation[] = [];
  const optIns = config.optIns ?? {};
  const optedIn = (t: DangerousToggle): boolean => isCompleteOptIn(optIns[t]);

  // Autonomous optimization: no legal ENABLED state. Not clearable by opt-in.
  if (config.autonomousOptimization === 'ENABLED') {
    violations.push({
      toggle: 'autonomousOptimization',
      severity: 'CRITICAL',
      reason: 'autonomous optimization ENABLED is not a representable safe default; no governed autonomous-write path exists',
    });
  }

  // Runtime mode: any non-DEMO mode is a live deployment and needs an audited opt-in.
  if (config.runtimeMode !== undefined && config.runtimeMode !== SAFE_DEFAULTS.runtimeMode && !optedIn('liveRuntimeMode')) {
    violations.push({
      toggle: 'liveRuntimeMode',
      severity: 'CRITICAL',
      reason: `runtime mode ${config.runtimeMode} deviates from the DEMO default without an audited opt-in`,
    });
  }

  if (config.modeB === 'ENABLED' && !optedIn('modeB')) {
    violations.push({ toggle: 'modeB', severity: 'CRITICAL', reason: 'Mode B must stay HELD without an audited opt-in' });
  }
  if (config.providerWrites === 'ON' && !optedIn('providerWrites')) {
    violations.push({ toggle: 'providerWrites', severity: 'CRITICAL', reason: 'provider writes must stay OFF without an audited opt-in' });
  }
  if (config.liveModel === 'ON' && !optedIn('liveModel')) {
    violations.push({ toggle: 'liveModel', severity: 'HIGH', reason: 'live model must stay OFF without an audited opt-in' });
  }
  if (config.globalWriteHalted === false && !optedIn('clearGlobalWriteHalt')) {
    violations.push({ toggle: 'clearGlobalWriteHalt', severity: 'CRITICAL', reason: 'the global write kill-switch must stay HALTED without an audited opt-in' });
  }
  if (config.logLevel !== undefined && VERBOSE_LOG_LEVELS.has(config.logLevel) && !optedIn('verboseLogging')) {
    violations.push({ toggle: 'verboseLogging', severity: 'HIGH', reason: `verbose log level ${config.logLevel} must not be a default without an audited opt-in` });
  }

  return { safe: violations.length === 0, violations };
}

/** Throwing variant: raises on any violation, with an operator-safe (secret-free) message. */
export function assertSafeDefaultsOrThrow(config: EffectiveRuntimeConfig = {}): void {
  const report = assertSafeDefaults(config);
  if (!report.safe) {
    const summary = report.violations.map((v) => `${v.toggle} [${v.severity}]: ${v.reason}`).join('; ');
    throw new Error(`Unsafe default(s) detected: ${summary}`);
  }
}

/** Convenience: assert the canonical defaults themselves are internally safe (used as a self-check). */
export function safeDefaultsSelfCheck(): SafeDefaultsReport {
  return assertSafeDefaults({
    runtimeMode: SAFE_DEFAULTS.runtimeMode,
    modeB: SAFE_DEFAULTS.modeB,
    autonomousOptimization: SAFE_DEFAULTS.autonomousOptimization,
    providerWrites: SAFE_DEFAULTS.providerWrites,
    liveModel: SAFE_DEFAULTS.liveModel,
    globalWriteHalted: SAFE_DEFAULTS.globalWriteHalted,
    logLevel: SAFE_DEFAULTS.logLevel,
  });
}

/** The runtime modes that imply a LIVE deployment (anything but DEMO), for opt-in messaging. */
export const LIVE_RUNTIME_MODES: readonly RuntimeMode[] = RUNTIME_MODES.filter((m) => m !== 'DEMO');
