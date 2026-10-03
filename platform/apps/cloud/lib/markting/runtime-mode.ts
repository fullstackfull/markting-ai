import 'server-only';
import { z } from 'zod';
import { HttpError } from '@/lib/http';

/**
 * Explicit product/runtime safety states (R0-12). The ladder is ordered from safest to least safe,
 * and Phase 0's ceiling is LIVE_WRITE_APPROVAL_ONLY. There is deliberately **no**
 * `FULL_AUTONOMOUS_WRITE` member — autonomous provider writes cannot be expressed in this type, so
 * no configuration can enable them in Phase 0.
 *
 * - DEMO:                  synthetic fixtures + sandbox provider; human-approved sandbox applies only.
 * - LIVE_READ_ONLY:        real tenant data may be read; no previews, no writes.
 * - LIVE_RECOMMENDATIONS:  real data + AI recommendations; still no provider writes.
 * - LIVE_WRITE_DISABLED:   real data; previews may be produced; applying is refused (the safe live default).
 * - LIVE_WRITE_APPROVAL_ONLY: a human may apply a previewed write to a real account (the Phase-0 ceiling).
 */
export const RUNTIME_MODES = [
  'DEMO',
  'LIVE_READ_ONLY',
  'LIVE_RECOMMENDATIONS',
  'LIVE_WRITE_DISABLED',
  'LIVE_WRITE_APPROVAL_ONLY',
] as const;
export type RuntimeMode = (typeof RUNTIME_MODES)[number];

const modeSchema = z.enum(RUNTIME_MODES).optional();

/**
 * Resolve the runtime mode. An explicit `MARKTING_RUNTIME_MODE` wins. Otherwise it is derived from
 * the existing flags and **fails closed**: demo → DEMO; a non-demo deployment defaults to
 * LIVE_WRITE_DISABLED (real writes stay off until the operator explicitly opts up to
 * LIVE_WRITE_APPROVAL_ONLY). An unrecognized explicit value throws rather than guessing.
 */
export function resolveRuntimeMode(env: Record<string, string | undefined> = process.env): RuntimeMode {
  const explicit = modeSchema.parse(env.MARKTING_RUNTIME_MODE || undefined);
  if (explicit) return explicit;
  return env.MARKTING_DEMO_MODE === 'true' ? 'DEMO' : 'LIVE_WRITE_DISABLED';
}

/** Modes in which a human-approved apply may proceed. Everything else refuses to apply. */
const APPLY_ALLOWED: ReadonlySet<RuntimeMode> = new Set(['DEMO', 'LIVE_WRITE_APPROVAL_ONLY']);

/** Modes in which a preview (validate) may be produced. */
const PREVIEW_ALLOWED: ReadonlySet<RuntimeMode> = new Set([
  'DEMO',
  'LIVE_WRITE_DISABLED',
  'LIVE_WRITE_APPROVAL_ONLY',
]);

export function canPreview(mode: RuntimeMode): boolean {
  return PREVIEW_ALLOWED.has(mode);
}
export function canApply(mode: RuntimeMode): boolean {
  return APPLY_ALLOWED.has(mode);
}

/** Fail closed before applying a previewed write: refuse unless the mode permits human-approved apply. */
export function assertApplyAllowed(mode: RuntimeMode = resolveRuntimeMode()): void {
  if (!canApply(mode)) {
    throw new HttpError(
      `Applying changes is disabled in runtime mode ${mode}. Live provider writes require MARKTING_RUNTIME_MODE=LIVE_WRITE_APPROVAL_ONLY, which is gated behind the Phase 0 exit.`,
      409,
    );
  }
}
