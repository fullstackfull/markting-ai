import type { AuthType, ConnectionCategory } from './vocabulary';

/**
 * CONNECTIONS CONTROL PLANE — provider capability registry.
 *
 * ONE machine-readable description of what each integration can actually do, grounded in the audited
 * adapter code (not inferred from filenames). The UI reads this registry so it NEVER offers a control a
 * provider does not support (e.g. no "Refresh token" for long-lived/OAuth1 providers, no webhook controls
 * for ad providers, a "manual revoke" note where the provider has no server-side revocation).
 *
 * `permissionDiscovery`:
 *   - 'full'    : the provider can report the granted scopes back (true required-vs-granted reconciliation)
 *   - 'partial' : granted scopes are surfaced only via error text / token debug, not a clean comparison
 *   - 'none'    : scopes are informational only
 * `liveTransportImplemented`: whether the adapter makes real authenticated HTTP calls to the provider
 *   (true for all 11 ad providers). Commerce connectors are built against an injectable transport seam
 *   with NO live HTTP client wired → false (live calls are BLOCKED_EXTERNAL until a client + creds exist).
 */
export interface ConnectionCapabilities {
  connect: boolean;
  testConnection: boolean;
  refresh: boolean;              // in-adapter token refresh
  scheduledRefresh: boolean;     // proactive/background refresh (none today — reactive only)
  reauthorize: boolean;
  disconnect: boolean;
  revokeProviderSide: boolean;   // true = real server-side revoke; false = local delete + manual removal
  accountDiscovery: boolean;
  permissionDiscovery: 'full' | 'partial' | 'none';
  readEntities: boolean;
  writeControls: boolean;        // budget / pause / resume (always behind preview + kill switch + Mode-B hold)
  serverDryRun: boolean;         // provider-side validate_only
  webhook: boolean;
  sync: boolean;                 // has a sync engine (NOTE: no background runner exists in-repo)
}

/**
 * REPORTING capability (Phase B) — the machine-readable "which hierarchy levels and which breakdown
 * dimensions does this provider's normalized report path actually return", grounded in the adapter
 * audit (docs/pro-depth/01). This is the SINGLE source of truth the drill-down surfaces and the
 * Breakdown Explorer gate on, so the UI never offers a level/dimension the adapter cannot produce.
 */
export const HIERARCHY_LEVELS = ['account', 'campaign', 'ad_group', 'ad'] as const;
export type HierarchyLevel = (typeof HIERARCHY_LEVELS)[number];
/** READY = real rows at this level; PARTIAL = rows but id-only names; NOT_SUPPORTED = provider has no
 *  such level; NOT_IMPLEMENTED = adapter does not yet return it (provider could). */
export type LevelSupport = 'READY' | 'PARTIAL' | 'NOT_SUPPORTED' | 'NOT_IMPLEMENTED';

export const BREAKDOWN_DIMENSIONS = ['placement', 'device', 'geography', 'audience', 'age', 'gender', 'network', 'keyword', 'search_term'] as const;
export type BreakdownDimension = (typeof BREAKDOWN_DIMENSIONS)[number];
/** READY = flows into the canonical report path; RAW_ONLY = reachable via a raw passthrough tool but
 *  NOT the normalized ReportRow; NOT_SUPPORTED/NOT_IMPLEMENTED as above. No provider is READY today. */
export type DimensionSupport = 'READY' | 'RAW_ONLY' | 'NOT_SUPPORTED' | 'NOT_IMPLEMENTED';

export interface ReportingCapability {
  levels: Record<HierarchyLevel, LevelSupport>;
  /** Provider-native label for the ad_group level ("Ad set" / "Ad group" / "Line item"). */
  adGroupTerm: { en: string; ar: string };
  dimensions: Partial<Record<BreakdownDimension, DimensionSupport>>;
}

export interface ProviderRegistryEntry {
  id: string;
  label: string;
  category: ConnectionCategory;
  authType: AuthType;
  liveTransportImplemented: boolean;
  capabilities: ConnectionCapabilities;
  /** Reporting hierarchy/dimension support (paid-media providers only). */
  reporting?: ReportingCapability;
  /** For providers without server-side revoke, the console where the user removes access manually. */
  manualRevokeNote?: string;
  notes?: string;
}

const AD_DEFAULTS: Omit<ConnectionCapabilities, 'refresh' | 'revokeProviderSide' | 'permissionDiscovery' | 'serverDryRun'> = {
  connect: true,
  testConnection: true,
  scheduledRefresh: false, // reactive refresh only — no background refresh job exists (by design)
  reauthorize: true,
  disconnect: true,
  accountDiscovery: true,
  readEntities: true,
  writeControls: true,
  webhook: false, // no ad provider registers/ingests webhooks
  sync: false,    // ad reads are on-demand; no background entity/metric sync job
};

