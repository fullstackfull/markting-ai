/**
 * Phase C.6 (28) — FEATURE-FLAG PRODUCTION SAFETY. A typed flag registry with explicit production
 * defaults (default-OFF for risky flags), an environment guard (a flag that must never be ON in
 * production is forced off + flagged), a kill-flag that disables a feature instantly, and an audit
 * record for every change. Pure over an injected store + clock. Risky capabilities — any live-write /
 * autonomous-optimization / live-model flag — are HARD-PINNED OFF and cannot be enabled from here
 * (compile-time EnableableFlagKey + runtime guard), honoring Mode B HELD and autonomous optimization
 * DISABLED. No network; no autonomous enablement. Pure module (no 'server-only').
 */

export type FlagCategory = 'live_write' | 'autonomous_optimization' | 'live_model' | 'ui' | 'experiment' | 'ops' | 'rollout';
export type FlagEnv = 'development' | 'staging' | 'production';

/** Categories that are hard-pinned OFF: they can never be enabled through this module. */
export const HARD_PINNED_CATEGORIES = ['live_write', 'autonomous_optimization', 'live_model'] as const;
type RiskyCategory = (typeof HARD_PINNED_CATEGORIES)[number];

export interface FlagSpec {
  description: string;
  category: FlagCategory;
  /** The value a flag takes in production when nothing overrides it. Risky flags are always false. */
  productionDefault: boolean;
  /** Risky = default-OFF and reviewed carefully; a superset of (but not identical to) hard-pinned. */
  risky: boolean;
}

/**
 * The single source of truth for flags this surface governs. Risky capabilities are hard-pinned OFF
 * (live provider writes, autonomous optimization, live model calls); the rest are ordinary product
 * gates. Flags are product gating, NEVER security authorization.
 */
export const FLAG_REGISTRY = {
  live_provider_writes: { description: 'Apply writes to live provider accounts (Mode B).', category: 'live_write', productionDefault: false, risky: true },
  autonomous_budget_optimization: { description: 'Let the system change budgets without human approval.', category: 'autonomous_optimization', productionDefault: false, risky: true },
  autonomous_bidding: { description: 'Autonomous bid/target adjustments without approval.', category: 'autonomous_optimization', productionDefault: false, risky: true },
  live_model_calls: { description: 'Call external LLM providers at runtime.', category: 'live_model', productionDefault: false, risky: true },
  new_commerce_ui: { description: 'New commerce dashboard surface.', category: 'ui', productionDefault: false, risky: false },
  reporting_v2: { description: 'Second-generation reporting pipeline.', category: 'experiment', productionDefault: false, risky: true },
  verbose_ops_logging: { description: 'Extra operator diagnostics in the admin console.', category: 'ops', productionDefault: true, risky: false },
  staged_provider_rollout: { description: 'Gradual rollout wrapper for a newly onboarded provider.', category: 'rollout', productionDefault: false, risky: false },
} as const satisfies Record<string, FlagSpec>;

export type FlagKey = keyof typeof FLAG_REGISTRY;

/** Compile-time guard: keys whose category is risky (hard-pinned) are excluded from enableFlag(). */
export type EnableableFlagKey = { [K in FlagKey]: (typeof FLAG_REGISTRY)[K]['category'] extends RiskyCategory ? never : K }[FlagKey];

export function getFlagSpec(key: FlagKey): FlagSpec { return FLAG_REGISTRY[key]; }
export function isHardPinnedOff(key: FlagKey): boolean { return (HARD_PINNED_CATEGORIES as readonly string[]).includes(FLAG_REGISTRY[key].category); }
export function listHardPinnedFlags(): FlagKey[] { return (Object.keys(FLAG_REGISTRY) as FlagKey[]).filter(isHardPinnedOff); }

export interface FlagAudit { flag: FlagKey; from: boolean; to: boolean; actor: string; reason: string; at: string }

export interface FlagStatePort {
  getState(key: FlagKey): Promise<boolean | undefined>;
  setState(key: FlagKey, on: boolean): Promise<void>;
  appendAudit(record: FlagAudit): Promise<void>;
  listAudit(): Promise<FlagAudit[]>;
}

export interface Clock { now(): string }

