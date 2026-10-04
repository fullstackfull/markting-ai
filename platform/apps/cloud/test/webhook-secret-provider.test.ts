import { randomBytes } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import {
  EnvWebhookSecretProvider,
  InMemorySealedWebhookSecretStore,
  KmsWebhookSecretProvider,
  LocalTestWebhookSecretProvider,
  webhookSecretEnvVarName,
  DEFAULT_WEBHOOK_SECRET_ENV_PREFIX,
} from '@/lib/markting/ops/webhook-secret-provider';
import { LocalKeyManager, ProductionKmsKeyManager } from '@/lib/markting/ops/key-management';

const SECRET = 'whsec_super_secret_value';

describe('(a) LocalTestWebhookSecretProvider', () => {
  it('returns a configured secret and null for an unknown connection', async () => {
    const provider = new LocalTestWebhookSecretProvider({ 'conn-1': SECRET });
    expect(await provider.getSigningSecret('conn-1')).toBe(SECRET);
    expect(await provider.getSigningSecret('conn-unknown')).toBeNull();
  });

  it('supports set() and entry-iterable construction', async () => {
    const provider = new LocalTestWebhookSecretProvider().set('conn-2', SECRET);
    expect(await provider.getSigningSecret('conn-2')).toBe(SECRET);
    const fromEntries = new LocalTestWebhookSecretProvider([['conn-3', SECRET]]);
    expect(await fromEntries.getSigningSecret('conn-3')).toBe(SECRET);
  });
});

describe('(b) EnvWebhookSecretProvider', () => {
  it('derives the env var name under the documented scheme', () => {
    expect(webhookSecretEnvVarName('conn-abc.123')).toBe(
      `${DEFAULT_WEBHOOK_SECRET_ENV_PREFIX}CONN_ABC_123`,
    );
  });

  it('reads a per-connection secret from the env and returns null when unset/empty', async () => {
    const env = { [webhookSecretEnvVarName('conn-1')]: SECRET, [webhookSecretEnvVarName('conn-blank')]: '' };
    const provider = new EnvWebhookSecretProvider({ env });
    expect(await provider.getSigningSecret('conn-1')).toBe(SECRET);
    expect(await provider.getSigningSecret('conn-blank')).toBeNull(); // empty ⇒ not configured
    expect(await provider.getSigningSecret('conn-missing')).toBeNull();
  });

  it('never logs the secret value', async () => {
    const spies = [
      vi.spyOn(console, 'log').mockImplementation(() => {}),
      vi.spyOn(console, 'info').mockImplementation(() => {}),
      vi.spyOn(console, 'warn').mockImplementation(() => {}),
      vi.spyOn(console, 'error').mockImplementation(() => {}),
    ];
    try {
      const env = { [webhookSecretEnvVarName('conn-1')]: SECRET };
      const provider = new EnvWebhookSecretProvider({ env });
      await provider.getSigningSecret('conn-1');
      const logged = spies.flatMap((s) => s.mock.calls).map((c) => JSON.stringify(c)).join(' ');
      expect(logged).not.toContain(SECRET);
    } finally {
      spies.forEach((s) => s.mockRestore());
    }
  });
});

describe('(c) KmsWebhookSecretProvider', () => {
  function sealedStoreWith(connectionId: string, secret: string) {
    // Only a SEALED blob is stored — never plaintext. We seal locally via the keyring (what a KMS key
    // service would do at onboarding in production) and persist the blob.
    const km = LocalKeyManager.fromKeys([{ version: 'v1', key: randomBytes(32), state: 'ACTIVE' }]);
    const store = new InMemorySealedWebhookSecretStore();
    const sealed = km.encrypt(secret);
    expect(JSON.stringify(sealed)).not.toContain(secret); // no plaintext in the stored blob
    store.set(connectionId, sealed);
    return { km, store };
  }

  it('unseals a locally-sealed secret round-trip via the keyring', async () => {
    const { km, store } = sealedStoreWith('conn-1', SECRET);
    const provider = new KmsWebhookSecretProvider(km, store);
    expect(await provider.getSigningSecret('conn-1')).toBe(SECRET);
  });

  it('returns null for a connection with no stored blob (honest, never fabricated)', async () => {
    const { km, store } = sealedStoreWith('conn-1', SECRET);
    const provider = new KmsWebhookSecretProvider(km, store);
    expect(await provider.getSigningSecret('conn-absent')).toBeNull();
  });

  it('refuses to unseal (and leaks no secret) once the key version is revoked', async () => {
    const { km, store } = sealedStoreWith('conn-1', SECRET);
    const provider = new KmsWebhookSecretProvider(km, store);
    km.revoke('v1');
    await expect(provider.getSigningSecret('conn-1')).rejects.toThrow(/unseal failed/);
    // The thrown error carries no plaintext.
    const err = await provider.getSigningSecret('conn-1').catch((e: unknown) => e);
    expect(String(err)).not.toContain(SECRET);
  });

  it('BLOCKED_EXTERNAL production key manager cannot unseal (and leaks no secret)', async () => {
    const { store } = sealedStoreWith('conn-1', SECRET);
    const provider = new KmsWebhookSecretProvider(new ProductionKmsKeyManager(), store);
    const err = await provider.getSigningSecret('conn-1').catch((e: unknown) => e);
    expect(String(err)).toMatch(/unseal failed/);
    expect(String(err)).not.toContain(SECRET);
  });
});