function ad(
  id: string,
  label: string,
  authType: AuthType,
  opts: { refresh: boolean; revokeProviderSide: boolean; permissionDiscovery: 'full' | 'partial' | 'none'; serverDryRun?: boolean; manualRevokeNote?: string; notes?: string },
): ProviderRegistryEntry {
  return {
    id,
    label,
    category: 'paid_media',
    authType,
    liveTransportImplemented: true,
    capabilities: { ...AD_DEFAULTS, refresh: opts.refresh, revokeProviderSide: opts.revokeProviderSide, permissionDiscovery: opts.permissionDiscovery, serverDryRun: opts.serverDryRun ?? false },
    manualRevokeNote: opts.manualRevokeNote,
    notes: opts.notes,
  };
}

const MANUAL = 'No server-side token revocation API — the local grant is deleted and you must remove app access in the provider console.';

const FULL_LEVELS: Record<HierarchyLevel, LevelSupport> = { account: 'READY', campaign: 'READY', ad_group: 'READY', ad: 'READY' };
const CAMPAIGN_ONLY_NI: Record<HierarchyLevel, LevelSupport> = { account: 'READY', campaign: 'READY', ad_group: 'NOT_IMPLEMENTED', ad: 'NOT_IMPLEMENTED' };
const PARTIAL_DEEP: Record<HierarchyLevel, LevelSupport> = { account: 'READY', campaign: 'READY', ad_group: 'PARTIAL', ad: 'PARTIAL' };

/**
 * Reporting support per provider, grounded in docs/pro-depth/01. Dimensions default to NOT_SUPPORTED
 * when absent; a dimension is only RAW_ONLY where the adapter exposes a raw passthrough tool (meta /
 * tiktok / reddit) — NO provider feeds a breakdown into the normalized ReportRow path (hence none are
 * READY). Levels and the native ad_group term are the audited truth.
 */
const REPORTING: Record<string, ReportingCapability> = {
  meta: { levels: FULL_LEVELS, adGroupTerm: { en: 'Ad set', ar: 'مجموعة إعلانية' }, dimensions: { placement: 'RAW_ONLY', device: 'RAW_ONLY', geography: 'RAW_ONLY', age: 'RAW_ONLY', gender: 'RAW_ONLY' } },
  google: { levels: FULL_LEVELS, adGroupTerm: { en: 'Ad group', ar: 'مجموعة إعلانية' }, dimensions: { keyword: 'NOT_SUPPORTED', search_term: 'NOT_SUPPORTED', network: 'NOT_SUPPORTED', device: 'NOT_SUPPORTED' } },
  tiktok: { levels: FULL_LEVELS, adGroupTerm: { en: 'Ad group', ar: 'مجموعة إعلانية' }, dimensions: { placement: 'RAW_ONLY', device: 'RAW_ONLY', age: 'RAW_ONLY', gender: 'RAW_ONLY' } },
  pinterest: { levels: FULL_LEVELS, adGroupTerm: { en: 'Ad group', ar: 'مجموعة إعلانية' }, dimensions: {} },
  spotify: { levels: FULL_LEVELS, adGroupTerm: { en: 'Ad set', ar: 'مجموعة إعلانية' }, dimensions: {} },
  x: { levels: FULL_LEVELS, adGroupTerm: { en: 'Line item', ar: 'بند' }, dimensions: {} },
  reddit: { levels: PARTIAL_DEEP, adGroupTerm: { en: 'Ad group', ar: 'مجموعة إعلانية' }, dimensions: { placement: 'RAW_ONLY', geography: 'RAW_ONLY', device: 'RAW_ONLY' } },
  snapchat: { levels: PARTIAL_DEEP, adGroupTerm: { en: 'Ad squad', ar: 'سرب إعلاني' }, dimensions: {} },
  linkedin: { levels: { account: 'READY', campaign: 'READY', ad_group: 'NOT_SUPPORTED', ad: 'READY' }, adGroupTerm: { en: 'Ad group', ar: 'مجموعة إعلانية' }, dimensions: {} },
  microsoft: { levels: CAMPAIGN_ONLY_NI, adGroupTerm: { en: 'Ad group', ar: 'مجموعة إعلانية' }, dimensions: {} },
  apple: { levels: CAMPAIGN_ONLY_NI, adGroupTerm: { en: 'Ad group', ar: 'مجموعة إعلانية' }, dimensions: {} },
};

