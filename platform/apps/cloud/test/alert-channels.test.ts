import { describe, expect, it } from 'vitest';
import type { AlertRecord } from '@/lib/markting/ops/alerts';
import {
  EmailAlertChannel,
  SlackAlertChannel,
  WebhookAlertChannel,
  formatAlert,
  type EmailMessage,
  type EmailSender,
  type SlackMessage,
  type SlackPoster,
  type WebhookRequest,
  type HttpPoster,
} from '@/lib/markting/ops/alert-channels';

const NOW = 1_700_000_000_000;

const record = (): AlertRecord => ({
  type: 'AUTH_FAILURE_SPIKE',
  severity: 'WARNING',
  source: 'auth-worker',
  organizationId: 'org_1',
  provider: 'meta',
  dedupKey: 'AUTH_FAILURE_SPIKE|org_1|meta|auth-worker',
  correlationId: 'alrt_abc',
  state: 'OPEN',
  count: 3,
  // evidence carries a bearer token + a customer email that MUST NOT leak downstream
  evidence: {
    code: 401,
    access_token: 'ey' + 'A'.repeat(40) + '.' + 'B'.repeat(20) + '.' + 'C'.repeat(20),
    customer_email: 'victim@example.com',
    retries: 5,
  },
  firstSeenAtMs: NOW,
  lastSeenAtMs: NOW + 1000,
  cooldownUntilMs: NOW + 600_000,
  incidentId: null,
});

// --- fakes ----------------------------------------------------------------------------------------

class FakeEmailSender implements EmailSender {
  sent: EmailMessage[] = [];
  async send(message: EmailMessage): Promise<void> {
    this.sent.push(message);
  }
}
class FakeSlackPoster implements SlackPoster {
  posted: SlackMessage[] = [];
  async post(message: SlackMessage): Promise<void> {
    this.posted.push(message);
  }
}
class FakeHttpPoster implements HttpPoster {
  requests: WebhookRequest[] = [];
  async post(request: WebhookRequest): Promise<void> {
    this.requests.push(request);
  }
}
const throwingEmail: EmailSender = { async send() { throw new Error('smtp down'); } };
const throwingSlack: SlackPoster = { async post() { throw new Error('slack 500'); } };
const throwingHttp: HttpPoster = { async post() { throw new Error('connection reset'); } };

function assertNoSecrets(text: string) {
  expect(text).not.toContain('victim@example.com');
  expect(text).not.toMatch(/ey[A-Za-z]{10,}/);
  expect(text).toContain('[REDACTED]');
}

describe('C.6-19 — external alert delivery adapters', () => {
  it('formatAlert scrubs evidence (no token / email) but keeps safe fields', () => {
    const f = formatAlert(record());
    assertNoSecrets(f.summary);
    expect(f.summary).toContain('AUTH_FAILURE_SPIKE');
    expect(f.summary).toContain('Severity: WARNING');
    // non-sensitive evidence survives the scrub
    expect(JSON.stringify(f.redactedEvidence)).toContain('"retries":5');
  });

  it('EmailAlertChannel delivers via its fake transport, secret-free', async () => {
    const sender = new FakeEmailSender();
    const ch = new EmailAlertChannel(sender, { recipients: ['ops@marketing.internal'] });
    const result = await ch.attempt(record());
    expect(result).toEqual({ ok: true, channel: 'email' });
    expect(sender.sent).toHaveLength(1);
    const sent = sender.sent[0]!;
    expect(sent.to).toEqual(['ops@marketing.internal']);
    assertNoSecrets(sent.body);
  });

  it('SlackAlertChannel delivers via its fake transport, secret-free', async () => {
    const poster = new FakeSlackPoster();
    const ch = new SlackAlertChannel(poster, { channel: '#ops-alerts' });
    const result = await ch.attempt(record());
    expect(result).toEqual({ ok: true, channel: 'slack' });
    const posted = poster.posted[0]!;
    expect(posted.channel).toBe('#ops-alerts');
    assertNoSecrets(posted.text);
  });

  it('WebhookAlertChannel delivers a scrubbed structured body via its fake transport', async () => {
    const poster = new FakeHttpPoster();
    const ch = new WebhookAlertChannel(poster, { url: 'https://hook.internal/alerts' });
    const result = await ch.attempt(record());
    expect(result).toEqual({ ok: true, channel: 'webhook' });
    const req = poster.requests[0]!;
    expect(req.url).toBe('https://hook.internal/alerts');
    expect(req.body).toMatchObject({ type: 'AUTH_FAILURE_SPIKE', severity: 'WARNING', count: 3 });
    assertNoSecrets(JSON.stringify(req.body));
  });

  it('a throwing transport is swallowed: returns a failure marker and never throws', async () => {
    const email = new EmailAlertChannel(throwingEmail, { recipients: ['ops@x'] });
    const slack = new SlackAlertChannel(throwingSlack, { channel: '#c' });
    const webhook = new WebhookAlertChannel(throwingHttp, { url: 'https://x' });

    expect(await email.attempt(record())).toEqual({ ok: false, channel: 'email', error: 'smtp down' });
    expect(await slack.attempt(record())).toEqual({ ok: false, channel: 'slack', error: 'slack 500' });
    expect(await webhook.attempt(record())).toEqual({ ok: false, channel: 'webhook', error: 'connection reset' });

    // the AlertChannel.deliver() surface resolves (no throw) even when the transport throws
    await expect(email.deliver(record())).resolves.toBeUndefined();
    await expect(slack.deliver(record())).resolves.toBeUndefined();
    await expect(webhook.deliver(record())).resolves.toBeUndefined();
  });
});
