/**
 * Mode-A (INTELLIGENCE-ONLY) capability resolver + provider-write lockdown (Stage 10).
 *
 * Mode A = live read + AI recommendations, NO provider writes. This composes the Phase-0 runtime-mode
 * ladder with the Phase-7 governance so that, in a Mode-A deployment, EVERY provider-mutation attempt
 * fails closed — whether it comes from a user, the AI, a service account, a "direct" route, or MCP.
 * It never enables writes; it only proves they are inaccessible.
 */
import type { RuntimeMode } from '../runtime-mode';
import { canApply } from '../runtime-mode';

/** The live Mode-A runtime modes (DEMO is a separate demo posture, not a live customer mode). */
export const MODE_A_MODES: ReadonlyArray<RuntimeMode> = ['LIVE_READ_ONLY', 'LIVE_RECOMMENDATIONS'];

export function isModeA(mode: RuntimeMode): boolean {
  return (MODE_A_MODES as readonly string[]).includes(mode);
}

export interface ModeCapabilities {
  readProviders: boolean;
  recommend: boolean;
  previewWrites: boolean;
  applyWrites: boolean;     // provider mutation — ONLY the Phase-0 ceiling may ever be true
}

export function resolveCapabilities(mode: RuntimeMode): ModeCapabilities {
  switch (mode) {
    case 'LIVE_READ_ONLY': return { readProviders: true, recommend: false, previewWrites: false, applyWrites: false };
    case 'LIVE_RECOMMENDATIONS': return { readProviders: true, recommend: true, previewWrites: false, applyWrites: false };
    case 'LIVE_WRITE_DISABLED': return { readProviders: true, recommend: true, previewWrites: true, applyWrites: false };
    case 'LIVE_WRITE_APPROVAL_ONLY': return { readProviders: true, recommend: true, previewWrites: true, applyWrites: true };
    case 'DEMO': return { readProviders: false, recommend: true, previewWrites: true, applyWrites: true }; // sandbox only
  }
}

export class ProviderWriteBlockedError extends Error {
  constructor(public mode: RuntimeMode, public caller: string) {
    super(`provider write blocked: mode ${mode} does not permit provider mutation (caller: ${caller})`);
    this.name = 'ProviderWriteBlockedError';
  }
}

/**
 * The single guard every provider-mutation call site must pass. In Mode A (and any mode below the
 * Phase-0 apply ceiling) it throws. `applyWrites` is true ONLY for LIVE_WRITE_APPROVAL_ONLY (Mode B)
 * and DEMO (sandbox). For a Mode-A live deployment this ALWAYS throws — writes are structurally off.
 */
export function assertProviderWriteAllowed(mode: RuntimeMode, caller: string): void {
  if (!resolveCapabilities(mode).applyWrites || !canApply(mode)) throw new ProviderWriteBlockedError(mode, caller);
}

/** True iff a provider write could ever proceed in this mode (never true in Mode A). */
export function providerWritesPossible(mode: RuntimeMode): boolean {
  return resolveCapabilities(mode).applyWrites && canApply(mode);
}
