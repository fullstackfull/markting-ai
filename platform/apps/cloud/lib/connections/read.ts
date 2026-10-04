import 'server-only';
import { db } from '@/lib/db';
import { oauthAdapter, oauthAvailability } from '@/lib/cloud/provider-oauth';
import { AD_PROVIDERS, connectionRegistry } from './registry';
import { classifyConnectionError } from './classify';
import { deriveConnectionHealth, deriveConnectionStatus } from './status';
import { ERROR_REMEDIATION, type AuthType, type ConnectionErrorClass, type ConnectionStatus } from './vocabulary';
import type { CanonicalConnection } from './types';
import type { OAuthProvider } from '@/lib/cloud/types';

/**
 * CONNECTIONS CONTROL PLANE — the canonical TENANT read model.
 *
 * ONE unified shape (CanonicalConnection, see ./types) for every integration a tenant can see (paid-media
 * + commerce), derived from the canonical public.connections table plus discovered accounts, with
 * deterministic status/health/scope-gap. No secrets are read or returned — only non-secret metadata. The
 * same deriveConnectionStatus/Health used by the admin fleet view is used here, so tenant and operator
 * never see divergent truth.
 */
export type { CanonicalConnection } from './types';

interface ConnectionRow {
  id: string;
  provider: string;
  status: 'connected' | 'error' | 'revoked';
  connectionType: string;
  authType: string | null;
  environment: string;
  externalLabel: string | null;
  scopes: string[];
  lastError: string | null;
  errorClassification: string | null;
  healthState: string | null;
  tokenExpiresAt: Date | null;
  lastAuthenticatedAt: Date | null;
  lastVerifiedAt: Date | null;
  lastSyncAt: Date | null;
  lastWebhookAt: Date | null;
  reauthRequired: boolean;
  disabledAt: Date | null;
  disabledReason: string | null;
  connectedAt: Date;
  accountSelectionId: string | null;
}

function requiredScopes(provider: string): string[] {
  try {
    return [...(oauthAdapter(provider as OAuthProvider).scopes ?? [])];
  } catch {
    return [];
  }
}

function iso(d: Date | null): string | null {
  return d ? d.toISOString() : null;
}