/** Raised when a hard-pinned (risky) flag is asked to turn ON. */
export class FlagSafetyError extends Error {}

/** Resolve the EFFECTIVE value of a flag for an environment, applying the production force-off guard. */
export function resolveFlag(key: FlagKey, requested: boolean | undefined, env: FlagEnv): { key: FlagKey; effective: boolean; forcedOff: boolean; reason: string } {
  const spec = FLAG_REGISTRY[key];
  const want = requested ?? (env === 'production' ? spec.productionDefault : true);
  if (env === 'production' && isHardPinnedOff(key)) {
    return { key, effective: false, forcedOff: want, reason: `hard-pinned OFF in production (${spec.category}) — risky capability cannot be enabled` };
  }
  return { key, effective: want, forcedOff: false, reason: want ? 'enabled' : 'disabled' };
}

/** Resolve every registered flag for an environment. Deterministic. */
export async function effectiveFlags(store: FlagStatePort, env: FlagEnv): Promise<Array<{ key: FlagKey; effective: boolean; forcedOff: boolean; reason: string }>> {
  const out: Array<{ key: FlagKey; effective: boolean; forcedOff: boolean; reason: string }> = [];
  for (const key of Object.keys(FLAG_REGISTRY) as FlagKey[]) {
    const stored = await store.getState(key);
    out.push(resolveFlag(key, stored, env));
  }
  return out;
}

async function currentValue(store: FlagStatePort, key: FlagKey): Promise<boolean> {
  const stored = await store.getState(key);
  return stored ?? FLAG_REGISTRY[key].productionDefault;
}

/**
 * Set any flag's stored value. Enabling a hard-pinned (risky) flag is REFUSED (runtime guard honoring
 * Mode B HELD / autonomous optimization DISABLED). In production, a hard-pinned flag is force-pinned to
 * OFF regardless of request. Every change writes an audit record.
 */
export async function setFlag(
  store: FlagStatePort,
  clock: Clock,
  key: FlagKey,
  on: boolean,
  actor: string,
  reason: string,
): Promise<FlagAudit> {
  if (on && isHardPinnedOff(key)) {
    throw new FlagSafetyError(`${key} is hard-pinned OFF (${FLAG_REGISTRY[key].category}) and cannot be enabled from here`);
  }
  const from = await currentValue(store, key);
  const to = on;
  await store.setState(key, to);
  const record: FlagAudit = { flag: key, from, to, actor, reason, at: clock.now() };
  await store.appendAudit(record);
  return record;
}

/**
 * Enable a NON-risky flag. The key type (EnableableFlagKey) excludes hard-pinned categories at COMPILE
 * TIME, so a risky flag cannot even be passed here.
 */
export async function enableFlag(store: FlagStatePort, clock: Clock, key: EnableableFlagKey, actor: string, reason: string): Promise<FlagAudit> {
  return setFlag(store, clock, key, true, actor, reason);
}

/** Kill-flag: disable a feature INSTANTLY. Always permitted (turning OFF is always safe). */
export async function killFlag(store: FlagStatePort, clock: Clock, key: FlagKey, actor: string, reason: string): Promise<FlagAudit> {
  const from = await currentValue(store, key);
  await store.setState(key, false);
  const record: FlagAudit = { flag: key, from, to: false, actor, reason: `KILL: ${reason}`, at: clock.now() };
  await store.appendAudit(record);
  return record;
}

// ---- In-memory fakes (tests / local) ----
export class InMemoryFlagStore implements FlagStatePort {
  private state = new Map<FlagKey, boolean>();
  private audit: FlagAudit[] = [];
  constructor(seed: Partial<Record<FlagKey, boolean>> = {}) {
    for (const [k, v] of Object.entries(seed) as Array<[FlagKey, boolean]>) this.state.set(k, v);
  }
  async getState(key: FlagKey): Promise<boolean | undefined> { return this.state.get(key); }
  async setState(key: FlagKey, on: boolean): Promise<void> { this.state.set(key, on); }
  async appendAudit(record: FlagAudit): Promise<void> { this.audit.push(record); }
  async listAudit(): Promise<FlagAudit[]> { return [...this.audit]; }
}

export class FixedClock implements Clock {
  constructor(private at: string) {}
  now(): string { return this.at; }
}
