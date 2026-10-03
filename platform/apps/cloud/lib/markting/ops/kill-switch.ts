/**
 * Phase 7F — production KILL SWITCH / EMERGENCY LOCK. A kill switch stops NEW provider writes
 * immediately at five scopes (GLOBAL / ORGANIZATION / PROVIDER / ACCOUNT / ACTION_TYPE). Read/analysis
 * continues unless explicitly disabled. State lives in cluster-safe authoritative storage (the DB — a
 * `markting_kill_switches` row), NEVER the local filesystem, so every node sees the same state and it
 * does not depend on model availability. Every change is audited (change-management record).
 */
export const KILL_SCOPES = ['GLOBAL', 'ORGANIZATION', 'PROVIDER', 'ACCOUNT', 'ACTION_TYPE'] as const;
export type KillScope = (typeof KILL_SCOPES)[number];

export interface KillSwitch {
  scope: KillScope;
  /** The scoped key: org id, provider id, account id, or action type. Empty for GLOBAL. */
  key: string;
  active: boolean;
  /** When true, also blocks read/analysis (default blocks WRITES only). */
  blocksReads?: boolean;
  reason?: string;
  setBy?: string;
  setAt?: string;
}

export interface WriteContext { organizationId: string; provider: string; accountId: string; actionType: string }

/** Which kill-switch keys could block a given write, in evaluation order (most specific last). */
export function relevantSwitches(ctx: WriteContext): Array<{ scope: KillScope; key: string }> {
  return [
    { scope: 'GLOBAL', key: '' },
    { scope: 'ORGANIZATION', key: ctx.organizationId },
    { scope: 'PROVIDER', key: ctx.provider },
    { scope: 'ACCOUNT', key: ctx.accountId },
    { scope: 'ACTION_TYPE', key: ctx.actionType },
  ];
}

export type KillDecision = { blocked: false } | { blocked: true; by: KillScope; key: string; reason?: string };

/** Given the ACTIVE switches (from the DB), decide whether a write is blocked. Fail CLOSED is the
 * caller's job: if the store cannot be read, the caller must treat writes as blocked. */
export function evaluateWriteBlocked(ctx: WriteContext, active: KillSwitch[]): KillDecision {
  for (const want of relevantSwitches(ctx)) {
    const hit = active.find((s) => s.active && s.scope === want.scope && s.key === want.key);
    if (hit) return { blocked: true, by: hit.scope, key: hit.key, reason: hit.reason };
  }
  return { blocked: false };
}

/** Whether reads are blocked (only when a matching switch explicitly sets blocksReads). */
export function evaluateReadBlocked(ctx: WriteContext, active: KillSwitch[]): KillDecision {
  for (const want of relevantSwitches(ctx)) {
    const hit = active.find((s) => s.active && s.blocksReads && s.scope === want.scope && s.key === want.key);
    if (hit) return { blocked: true, by: hit.scope, key: hit.key, reason: hit.reason };
  }
  return { blocked: false };
}