/** Build the full canonical connection list for a tenant: every ad provider + any commerce store. */
export async function listCanonicalConnections(organizationId: string): Promise<CanonicalConnection[]> {
  const availability = oauthAvailability(organizationId);
  const [rows, accountCounts, stores] = await Promise.all([
    db()<ConnectionRow[]>`
      select id, provider, status, connection_type as "connectionType", auth_type as "authType",
        environment, external_label as "externalLabel", scopes, last_error as "lastError",
        error_classification as "errorClassification", health_state as "healthState",
        token_expires_at as "tokenExpiresAt", last_authenticated_at as "lastAuthenticatedAt",
        last_verified_at as "lastVerifiedAt", last_sync_at as "lastSyncAt", last_webhook_at as "lastWebhookAt",
        reauth_required as "reauthRequired", disabled_at as "disabledAt", disabled_reason as "disabledReason",
        connected_at as "connectedAt", account_selection_id as "accountSelectionId"
      from public.connections where organization_id = ${organizationId}`,
    db()<Array<{ provider: string; total: number; enabled: number }>>`
      select provider, count(*)::int as total, count(*) filter (where enabled)::int as enabled
      from public.organization_ad_accounts where organization_id = ${organizationId} group by provider`,
    db()<Array<{ connectionId: string; storeId: string; platform: string; status: string; syncStatus: string | null; lastRunAt: Date | null; consecutiveErrors: number }>>`
      select c.connection_id as "connectionId", c.store_id as "storeId", c.platform, c.status,
        s.status as "syncStatus", s.last_run_at as "lastRunAt", coalesce(s.consecutive_errors, 0) as "consecutiveErrors"
      from public.markting_store_connections c
      left join public.markting_commerce_sync_state s
        on s.connection_id = c.connection_id and s.organization_id = c.organization_id
      where c.organization_id = ${organizationId}`.catch(() => []),
  ]);

  const byProvider = new Map(rows.map((r) => [r.provider, r]));
  const counts = new Map(accountCounts.map((c) => [c.provider, c]));

  const adConnections: CanonicalConnection[] = AD_PROVIDERS.map((entry) => {
    const row = byProvider.get(entry.id);
    const available = availability[entry.id as OAuthProvider] ?? false;
    const granted = row?.scopes ?? [];
    const req = requiredScopes(entry.id);
    const missing = req.filter((s) => !granted.includes(s));
    const errorClass = (row?.errorClassification as ConnectionErrorClass | null) ?? (row?.lastError ? classifyConnectionError(row.lastError).errorClass : null);
    const acct = counts.get(entry.id);
    const signals = {
      baseStatus: row?.status,
      disabled: !!row?.disabledAt,
      reauthRequired: !!row?.reauthRequired,
      hasCredential: !!row,
      available,
      tokenExpiresAt: iso(row?.tokenExpiresAt ?? null),
      errorClass,
      // Only count missing scopes for providers that can actually report granted scopes; otherwise the
      // "required" list is informational and must not drive a false INSUFFICIENT_PERMISSIONS status.
      missingScopeCount: entry.capabilities.permissionDiscovery === 'full' ? missing.length : 0,
    };
    const { status, reason } = deriveConnectionStatus(signals);
    const { state: health } = deriveConnectionHealth(signals);
    return {
      id: row?.id ?? null,
      provider: entry.id,
      label: entry.label,
      category: entry.category,
      connectionType: row?.connectionType ?? 'ad_platform',
      status,
      statusReason: reason,
      health: row ? health : null,
      authType: (row?.authType as AuthType | null) ?? entry.authType,
      environment: row?.environment ?? 'production',
      available,
      liveTransportImplemented: entry.liveTransportImplemented,
      accountsTotal: acct?.total ?? 0,
      accountsEnabled: acct?.enabled ?? 0,
      accountSelectionId: row?.accountSelectionId ?? null,
      scopesGranted: granted,
      scopesRequired: req,
      missingScopes: missing,
      tokenExpiresAt: iso(row?.tokenExpiresAt ?? null),
      lastAuthenticatedAt: iso(row?.lastAuthenticatedAt ?? null),
      lastVerifiedAt: iso(row?.lastVerifiedAt ?? null),
      lastSyncAt: iso(row?.lastSyncAt ?? null),
      lastWebhookAt: iso(row?.lastWebhookAt ?? null),
      lastError: row?.lastError ?? null,
      errorClass,
      remediation: errorClass ? ERROR_REMEDIATION[errorClass] : null,
      reauthRequired: !!row?.reauthRequired,
      disabledAt: iso(row?.disabledAt ?? null),
      disabledReason: row?.disabledReason ?? null,
      connectedAt: iso(row?.connectedAt ?? null),
      capabilities: entry.capabilities,
    };
  });

  const commerceConnections: CanonicalConnection[] = stores.map((store) => {
    const entry = connectionRegistry(store.platform);
    const syncFailed = store.consecutiveErrors > 0 || store.syncStatus === 'error';
    const status: ConnectionStatus = store.status === 'active'
      ? (syncFailed ? 'SYNC_FAILED' : 'CONNECTED')
      : store.status === 'revoked' ? 'DISCONNECTED' : store.status === 'error' ? 'PROVIDER_ERROR' : 'NOT_CONFIGURED';
    const errorClass: ConnectionErrorClass | null = status === 'SYNC_FAILED' ? 'SYNC_ERROR' : status === 'PROVIDER_ERROR' ? 'PROVIDER_5XX' : null;
    return {
      id: store.connectionId,
      provider: store.platform,
      label: `${entry?.label ?? store.platform}${store.storeId ? ` · ${store.storeId}` : ''}`,
      category: 'commerce',
      connectionType: 'commerce',
      status,
      statusReason: syncFailed ? `${store.consecutiveErrors} consecutive sync error(s)` : store.status,
      health: status === 'CONNECTED' ? 'CONNECTED' : status === 'SYNC_FAILED' ? 'DEGRADED' : 'ERROR',
      authType: entry?.authType ?? 'merchant_credentials',
      environment: 'production',
      available: false, // live commerce transport is BLOCKED_EXTERNAL (no HTTP client / credentials wired)
      liveTransportImplemented: false,
      accountsTotal: 1,
      accountsEnabled: store.status === 'active' ? 1 : 0,
      accountSelectionId: null,
      scopesGranted: [],
      scopesRequired: [],
      missingScopes: [],
      tokenExpiresAt: null,
      lastAuthenticatedAt: null,
      lastVerifiedAt: null,
      lastSyncAt: iso(store.lastRunAt),
      lastWebhookAt: null,
      lastError: null,
      errorClass,
      remediation: errorClass ? ERROR_REMEDIATION[errorClass] : null,
      reauthRequired: false,
      disabledAt: null,
      disabledReason: null,
      connectedAt: null,
      capabilities: entry?.capabilities ?? AD_PROVIDERS[0]!.capabilities,
    };
  });

  return [...adConnections, ...commerceConnections];
}

export async function getCanonicalConnection(organizationId: string, provider: string): Promise<CanonicalConnection | undefined> {
  const all = await listCanonicalConnections(organizationId);
  return all.find((c) => c.provider === provider);
}
