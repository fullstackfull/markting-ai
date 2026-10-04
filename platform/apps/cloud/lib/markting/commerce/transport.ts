import 'server-only';

/**
 * PHASE C.6 (11) — COMMERCE TRANSPORT ABSTRACTION.
 *
 * The wire concern isolated UNDER the one read-only CommerceConnector contract. A CommerceTransport is a
 * provider-neutral port: an authenticated, tenant-scoped request description -> one page of RAW provider
 * records. Connectors/normalizers sit above it and never see a URL, header or page cursor.
 *
 * READ-ONLY BY CONSTRUCTION: a request names a read resource and a page only; there is NO verb/method
 * field, so no mutating call (POST/PUT/PATCH/DELETE) is even representable in this type.
 *
 * Two implementations ship: FakeCommerceTransport (in-memory fixtures, FIXTURE_PROVEN, used in tests) and
 * BlockedHttpCommerceTransport — a real-HTTP stub that implements the port, carries NO network client, and
 * throws a BLOCKED_EXTERNAL marker if called (no credentials, no live calls in this environment). Per-
 * platform descriptors (base-path shape, pagination style, auth header name) are DOCUMENTATION_DERIVED
 * reference metadata only — never secrets.
 */
import type { CommercePlatform } from './model';
import type { HealthResult, SyncWindow } from './connector';
import type { PageSource, PageStyle } from '../ops/provider-pagination';

/** The read-only resources a commerce transport may fetch. No mutating resource exists. */
export const COMMERCE_READ_RESOURCES = ['stores', 'orders', 'products', 'refunds', 'inventory'] as const;
export type CommerceReadResource = (typeof COMMERCE_READ_RESOURCES)[number];

export function isReadResource(r: string): r is CommerceReadResource {
  return (COMMERCE_READ_RESOURCES as readonly string[]).includes(r);
}

/**
 * An authenticated, tenant-scoped read request. `connectionId` resolves credentials out of band (a secret
 * ref the transport layer looks up) — the secret itself never appears here. There is intentionally no
 * HTTP verb/body: the port can only ever read.
 */
export interface TransportRequest {
  connectionId: string;
  resource: CommerceReadResource;
  /** Sync window for windowed resources (orders/refunds); ignored by unwindowed ones. */
  window?: SyncWindow;
  /** Opaque next-page cursor/token, or null/undefined for the first page. */
  cursor?: string | null;
  /** Offset for offset/limit-style providers. */
  offset?: number;
  limit: number;
}

/** One page of raw, un-normalized provider records plus the next cursor (null when exhausted). */
export interface TransportPage {
  rows: unknown[];
  nextCursor: string | null;
}

/** DOCUMENTATION_DERIVED wire metadata for a platform. Shapes only — no versions baked as secrets, no keys. */
export interface TransportDescriptor {
  platform: CommercePlatform;
  /** Base path SHAPE with `{resource}`/`{version}` placeholders — documentation-derived, not a live URL. */
  basePathShape: string;
  /** Traversal style, reusing provider-pagination's PageStyle vocabulary. */
  pageStyle: PageStyle;
  /** The auth header a live client WOULD set (name only; never a value). */
  authHeaderName: string;
  source: 'DOCUMENTATION_DERIVED';
}

/**
 * The provider-neutral transport port. A connector's RawSource is implemented on top of this: it issues
 * read requests and receives raw pages. Classification mirrors the connector's HealthResult vocabulary.
 */
export interface CommerceTransport {
  readonly platform: CommercePlatform;
  readonly classification: HealthResult['classification'];
  descriptor(): TransportDescriptor;
  fetchPage(req: TransportRequest): Promise<TransportPage>;
}