/** The 11 live ad-platform adapters. Facts grounded in the provider-package + OAuth-broker audit. */
export const AD_PROVIDERS: ProviderRegistryEntry[] = [
  ad('google', 'Google Ads', 'oauth2_pkce', { refresh: true, revokeProviderSide: true, permissionDiscovery: 'partial', serverDryRun: true, notes: 'OAuth2 + PKCE, server-side refresh; validate_only server dry-run; manager (login-customer-id) aware.' }),
  ad('meta', 'Meta Ads', 'long_lived_token', { refresh: false, revokeProviderSide: true, permissionDiscovery: 'partial', serverDryRun: true, notes: 'Long-lived token (short→long exchange at connect). debug_token reports expiry + granted scopes. No in-adapter refresh.' }),
  ad('tiktok', 'TikTok Ads', 'long_lived_token', { refresh: false, revokeProviderSide: true, permissionDiscovery: 'none', notes: 'Long-term non-expiring token; revoked by the advertiser. No refresh.' }),
  ad('microsoft', 'Microsoft Advertising', 'oauth2_pkce', { refresh: true, revokeProviderSide: false, permissionDiscovery: 'none', manualRevokeNote: MANUAL, notes: 'OAuth2 + PKCE, rotating refresh token; DeveloperToken header.' }),
  ad('reddit', 'Reddit Ads', 'oauth2', { refresh: true, revokeProviderSide: true, permissionDiscovery: 'none', notes: 'OAuth2 permanent refresh grant, HTTP Basic client auth.' }),
  ad('apple', 'Apple Ads', 'service_account', { refresh: true, revokeProviderSide: false, permissionDiscovery: 'none', manualRevokeNote: MANUAL, notes: 'Service-account ES256 JWT (client_credentials) or delegated refresh_token.' }),
  ad('snapchat', 'Snapchat Ads', 'oauth2', { refresh: true, revokeProviderSide: false, permissionDiscovery: 'none', manualRevokeNote: MANUAL }),
  ad('spotify', 'Spotify Ads', 'oauth2', { refresh: true, revokeProviderSide: false, permissionDiscovery: 'none', manualRevokeNote: MANUAL, notes: 'Partner Ads v3; create campaign draft only.' }),
  ad('pinterest', 'Pinterest Ads', 'oauth2', { refresh: true, revokeProviderSide: false, permissionDiscovery: 'none', manualRevokeNote: MANUAL, notes: 'continuous_refresh, Basic client auth.' }),
  ad('linkedin', 'LinkedIn Ads', 'oauth2', { refresh: true, revokeProviderSide: false, permissionDiscovery: 'none', manualRevokeNote: MANUAL, notes: 'Refresh-token expiry tracked; non-political/non-discrimination consent enforced.' }),
  ad('x', 'X Ads', 'oauth1', { refresh: false, revokeProviderSide: true, permissionDiscovery: 'none', notes: 'OAuth 1.0a (HMAC-SHA1 three-legged). Tokens persist until revoked.' }),
];
// Attach the audited reporting capability to each ad provider (single source of truth for gating).
for (const entry of AD_PROVIDERS) entry.reporting = REPORTING[entry.id];

/**
 * Commerce connectors. Adapters + sync engine + webhook verifier + schema are built and unit-tested, but
 * there is NO live HTTP transport wired and no credentials in this environment → live transport is
 * BLOCKED_EXTERNAL. Represented honestly: liveTransportImplemented = false.
 */
export const COMMERCE_PROVIDERS: ProviderRegistryEntry[] = (
  [
    ['salla', 'Salla', 'merchant_credentials'],
    ['zid', 'Zid', 'merchant_credentials'],
    ['shopify', 'Shopify', 'oauth2'],
    ['woocommerce', 'WooCommerce', 'api_key'],
    ['custom', 'Custom commerce', 'api_key'],
  ] as const
).map(([id, label, authType]) => ({
  id,
  label,
  category: 'commerce' as const,
  authType: authType as AuthType,
  liveTransportImplemented: false,
  capabilities: {
    connect: false, // no live connect path wired (no OAuth/credential ingress route outside tests)
    testConnection: false,
    refresh: false,
    scheduledRefresh: false,
    reauthorize: false,
    disconnect: true,
    revokeProviderSide: false,
    accountDiscovery: false,
    permissionDiscovery: 'none' as const,
    readEntities: true,   // orders/products/refunds normalization implemented
    writeControls: false, // commerce connectors are strictly read-only
    serverDryRun: false,
    webhook: true,        // HMAC-verified receiver implemented (no HTTP route mounted yet)
    sync: true,           // incremental sync engine implemented (no background runner)
  },
  notes: 'Read-only connector + sync engine + HMAC webhook verifier built & unit-tested. Live transport + credentials are BLOCKED_EXTERNAL; no ingress route or background runner is wired in-repo.',
}));

