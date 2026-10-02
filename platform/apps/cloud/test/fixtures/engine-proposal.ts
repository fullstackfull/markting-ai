/** Synthetic paid-media-agent proposal fixture (shape of `ProposalView` from the engine's demo run). */
export function syntheticProposal(overrides: Record<string, unknown> = {}) {
  return {
    version: 'presentation/1',
    proposal_id: '9c7d5308-7c4a-47d7-8222-5529eed7dffe',
    routing_id: '5J6MZxvV3AgXUTjKPtEX1HGf',
    revision: 1,
    state: 'awaiting_approval',
    platform: 'google_ads',
    account_ref: 'demo-google',
    tool_name: 'google_ads__update_campaign_budget',
    target_ref: 'g-103',
    before: [{ field: 'daily_budget', value: 300, unit: 'account currency per day' }],
    after: [{ field: 'daily_budget', value: 240, unit: 'account currency per day' }],
    reason: 'Performance Max spend fell while CPA rose; reduce daily budget by a reversible step.',
    risk: 'medium',
    measurement_plan: 'Compare CPA after 7 days.',
    reversal_plan: 'Restore through a new proposal.',
    payload_digest: 'cd5286c016490bc98c3dd57ef374885ec86ae8a66faf85bb2792708166c0cde1',
    catalog_revision: '5d9fa65fb3b21609c8bd',
    requester_ref: 'adport-bridge',
    risk_flags: ['budget_delta'],
    ...overrides,
  };
}

