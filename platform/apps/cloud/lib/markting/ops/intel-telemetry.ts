import { redactLog } from './observability';

/**
 * CODE-RC Program 29 — structured observability hooks for the intelligence read path.
 *
 * The app emits typed, secret-redacted events for the stages the mission calls out: orchestrator
 * duration, DB/gather duration, section failures, AI mode, context truncation, source type, and
 * provider normalization failures. This is the in-process event model + a pluggable sink (default
 * no-op) — a real metrics backend is wired at the edge in production. Payloads are run through the
 * existing `redactLog` so no token/secret/PII field is ever emitted.
 */
export type IntelEvent =
  | { kind: 'orchestrator_answer'; organizationId: string; intent: string; durationMs: number; aiMode: string; sourceType: string; trustTier: string; truncated?: boolean }
  | { kind: 'gather_duration'; organizationId: string; durationMs: number; domain?: string }
  | { kind: 'section_failure'; organizationId: string; section: string; reason: string }
  | { kind: 'context_truncated'; organizationId: string; keptCount: number; summarizedCount: number }
  | { kind: 'provider_normalization_failure'; provider: string; reason: string };

export interface IntelTelemetrySink {
  emit(event: IntelEvent): void;
}

const noopSink: IntelTelemetrySink = { emit() { /* no backend in-process; wired at the edge */ } };
let sink: IntelTelemetrySink = noopSink;

/** Install a telemetry sink (e.g. in production). Returns a restore function. */
export function setIntelTelemetrySink(next: IntelTelemetrySink): () => void {
  const prev = sink;
  sink = next;
  return () => { sink = prev; };
}

/** Emit an intelligence-path event (secret-redacted). Never throws into the caller. */
export function emitIntelEvent(event: IntelEvent): void {
  try {
    sink.emit(redactLog(event));
  } catch {
    // telemetry must never break the request path
  }
}

/** Time a synchronous or async operation and emit its duration via `build(event, ms)`. */
export async function timed<T>(fn: () => Promise<T> | T, build: (ms: number) => IntelEvent): Promise<T> {
  const start = Date.now();
  try {
    return await fn();
  } finally {
    emitIntelEvent(build(Date.now() - start));
  }
}
