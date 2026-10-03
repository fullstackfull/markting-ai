import 'server-only';
import { z } from 'zod';
import { db } from '@/lib/db';

/**
 * Tenant marketing/business context (Phase 1G). Every value carries explicit provenance so the AI can
 * distinguish KNOWN (read from a connected source), CONFIGURED (the user set it), DERIVED (computed
 * from other known values), and UNKNOWN (absent — never invented). Missing values stay UNKNOWN; the
 * model is told so rather than being handed a fabricated number.
 */
export const PROVENANCE = ['KNOWN', 'CONFIGURED', 'DERIVED', 'UNKNOWN'] as const;
export type Provenance = (typeof PROVENANCE)[number];

export interface Valued<T> { value: T; provenance: Provenance }

export interface BusinessContext {
  organizationId: string;
  primaryObjective: Valued<string | null>;
  targetCountries: Valued<string[]>;
  reportingCurrency: Valued<string | null>;
  timezone: Valued<string | null>;
  targetCpa: Valued<number | null>;
  targetRoas: Valued<number | null>;
  dailyBudget: Valued<number | null>;
  monthlyBudget: Valued<number | null>;
  brandName: Valued<string | null>;
  productCategory: Valued<string | null>;
  // Future fields — modeled but never invented; UNKNOWN until a commerce connector (1Q) supplies them.
  grossMargin: Valued<number | null>;
  cogs: Valued<number | null>;
  ltv: Valued<number | null>;
  breakEvenRoas: Valued<number | null>;
}

const UNKNOWN = <T>(value: T): Valued<T> => ({ value, provenance: 'UNKNOWN' });

export function emptyBusinessContext(organizationId: string): BusinessContext {
  return {
    organizationId,
    primaryObjective: UNKNOWN(null), targetCountries: UNKNOWN([]), reportingCurrency: UNKNOWN(null),
    timezone: UNKNOWN(null), targetCpa: UNKNOWN(null), targetRoas: UNKNOWN(null),
    dailyBudget: UNKNOWN(null), monthlyBudget: UNKNOWN(null), brandName: UNKNOWN(null), productCategory: UNKNOWN(null),
    grossMargin: UNKNOWN(null), cogs: UNKNOWN(null), ltv: UNKNOWN(null), breakEvenRoas: UNKNOWN(null),
  };
}

/** Derive break-even ROAS from gross margin when margin is KNOWN/CONFIGURED (breakEven = 1/margin). */
export function withDerived(ctx: BusinessContext): BusinessContext {
  if (ctx.breakEvenRoas.provenance === 'UNKNOWN' && ctx.grossMargin.value && ctx.grossMargin.value > 0 && ctx.grossMargin.provenance !== 'UNKNOWN') {
    return { ...ctx, breakEvenRoas: { value: Math.round((1 / ctx.grossMargin.value) * 100) / 100, provenance: 'DERIVED' } };
  }
  return ctx;
}

const configuredSchema = z.object({
  primaryObjective: z.string().min(1).optional(),
  targetCountries: z.array(z.string()).optional(),
  reportingCurrency: z.string().optional(),
  timezone: z.string().optional(),
  targetCpa: z.number().positive().optional(),
  targetRoas: z.number().positive().optional(),
  dailyBudget: z.number().positive().optional(),
  monthlyBudget: z.number().positive().optional(),
  brandName: z.string().optional(),
  productCategory: z.string().optional(),
  grossMargin: z.number().positive().max(1).optional(),
}).strict();
export type ConfiguredContext = z.infer<typeof configuredSchema>;

/** Merge user-configured values (all tagged CONFIGURED) onto the UNKNOWN base, then derive. */
export function applyConfigured(base: BusinessContext, raw: unknown): BusinessContext {
  const parsed = configuredSchema.parse(raw ?? {});
  const set = <T>(cur: Valued<T>, v: T | undefined): Valued<T> => (v === undefined ? cur : { value: v, provenance: 'CONFIGURED' });
  return withDerived({
    ...base,
    primaryObjective: set(base.primaryObjective, parsed.primaryObjective ?? undefined),
    targetCountries: parsed.targetCountries ? { value: parsed.targetCountries, provenance: 'CONFIGURED' } : base.targetCountries,
    reportingCurrency: set(base.reportingCurrency, parsed.reportingCurrency ?? undefined),
    timezone: set(base.timezone, parsed.timezone ?? undefined),
    targetCpa: set(base.targetCpa, parsed.targetCpa ?? undefined),
    targetRoas: set(base.targetRoas, parsed.targetRoas ?? undefined),
    dailyBudget: set(base.dailyBudget, parsed.dailyBudget ?? undefined),
    monthlyBudget: set(base.monthlyBudget, parsed.monthlyBudget ?? undefined),
    brandName: set(base.brandName, parsed.brandName ?? undefined),
    productCategory: set(base.productCategory, parsed.productCategory ?? undefined),
    grossMargin: set(base.grossMargin, parsed.grossMargin ?? undefined),
  });
}

/** Load tenant business context from Postgres (org-scoped), merged onto the UNKNOWN base. */
export async function loadBusinessContext(organizationId: string): Promise<BusinessContext> {
  const rows = await db()<Array<{ configured: unknown }>>`
    select configured from public.markting_business_context where organization_id = ${organizationId} limit 1`;
  const base = emptyBusinessContext(organizationId);
  return rows[0] ? applyConfigured(base, rows[0].configured) : base;
}

export async function saveBusinessContext(organizationId: string, raw: unknown): Promise<BusinessContext> {
  const parsed = configuredSchema.parse(raw ?? {});
  await db()`
    insert into public.markting_business_context (organization_id, configured, updated_at)
    values (${organizationId}, ${db().json(parsed as never)}, now())
    on conflict (organization_id) do update set configured = excluded.configured, updated_at = now()`;
  return loadBusinessContext(organizationId);
}
