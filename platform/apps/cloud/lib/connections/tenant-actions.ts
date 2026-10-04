'use server';
import { revalidatePath } from 'next/cache';
import { requireDashboardTenant, canAdminister } from '@/lib/cloud/dashboard';
import { createTenantRuntime } from '@/lib/cloud/runtime';
import { loadProviderCredential, setConnectionVerification, syncDiscoveredAccounts } from '@/lib/cloud/repository';
import { isCloudProvider, type CloudProvider, type TenantPrincipal } from '@/lib/cloud/types';
import { connectionRegistry } from './registry';
import { classifyConnectionError } from './classify';
import { recordConnectionEvent } from './events';
import { describeProviderError } from '@/lib/cloud/provider-errors';

/**
 * CONNECTIONS CONTROL PLANE — TENANT actions.
 *
 * All actions are server-side, RBAC-gated (owner/admin only), tenant-scoped (never cross-org), and
 * audited (tenant audit_events + connection_events). They NEVER return secrets. Where a live provider
 * probe is possible (a stored credential exists) `testConnection` performs a REAL verification against
 * the live adapter and classifies the outcome; where no credential/transport exists it reports
 * NOT_CONFIGURED / BLOCKED_EXTERNAL honestly rather than faking a success.
 */
export interface TenantActionResult { ok: boolean; status: 'ok' | 'error' | 'not_configured' | 'blocked_external'; message: string }

async function requireManager() {
  const tenant = await requireDashboardTenant();
  if (!canAdminister(tenant)) throw new Error('Only organization owners and admins can manage connections.');
  const principal: TenantPrincipal = { organizationId: tenant.organizationId, userId: tenant.userId, role: tenant.role, scopes: [] };
  return { tenant, principal };
}

/**
 * Verify a connection against the live provider. Reuses the exact probe the OAuth callback uses
 * (runtime.ctx.providers.get(provider).listAccounts()). Deterministically classifies any failure.
 */
export async function testConnection(_p: TenantActionResult | null, form: FormData): Promise<TenantActionResult> {
  const provider = String(form.get('provider') ?? '');
  try {
    if (!isCloudProvider(provider)) return { ok: false, status: 'error', message: 'Unknown provider.' };
    const { tenant, principal } = await requireManager();
    const entry = connectionRegistry(provider);
    if (entry && !entry.capabilities.testConnection) {
      return { ok: false, status: 'blocked_external', message: `Test is not supported for ${entry.label}.` };
    }
    const credential = await loadProviderCredential(tenant.organizationId, provider as CloudProvider);
    if (!credential) {
      return { ok: false, status: 'not_configured', message: 'Not connected yet — connect the provider first.' };
    }
    try {
      const runtime = await createTenantRuntime(principal, { enforceAccountScope: false });
      const connected = runtime.ctx.providers.get(provider);
      const accounts = await connected.listAccounts();
      await setConnectionVerification(tenant.organizationId, provider as CloudProvider, { ok: true, label: `${accounts.length} account(s) reachable` });
      await recordConnectionEvent({ organizationId: tenant.organizationId, connectionId: credential.connectionId, provider, event: 'test_connection', actorType: 'tenant_user', actorId: tenant.userId, detail: { ok: true, accounts: accounts.length } });
      revalidatePath('/dashboard/connections');
      return { ok: true, status: 'ok', message: `Live test succeeded — ${accounts.length} account(s) reachable.` };
    } catch (probeError) {
      const { errorClass, action } = classifyConnectionError(probeError);
      const safe = describeProviderError(probeError, provider);
      await setConnectionVerification(tenant.organizationId, provider as CloudProvider, { ok: false, error: safe });
      await recordConnectionEvent({ organizationId: tenant.organizationId, connectionId: credential.connectionId, provider, event: 'test_connection', actorType: 'tenant_user', actorId: tenant.userId, errorClass, detail: { ok: false } });
      revalidatePath('/dashboard/connections');
      return { ok: false, status: 'error', message: `${safe} (${errorClass} → ${action})` };
    }
  } catch (e) { return { ok: false, status: 'error', message: e instanceof Error ? e.message : 'Failed.' }; }
}

/** Re-discover the accounts a credential can access, then refresh the stored inventory (no auto-activate). */
export async function discoverAccounts(_p: TenantActionResult | null, form: FormData): Promise<TenantActionResult> {
  const provider = String(form.get('provider') ?? '');
  try {
    if (!isCloudProvider(provider)) return { ok: false, status: 'error', message: 'Unknown provider.' };
    const { tenant, principal } = await requireManager();
    const credential = await loadProviderCredential(tenant.organizationId, provider as CloudProvider);
    if (!credential) return { ok: false, status: 'not_configured', message: 'Not connected yet.' };
    try {
      const runtime = await createTenantRuntime(principal, { enforceAccountScope: false });
      const accounts = await runtime.ctx.providers.get(provider).listAccounts();
      await syncDiscoveredAccounts({ organizationId: tenant.organizationId, connectionId: credential.connectionId, provider: provider as CloudProvider, accounts, maxActiveAccounts: null });
      await recordConnectionEvent({ organizationId: tenant.organizationId, connectionId: credential.connectionId, provider, event: 'account_selected', actorType: 'tenant_user', actorId: tenant.userId, detail: { discovered: accounts.length } });
      revalidatePath('/dashboard/connections');
      return { ok: true, status: 'ok', message: `Discovered ${accounts.length} account(s). Activate the ones you want under Accounts.` };
    } catch (probeError) {
      const safe = describeProviderError(probeError, provider);
      return { ok: false, status: 'error', message: safe };
    }
  } catch (e) { return { ok: false, status: 'error', message: e instanceof Error ? e.message : 'Failed.' }; }
}

/** Retry a connection's sync. Honest: no in-repo background sync runner exists → BLOCKED_EXTERNAL. */
export async function retrySync(_p: TenantActionResult | null, form: FormData): Promise<TenantActionResult> {
  const provider = String(form.get('provider') ?? '');
  try {
    const { tenant } = await requireManager();
    if (!provider) return { ok: false, status: 'error', message: 'Unknown provider.' };
    await recordConnectionEvent({ organizationId: tenant.organizationId, provider, event: 'sync_triggered', actorType: 'tenant_user', actorId: tenant.userId, detail: { requested: true } });
    return { ok: false, status: 'blocked_external', message: 'Paid-media reads are on-demand; there is no background sync to retry (BLOCKED_EXTERNAL — no runner deployed).' };
  } catch (e) { return { ok: false, status: 'error', message: e instanceof Error ? e.message : 'Failed.' }; }
}