/** Per-platform documentation-derived descriptors. Reference metadata for the provider matrix, not logic. */
export const COMMERCE_TRANSPORT_DESCRIPTORS: Record<CommercePlatform, TransportDescriptor> = {
  shopify: { platform: 'shopify', basePathShape: '/admin/api/{version}/{resource}.json', pageStyle: 'cursor', authHeaderName: 'X-Shopify-Access-Token', source: 'DOCUMENTATION_DERIVED' },
  woocommerce: { platform: 'woocommerce', basePathShape: '/wp-json/wc/v3/{resource}', pageStyle: 'offset_limit', authHeaderName: 'Authorization', source: 'DOCUMENTATION_DERIVED' },
  salla: { platform: 'salla', basePathShape: '/admin/v2/{resource}', pageStyle: 'paging_next', authHeaderName: 'Authorization', source: 'DOCUMENTATION_DERIVED' },
  zid: { platform: 'zid', basePathShape: '/v1/managers/store/{resource}', pageStyle: 'offset_limit', authHeaderName: 'Authorization', source: 'DOCUMENTATION_DERIVED' },
  custom: { platform: 'custom', basePathShape: '/{resource}', pageStyle: 'cursor', authHeaderName: 'Authorization', source: 'DOCUMENTATION_DERIVED' },
};

/** The marker a blocked real-HTTP transport reports — it NEVER performs a network call. */
export const BLOCKED_EXTERNAL_MARKER = 'BLOCKED_EXTERNAL' as const;

export class BlockedExternalError extends Error {
  readonly marker = BLOCKED_EXTERNAL_MARKER;
  readonly platform: CommercePlatform;
  constructor(platform: CommercePlatform) {
    super(`BLOCKED_EXTERNAL: live HTTP transport for ${platform} ships no network client (no credentials, no live calls)`);
    this.name = 'BlockedExternalError';
    this.platform = platform;
  }
}

/**
 * In-memory fixture transport. Pages the fixture rows per resource using the request's cursor/offset so the
 * same traversal path a live provider exercises is driven deterministically. Classification FIXTURE_PROVEN.
 */
export class FakeCommerceTransport implements CommerceTransport {
  readonly classification = 'FIXTURE_PROVEN' as const;
  constructor(
    readonly platform: CommercePlatform,
    private fixtures: Partial<Record<CommerceReadResource, unknown[]>> = {},
  ) {}
  descriptor(): TransportDescriptor { return COMMERCE_TRANSPORT_DESCRIPTORS[this.platform]; }
  async fetchPage(req: TransportRequest): Promise<TransportPage> {
    if (!isReadResource(req.resource)) throw new Error(`unknown read resource: ${req.resource}`);
    const all = this.fixtures[req.resource] ?? [];
    const start = req.cursor != null ? Number(req.cursor) : (req.offset ?? 0);
    const size = req.limit > 0 ? req.limit : all.length;
    const rows = all.slice(start, start + size);
    const next = start + size;
    return { rows, nextCursor: next < all.length ? String(next) : null };
  }
}

/**
 * Real-HTTP transport STUB. Implements the port so wiring type-checks, but ships no fetch/client and refuses
 * every call with a BLOCKED_EXTERNAL marker. This is the only place a live client would ever live; it is left
 * deliberately empty. BLOCKED_EXTERNAL.
 */
export class BlockedHttpCommerceTransport implements CommerceTransport {
  readonly classification = 'BLOCKED_EXTERNAL' as const;
  constructor(readonly platform: CommercePlatform) {}
  descriptor(): TransportDescriptor { return COMMERCE_TRANSPORT_DESCRIPTORS[this.platform]; }
  async fetchPage(_req: TransportRequest): Promise<TransportPage> {
    // BLOCKED_EXTERNAL: never invoked in this environment. No network client exists here on purpose.
    throw new BlockedExternalError(this.platform);
  }
}

/**
 * Adapt a transport + a read resource into a provider-pagination PageSource, so `paginate` drives cursor
 * traversal (loop-protection + bounded iteration) over a commerce transport without reimplementing paging.
 */
export function transportPageSource(
  transport: CommerceTransport,
  args: { connectionId: string; resource: CommerceReadResource; window?: SyncWindow; limit: number },
): PageSource<unknown> {
  return {
    style: transport.descriptor().pageStyle,
    limit: args.limit,
    async fetchPage(req) {
      const page = await transport.fetchPage({
        connectionId: args.connectionId,
        resource: args.resource,
        window: args.window,
        cursor: req.cursor,
        offset: req.offset,
        limit: req.limit,
      });
      return { rows: page.rows, nextCursor: page.nextCursor };
    },
  };
}
