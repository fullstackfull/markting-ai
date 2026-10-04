/**
 * PHASE C.6 (13) — WEBHOOK SECRET DERIVATION SEAM.
 *
 * `webhook-ingress.ts` resolves a connection's trusted org identity but returns `signingSecret: null`
 * today (BLOCKED_EXTERNAL — no live secret material). This module is the seam that would fill that: a
 * `WebhookSecretProvider` that derives a connection's HMAC signing secret so ingress can verify a
 * delivery's signature.
 *
 * Three implementations:
 *   (a) LocalTestWebhookSecretProvider — in-memory map, for tests.
 *   (b) EnvWebhookSecretProvider      — reads a per-connection secret from an env var, for dev.
 *   (c) KmsWebhookSecretProvider      — PRODUCTION adapter: unseals a per-connection KMS-SEALED secret
 *                                       via the key-management seam (kms.ts envelope crypto).
 *
 * INVARIANTS:
 *   - The plaintext secret is NEVER persisted (only sealed blobs are stored) and NEVER logged or placed
 *     into a thrown error message.
 *   - A connection with no configured/stored secret resolves to `null` — honest, never a fabricated
 *     secret (so ingress reports NOT_CONFIGURED rather than verifying against a made-up key).
 */
import 'server-only';
import type { KeyManager, SealedSecret } from './key-management';

/** Derives a connection's webhook HMAC signing secret. `null` ⇒ no secret configured (honest). */
export interface WebhookSecretProvider {
  /** The plaintext signing secret for a connection, or null when none is configured. */
  getSigningSecret(connectionId: string): Promise<string | null>;
}

// ---------------------------------------------------------------------------------------------------
// (a) In-memory provider — tests only.
// ---------------------------------------------------------------------------------------------------

/**
 * In-memory secret map for tests. Holds plaintext ONLY in process memory for the duration of a test —
 * never written to a store. A connection not in the map resolves to null.
 */
export class LocalTestWebhookSecretProvider implements WebhookSecretProvider {
  private readonly secrets: Map<string, string>;

  constructor(initial?: Record<string, string> | Iterable<readonly [string, string]>) {
    this.secrets = new Map(
      initial == null
        ? []
        : Symbol.iterator in Object(initial)
          ? (initial as Iterable<readonly [string, string]>)
          : Object.entries(initial as Record<string, string>),
    );
  }

  /** Set (or replace) a connection's secret in memory. */
  set(connectionId: string, secret: string): this {
    this.secrets.set(connectionId, secret);
    return this;
  }

  async getSigningSecret(connectionId: string): Promise<string | null> {
    return this.secrets.get(connectionId) ?? null;
  }
}

// ---------------------------------------------------------------------------------------------------
// (b) Env-var provider — dev only.
// ---------------------------------------------------------------------------------------------------

/** Default prefix for the per-connection env var naming scheme. */
export const DEFAULT_WEBHOOK_SECRET_ENV_PREFIX = 'MARKTING_WEBHOOK_SIGNING_SECRET__';

/**
 * Translate a connection id into its env var name under the documented scheme:
 *   `<PREFIX><UPPERCASED connectionId with every non [A-Z0-9] char replaced by '_'>`
 * e.g. connection "conn-abc.123" with the default prefix →
 *   `MARKTING_WEBHOOK_SIGNING_SECRET__CONN_ABC_123`.
 */
export function webhookSecretEnvVarName(
  connectionId: string,
  prefix: string = DEFAULT_WEBHOOK_SECRET_ENV_PREFIX,
): string {
  return prefix + connectionId.toUpperCase().replace(/[^A-Z0-9]/g, '_');
}

/**
 * Reads a connection's secret from an env var (dev convenience). The value is NEVER logged. A missing or
 * empty env var resolves to null. Pass a custom `env`/`prefix` for testing without mutating process.env.
 */
export class EnvWebhookSecretProvider implements WebhookSecretProvider {
  private readonly env: Record<string, string | undefined>;
  private readonly prefix: string;

  constructor(options?: { env?: Record<string, string | undefined>; prefix?: string }) {
    this.env = options?.env ?? process.env;
    this.prefix = options?.prefix ?? DEFAULT_WEBHOOK_SECRET_ENV_PREFIX;
  }

  async getSigningSecret(connectionId: string): Promise<string | null> {
    const name = webhookSecretEnvVarName(connectionId, this.prefix);
    const value = this.env[name];
    // Empty string is treated as "not configured" so a blank var never becomes a usable secret.
    return value != null && value.length > 0 ? value : null;
  }
}

// ---------------------------------------------------------------------------------------------------
// (c) KMS provider — production adapter (unseals a per-connection sealed secret).
// ---------------------------------------------------------------------------------------------------

/**
 * Per-connection SEALED secret store. Only sealed blobs are persisted — never plaintext. A connection
 * with no stored blob returns null.
 *
 * BLOCKED_EXTERNAL: in production the blob would originate from a connection's sealed `webhook_secret`
 * column (sealed by the KMS key service at onboarding). That column + live KMS are absent here; an
 * in-memory store is provided for tests, where a locally-sealed blob round-trips through the keyring.
 */
export interface SealedWebhookSecretStore {
  getSealed(connectionId: string): Promise<SealedSecret | null>;
}

/** In-memory sealed-secret store for tests. Holds ONLY sealed blobs — no plaintext. */
export class InMemorySealedWebhookSecretStore implements SealedWebhookSecretStore {
  private readonly blobs = new Map<string, SealedSecret>();

  set(connectionId: string, sealed: SealedSecret): this {
    this.blobs.set(connectionId, sealed);
    return this;
  }

  async getSealed(connectionId: string): Promise<SealedSecret | null> {
    return this.blobs.get(connectionId) ?? null;
  }
}

/**
 * PRODUCTION adapter: derives the signing secret by UNSEALING a per-connection sealed blob through the
 * key-management seam (kms.ts envelope crypto).
 *
 * BLOCKED_EXTERNAL: the real deployment unseals via a live KMS key service (pass a ProductionKmsKeyManager
 * — itself a BLOCKED_EXTERNAL stub — once a KMS endpoint exists). In this environment it is wired with a
 * LocalKeyManager over the existing keyring, which correctly round-trips a locally-sealed blob. Wiring a
 * real KMS key service is the deploy step; the unseal path is identical either way.
 *
 * Secret safety: the unsealed plaintext is returned to the caller and otherwise never logged. If unsealing
 * fails (unknown/revoked key version, tampered blob), the error is re-wrapped as a secret-free message so
 * the plaintext can never leak through a thrown error.
 */
export class KmsWebhookSecretProvider implements WebhookSecretProvider {
  private readonly keyManager: KeyManager;
  private readonly store: SealedWebhookSecretStore;

  constructor(keyManager: KeyManager, store: SealedWebhookSecretStore) {
    this.keyManager = keyManager;
    this.store = store;
  }

  async getSigningSecret(connectionId: string): Promise<string | null> {
    const sealed = await this.store.getSealed(connectionId);
    if (!sealed) return null; // No stored blob ⇒ not configured. Honest null, never fabricated.
    try {
      return this.keyManager.decrypt(sealed);
    } catch (err) {
      // Never surface the plaintext (there is none in the error here, but we still normalize the message
      // to a secret-free, connection-scoped string so nothing derived from the secret can escape).
      const reason = err instanceof Error ? err.name : 'unknown error';
      throw new Error(`webhook secret unseal failed for connection ${connectionId}: ${reason}`);
    }
  }
}
