import 'server-only';
import { randomUUID } from 'node:crypto';
import type { TenantPrincipal } from '@/lib/cloud/types';
import { resolveRuntimeMode, type RuntimeMode } from './runtime-mode';

/**
 * Structured, server-derived context for every engine/model interaction (Phase 1A). Tenant identity
 * comes ONLY from the authenticated principal and server config — never from the LLM or user prose,
 * and it is passed as structured fields, not concatenated into system-prompt text as the primary
 * control. Every report/thread/tool/model/trace/usage event is attributable to organizationId via
 * this context (and, for chat threads, via the org-prefixed thread id the cloud gates).
 */
export interface EngineContext {
  organizationId: string;
  userId?: string;
  requestId: string;
  threadId?: string;
  locale: 'ar' | 'en';
  timezone: string;
  currency?: string;
  mode: RuntimeMode;
  /** Capability scope for this interaction. Phase 1 analysis is read-only. */
  scope: 'read_only' | 'recommend' | 'write_preview';
}

function scopeForMode(mode: RuntimeMode): EngineContext['scope'] {
  switch (mode) {
    case 'LIVE_READ_ONLY': return 'read_only';
    case 'LIVE_RECOMMENDATIONS': return 'recommend';
    default: return 'write_preview'; // DEMO / LIVE_WRITE_* may produce previews (still human-gated)
  }
}

export function buildEngineContext(principal: TenantPrincipal, opts: {
  threadId?: string;
  locale?: 'ar' | 'en';
  timezone?: string;
  currency?: string;
  requestId?: string;
} = {}): EngineContext {
  const mode = resolveRuntimeMode();
  return {
    organizationId: principal.organizationId,
    userId: principal.userId,
    requestId: opts.requestId ?? randomUUID(),
    threadId: opts.threadId,
    locale: opts.locale ?? 'ar',
    timezone: opts.timezone ?? 'Asia/Riyadh',
    currency: opts.currency,
    mode,
    scope: scopeForMode(mode),
  };
}

/** Headers carrying the context to the engine host on the surfaces the host controls (reports). */
export function engineContextHeaders(ctx: EngineContext): Record<string, string> {
  return {
    'x-markting-org': ctx.organizationId,
    'x-markting-request-id': ctx.requestId,
    'x-markting-mode': ctx.mode,
    'x-markting-scope': ctx.scope,
    'x-markting-locale': ctx.locale,
    'x-markting-timezone': ctx.timezone,
  };
}

/** True for modes where the analysis runtime must be read-only (no preview, no apply). */
export function isReadOnlyMode(mode: RuntimeMode = resolveRuntimeMode()): boolean {
  return mode === 'LIVE_READ_ONLY' || mode === 'LIVE_RECOMMENDATIONS';
}
