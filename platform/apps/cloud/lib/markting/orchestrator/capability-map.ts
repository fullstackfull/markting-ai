import type { IntelligenceIntent } from './context';

/**
 * CODE-RC Program 26 — machine-checkable capability → route → section → tests map.
 *
 * Every user-facing intelligence capability must be reachable through a real product ROUTE and backed
 * by a real orchestrator SECTION (or a surface), with named TESTS. The accompanying test
 * (test/capability-map.test.ts) verifies each entry is internally consistent — the route file exists on
 * disk, the section kind is a real AnswerSection kind, and at least one test is named — so a capability
 * can never regress into a backend-only function with no surface. This is documentation that CI
 * enforces, not prose.
 */
export interface CapabilityEntry {
  capability: string;
  /** Repo-relative route page(s) that surface it (under apps/cloud/app). */
  routes: string[];
  /**
   * The orchestrator section kind(s) that back it, or 'surface' for a non-section product surface.
   * Validated at runtime against the real section-kind set in test/capability-map.test.ts (which
   * includes the standalone creativeDetail section that is not part of the AnswerSection union).
   */
  sections: string[];
  /** Primary orchestrator intent, when applicable. */
  intent?: IntelligenceIntent;
  /** Named tests that cover it (file basenames). */
  tests: string[];
}

export const CAPABILITY_MAP: CapabilityEntry[] = [
  { capability: 'Daily workspace review', routes: ['dashboard/workspace/page.tsx'], sections: ['surface'], intent: 'DAILY_REVIEW', tests: ['benchmark.test.ts', 'orchestrator.test.ts'] },
  { capability: 'Campaign diagnosis & drill-down', routes: ['dashboard/accounts/[accountId]/campaigns/[campaignId]/page.tsx'], sections: ['campaign', 'pacing', 'trend', 'scaling'], intent: 'CAMPAIGN_DIAGNOSIS', tests: ['benchmark.test.ts', 'orchestrator-golden-cases.test.ts'] },
  { capability: 'Creative fatigue & test ideas', routes: ['dashboard/creative/page.tsx', 'dashboard/creative/[creativeId]/page.tsx'], sections: ['creative', 'creativeDetail'], tests: ['benchmark.test.ts'] },
  { capability: 'Commerce profit / MER / refunds (UNKNOWN without COGS)', routes: ['dashboard/commerce/page.tsx'], sections: ['commerce'], intent: 'COMMERCE_PROFIT', tests: ['benchmark.test.ts', 'ratios.test.ts', 'phase5-commerce.test.ts'] },
  { capability: 'Budget pacing', routes: ['dashboard/workspace/page.tsx'], sections: ['pacing'], intent: 'PACING', tests: ['benchmark.test.ts', 'data-science-corrections.test.ts'] },
  { capability: 'Forecast (transparent method + band + limitations)', routes: ['dashboard/workspace/page.tsx'], sections: ['forecast'], intent: 'FORECAST', tests: ['benchmark.test.ts'] },
  { capability: 'Anomaly detection', routes: ['dashboard/workspace/page.tsx'], sections: ['anomaly'], intent: 'ANOMALY', tests: ['benchmark.test.ts'] },
  { capability: 'Scaling readiness', routes: ['dashboard/accounts/[accountId]/page.tsx'], sections: ['scaling'], intent: 'SCALING', tests: ['benchmark.test.ts', 'scale.test.ts'] },
  { capability: 'Budget scenario / allocation (conservation)', routes: ['dashboard/recommendations/page.tsx'], sections: ['scenario'], intent: 'BUDGET_SCENARIO', tests: ['benchmark.test.ts'] },
  { capability: 'Response curve / saturation / marginal ROAS', routes: ['dashboard/accounts/[accountId]/page.tsx'], sections: ['response'], intent: 'SATURATION', tests: ['benchmark.test.ts'] },
  { capability: 'Breakdown (placement/device/geo/audience)', routes: ['dashboard/accounts/[accountId]/page.tsx'], sections: ['breakdown'], intent: 'BREAKDOWN', tests: ['benchmark.test.ts'] },
  { capability: 'Cross-channel comparability', routes: ['dashboard/accounts/[accountId]/page.tsx'], sections: ['crossChannel'], intent: 'CROSS_CHANNEL', tests: ['benchmark.test.ts'] },
  { capability: 'Agency portfolio attention queue', routes: ['dashboard/agency/page.tsx'], sections: ['portfolio'], intent: 'PORTFOLIO_ATTENTION', tests: ['benchmark.test.ts'] },
  { capability: 'Recommendation outcomes history', routes: ['dashboard/recommendations/page.tsx'], sections: ['outcomes'], intent: 'OUTCOMES_HISTORY', tests: ['benchmark.test.ts', 'phase3-memory-outcomes.test.ts'] },
  { capability: 'Experiment workbench', routes: ['dashboard/experiments/page.tsx'], sections: ['experiments'], intent: 'EXPERIMENT_SUGGEST', tests: ['benchmark.test.ts'] },
  { capability: 'Data-quality center + provider schema-drift states', routes: ['dashboard/data-quality/page.tsx'], sections: ['dataQuality'], intent: 'DATA_QUALITY', tests: ['benchmark.test.ts'] },
  { capability: 'Executive summary', routes: ['dashboard/executive/page.tsx'], sections: ['portfolio', 'commerce'], tests: ['benchmark.test.ts'] },
  { capability: 'Cross-domain assistant answer (no write capability)', routes: ['dashboard/assistant/page.tsx'], sections: ['surface'], tests: ['benchmark.test.ts', 'ai-eval-harness.test.ts', 'assistant-service.test.ts'] },
  { capability: 'Governance & usage visibility (read-only)', routes: ['dashboard/governance/page.tsx'], sections: ['surface'], tests: ['runtime-mode.test.ts', 'production-mode-a.test.ts'] },
  { capability: 'Approvals / audit / policies (governed, read + guarded write)', routes: ['dashboard/approvals/page.tsx', 'dashboard/audit/page.tsx', 'dashboard/policies/page.tsx'], sections: ['surface'], tests: ['phase7-ops.database.test.ts'] },
];
