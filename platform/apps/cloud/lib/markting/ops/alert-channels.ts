import 'server-only';
import type { AlertRecord } from './alerts';
import type { AlertChannel } from './alert-delivery';
import { sanitizeProviderResponse } from './sanitize';

/**
 * PHASE C.6 (item 19) — external ALERT DELIVERY ADAPTERS.
 *
 * Email / Slack / Webhook channels that implement the SAME {@link AlertChannel} port as the internal
 * PlatformAdminChannel (see alert-delivery.ts). They exist so the pipeline can fan an alert out to
 * external destinations without any coupling to a concrete client.
 *
 * BLOCKED_EXTERNAL: none of these adapters connects to a real service. Each takes an INJECTED transport
 * port ({@link EmailSender} / {@link SlackPoster} / {@link HttpPoster}); tests pass fakes. Wiring a real
 * SMTP client, Slack Web API client, or HTTP client into these ports is a DEPLOY step — it is deliberately
 * not done here so the module stays credential-free and safe in CI.
 *
 * Secret hygiene: the human-facing fields of an AlertRecord (type/severity/source/state/…) are not
 * secrets, but `evidence` is attacker/provider-shaped and may carry tokens or PII, so it is always routed
 * through the existing provider-response redaction ({@link sanitizeProviderResponse}) before it leaves
 * the process. A delivery failure is caught and surfaced as a failure marker — a throwing transport NEVER
 * throws into the pipeline.
 */

// --- transport ports (the deploy step supplies real implementations of these) ---------------------

export interface EmailMessage {
  to: string[];
  subject: string;
  body: string;
}
export interface EmailSender {
  send(message: EmailMessage): Promise<void>;
}

export interface SlackMessage {
  channel: string;
  text: string;
}
export interface SlackPoster {
  post(message: SlackMessage): Promise<void>;
}

export interface WebhookRequest {
  url: string;
  body: Record<string, unknown>;
}
export interface HttpPoster {
  post(request: WebhookRequest): Promise<void>;
}

// --- delivery result marker -----------------------------------------------------------------------

export type DeliveryResult =
  | { ok: true; channel: string }
  | { ok: false; channel: string; error: string };

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// --- secret-free formatting -----------------------------------------------------------------------

export interface FormattedAlert {
  title: string;
  summary: string;
  /** Structurally-faithful, fully-scrubbed copy of the alert evidence (no tokens / PII). */
  redactedEvidence: unknown;
}

/**
 * Build a secret-free human/structured view of an alert. Scalar record fields are safe; `evidence` is
 * scrubbed through {@link sanitizeProviderResponse} so a bearer token or customer email in the evidence
 * can never reach an external channel.
 */
export function formatAlert(record: AlertRecord): FormattedAlert {
  const { sanitized } = sanitizeProviderResponse(record.evidence, {
    provider: record.provider ?? 'platform',
    apiVersion: 'n/a',
  });
  const title = `[${record.severity}] ${record.type} — ${record.source}`;
  const summary = [
    `Alert: ${record.type}`,
    `Severity: ${record.severity}`,
    `State: ${record.state}`,
    `Source: ${record.source}`,
    `Organization: ${record.organizationId ?? 'platform-wide'}`,
    `Provider: ${record.provider ?? 'n/a'}`,
    `Count: ${record.count}`,
    `Correlation: ${record.correlationId}`,
    `First seen: ${new Date(record.firstSeenAtMs).toISOString()}`,
    `Last seen: ${new Date(record.lastSeenAtMs).toISOString()}`,
    `Evidence: ${JSON.stringify(sanitized)}`,
  ].join('\n');
  return { title, summary, redactedEvidence: sanitized };
}

// --- adapters -------------------------------------------------------------------------------------

export interface EmailChannelConfig {
  recipients: string[];
}

export class EmailAlertChannel implements AlertChannel {
  readonly name = 'email';
  constructor(
    private readonly sender: EmailSender,
    private readonly config: EmailChannelConfig,
  ) {}

  /** Conforms to AlertChannel: never throws into the pipeline (failures are swallowed). */
  async deliver(record: AlertRecord): Promise<void> {
    await this.attempt(record);
  }

  /** Like {@link deliver} but surfaces a failure marker instead of discarding it. */
  async attempt(record: AlertRecord): Promise<DeliveryResult> {
    try {
      const f = formatAlert(record);
      await this.sender.send({ to: this.config.recipients, subject: f.title, body: f.summary });
      return { ok: true, channel: this.name };
    } catch (err) {
      return { ok: false, channel: this.name, error: errorMessage(err) };
    }
  }
}

export interface SlackChannelConfig {
  channel: string;
}

export class SlackAlertChannel implements AlertChannel {
  readonly name = 'slack';
  constructor(
    private readonly poster: SlackPoster,
    private readonly config: SlackChannelConfig,
  ) {}

  async deliver(record: AlertRecord): Promise<void> {
    await this.attempt(record);
  }

  async attempt(record: AlertRecord): Promise<DeliveryResult> {
    try {
      const f = formatAlert(record);
      await this.poster.post({ channel: this.config.channel, text: `${f.title}\n${f.summary}` });
      return { ok: true, channel: this.name };
    } catch (err) {
      return { ok: false, channel: this.name, error: errorMessage(err) };
    }
  }
}

export interface WebhookChannelConfig {
  url: string;
}

export class WebhookAlertChannel implements AlertChannel {
  readonly name = 'webhook';
  constructor(
    private readonly poster: HttpPoster,
    private readonly config: WebhookChannelConfig,
  ) {}

  async deliver(record: AlertRecord): Promise<void> {
    await this.attempt(record);
  }

  async attempt(record: AlertRecord): Promise<DeliveryResult> {
    try {
      const f = formatAlert(record);
      await this.poster.post({
        url: this.config.url,
        body: {
          type: record.type,
          severity: record.severity,
          state: record.state,
          source: record.source,
          organizationId: record.organizationId,
          provider: record.provider,
          count: record.count,
          correlationId: record.correlationId,
          dedupKey: record.dedupKey,
          firstSeenAtMs: record.firstSeenAtMs,
          lastSeenAtMs: record.lastSeenAtMs,
          // evidence is the scrubbed copy — never the raw, possibly-secret evidence
          evidence: f.redactedEvidence,
        },
      });
      return { ok: true, channel: this.name };
    } catch (err) {
      return { ok: false, channel: this.name, error: errorMessage(err) };
    }
  }
}
