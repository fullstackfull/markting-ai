import 'server-only';
import { ingestAlert, markDelivered, type AlertInput, type AlertRecord } from './alerts';

/**
 * PHASE C.5 (4) — alert DELIVERY. One pipeline: ingest (dedup/cooldown) → persist → deliver to the
 * registered channels only when the decision says to. Platform Admin is the first-class internal
 * channel; external channels (email/Slack/pager) are optional adapters that implement the same port.
 */

export interface AlertChannel {
  readonly name: string;
  deliver(record: AlertRecord): Promise<void>;
}

/** Store port for alert instances (InMemory + Postgres impls in alert-store.ts). */
export interface AlertStore {
  findByDedupKey(key: string): Promise<AlertRecord | null>;
  upsert(record: AlertRecord): Promise<AlertRecord>;
}

/**
 * The internal Platform-Admin channel: "delivery" means the alert row is persisted in a DELIVERED state
 * so it surfaces in the operator console. It performs no external I/O, so it is always safe in CI.
 */
export class PlatformAdminChannel implements AlertChannel {
  readonly name = 'platform_admin';
  async deliver(_record: AlertRecord): Promise<void> {
    // No-op beyond persistence: the operator console reads markting_alerts directly. Kept as a channel
    // so the pipeline treats internal + external delivery uniformly.
  }
}

export interface AlertPipelineResult {
  record: AlertRecord;
  delivered: boolean;
  channels: string[];
}

/**
 * Process one incoming alert signal end to end. Returns the persisted record and whether it was
 * delivered (new or reopened-after-cooldown) vs suppressed (within cooldown — anti-storm).
 */
export async function processAlert(
  store: AlertStore,
  channels: AlertChannel[],
  input: AlertInput,
  now: number = Date.now(),
  cooldownMs?: number,
): Promise<AlertPipelineResult> {
  const existing = await store.findByDedupKey(
    // dedupKey is derived inside ingestAlert; recompute here for the lookup
    [input.type, input.organizationId ?? '-', input.provider ?? '-', input.source].join('|'),
  );
  const decision = ingestAlert(existing, input, now, cooldownMs);

  if (!decision.deliver) {
    const saved = await store.upsert(decision.record);
    return { record: saved, delivered: false, channels: [] };
  }

  const ran: string[] = [];
  for (const ch of channels) {
    try { await ch.deliver(decision.record); ran.push(ch.name); }
    catch { /* a failing channel never blocks persistence or other channels */ }
  }
  const saved = await store.upsert(markDelivered(decision.record));
  return { record: saved, delivered: true, channels: ran };
}
