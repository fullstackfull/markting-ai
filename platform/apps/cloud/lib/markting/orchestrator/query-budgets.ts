/**
 * CODE-RC Program 9 — per-surface DB query-count BUDGETS.
 *
 * Each dashboard surface declares the maximum number of DB round-trips its server render is expected to
 * make, derived from the query-path audit (docs/code-rc/02-db-scale.md). The budget is a ceiling that
 * must be INDEPENDENT of account size — a surface that renders 10 or 10,000 campaigns must issue the
 * same bounded set of queries (the orchestrator reads a bounded window + the bounded context gatherer;
 * it never issues one query per campaign/creative/order). The telemetry `gather_duration` events
 * (intel-telemetry.ts) are where a live deployment would assert these at runtime.
 *
 * These are intentionally generous ceilings, not tight assertions — the point is to catch a REGRESSION
 * into an account-size-dependent query explosion, not to micro-tune a constant.
 */
export interface QueryBudget {
  surface: string;
  /** Max DB round-trips for a server render, independent of account size. */
  maxQueries: number;
  /** The bounded reads the budget covers (documentation of what is counted). */
  reads: string[];
}

export const QUERY_BUDGETS: Record<string, QueryBudget> = {
  workspace: { surface: 'dashboard/workspace', maxQueries: 12, reads: ['tenant', 'account window', 'campaign window (bounded)', 'recommendations by status', 'data-quality'] },
  account: { surface: 'dashboard/accounts/[accountId]', maxQueries: 14, reads: ['tenant', 'account', 'campaign window (bounded)', 'breakdowns', 'channels', 'memory'] },
  campaign: { surface: 'dashboard/accounts/[accountId]/campaigns/[campaignId]', maxQueries: 10, reads: ['tenant', 'campaign', 'creatives for campaign (indexed)', 'outcomes'] },
  creative: { surface: 'dashboard/creative/[creativeId]', maxQueries: 8, reads: ['tenant', 'creative', 'analysis', 'signals'] },
  commerce: { surface: 'dashboard/commerce', maxQueries: 12, reads: ['tenant', 'orders window (indexed)', 'refunds', 'cost book (distinct-on)'] },
  agencyPortfolio: { surface: 'dashboard/agency', maxQueries: 16, reads: ['tenant', 'per-client bounded summary (fixed client set, not per-row)'] },
  executive: { surface: 'dashboard/executive', maxQueries: 16, reads: ['tenant', 'portfolio summary', 'commerce summary'] },
} as const;

/** The invariant a regression test / runtime telemetry can assert: a surface's queries ≤ its budget. */
export function withinBudget(surface: keyof typeof QUERY_BUDGETS, observedQueries: number): boolean {
  const budget = QUERY_BUDGETS[surface];
  return budget != null && observedQueries <= budget.maxQueries;
}