/** Platform-level services (not tenant ad connections, but part of the integration fleet the admin sees). */
export const PLATFORM_SERVICES: ProviderRegistryEntry[] = [
  { id: 'stripe', label: 'Stripe (billing)', category: 'platform_service', authType: 'api_key', liveTransportImplemented: true, capabilities: { connect: true, testConnection: true, refresh: false, scheduledRefresh: false, reauthorize: false, disconnect: false, revokeProviderSide: false, accountDiscovery: false, permissionDiscovery: 'none', readEntities: true, writeControls: true, serverDryRun: false, webhook: true, sync: false }, notes: 'Live-capable; gated on STRIPE_SECRET_KEY + STRIPE_WEBHOOK_SECRET (BLOCKED_EXTERNAL until configured).' },
  { id: 'ai_gateway', label: 'AI gateway / model providers', category: 'platform_service', authType: 'api_key', liveTransportImplemented: false, capabilities: { connect: false, testConnection: false, refresh: false, scheduledRefresh: false, reauthorize: false, disconnect: false, revokeProviderSide: false, accountDiscovery: false, permissionDiscovery: 'none', readEntities: false, writeControls: false, serverDryRun: false, webhook: false, sync: false }, notes: 'DORMANT governance seam; deterministic local narrator only. No live model wired (BLOCKED_EXTERNAL).' },
  { id: 'supabase_auth', label: 'Supabase / Auth (GoTrue)', category: 'platform_service', authType: 'service_account', liveTransportImplemented: true, capabilities: { connect: true, testConnection: true, refresh: true, scheduledRefresh: false, reauthorize: false, disconnect: false, revokeProviderSide: false, accountDiscovery: false, permissionDiscovery: 'none', readEntities: true, writeControls: true, serverDryRun: false, webhook: false, sync: false }, notes: 'Live auth provider; session/admin lifecycle APIs not surfaced here.' },
  { id: 'mcp', label: 'MCP server (ad tools)', category: 'platform_service', authType: 'oauth2_pkce', liveTransportImplemented: true, capabilities: { connect: true, testConnection: true, refresh: true, scheduledRefresh: true, reauthorize: true, disconnect: true, revokeProviderSide: true, accountDiscovery: false, permissionDiscovery: 'full', readEntities: true, writeControls: true, serverDryRun: false, webhook: false, sync: false }, notes: 'OAuth 2.1 authorization server (mandatory S256 PKCE); daily token purge scheduled.' },
  { id: 'resend_email', label: 'Resend (email)', category: 'platform_service', authType: 'api_key', liveTransportImplemented: true, capabilities: { connect: true, testConnection: false, refresh: false, scheduledRefresh: false, reauthorize: false, disconnect: false, revokeProviderSide: false, accountDiscovery: false, permissionDiscovery: 'none', readEntities: false, writeControls: true, serverDryRun: false, webhook: false, sync: false }, notes: 'Outbound email; gated on RESEND_API_KEY (BLOCKED_EXTERNAL until configured).' },
];

const BY_ID = new Map<string, ProviderRegistryEntry>(
  [...AD_PROVIDERS, ...COMMERCE_PROVIDERS, ...PLATFORM_SERVICES].map((e) => [e.id, e]),
);

export function connectionRegistry(id: string): ProviderRegistryEntry | undefined {
  return BY_ID.get(id);
}

export function allRegistryEntries(): ProviderRegistryEntry[] {
  return [...AD_PROVIDERS, ...COMMERCE_PROVIDERS, ...PLATFORM_SERVICES];
}

/** Level support for a provider (unknown provider or no reporting capability → NOT_SUPPORTED). */
export function reportingLevelSupport(providerId: string, level: HierarchyLevel): LevelSupport {
  return connectionRegistry(providerId)?.reporting?.levels[level] ?? 'NOT_SUPPORTED';
}

/** Breakdown-dimension support for a provider (absent → NOT_SUPPORTED). */
export function reportingDimensionSupport(providerId: string, dimension: BreakdownDimension): DimensionSupport {
  return connectionRegistry(providerId)?.reporting?.dimensions[dimension] ?? 'NOT_SUPPORTED';
}

/** The provider-native label for the ad_group level (defaults to the canonical "Ad group"). */
export function adGroupTerm(providerId: string): { en: string; ar: string } {
  return connectionRegistry(providerId)?.reporting?.adGroupTerm ?? { en: 'Ad group', ar: 'مجموعة إعلانية' };
}

/** Dimensions a provider can surface in SOME form (READY or RAW_ONLY) — used to gate the Explorer. */
export function reachableBreakdownDimensions(providerId: string): BreakdownDimension[] {
  const dims = connectionRegistry(providerId)?.reporting?.dimensions ?? {};
  return BREAKDOWN_DIMENSIONS.filter((d) => dims[d] === 'READY' || dims[d] === 'RAW_ONLY');
}
