/**
 * Who is acting on a write operation. Every pending operation records the actor that
 * *requested* it (at validate) and the actor that *approved* it (at apply); the policy
 * engine uses these to enforce that a real human approves every applied mutation and
 * that the requester cannot approve their own change (four-eyes).
 *
 * This is deliberately a small, explicit model. It is NOT an authorization system —
 * scopes/roles are enforced by the hosting app before a write reaches the engine. The
 * actor model answers a narrower question: "is this apply a human approval, and is that
 * human someone other than the requester?"
 */
export type ActorType =
  | 'human_user' // a signed-in person (the only type allowed to approve/apply a write)
  | 'service' // a trusted internal service job
  | 'ai_agent' // the AI engine proposing a change (may request, never approve)
  | 'api_client' // an API key or external OAuth client (may request, never approve)
  | 'system_job'; // a scheduled/automated system task

export interface ApplyActor {
  type: ActorType;
  /** Stable id for the actor (user id, api key id, oauth token id, …). May be null for legacy rows. */
  id: string | null;
}

/** Only a human with a known id may approve/apply a write. No autonomous apply in Phase 0. */
export function isHumanApprover(actor: ApplyActor | undefined): actor is ApplyActor {
  return !!actor && actor.type === 'human_user' && typeof actor.id === 'string' && actor.id.length > 0;
}

/** Two actors are the same person only when both are human and share a non-null id. */
export function sameActor(a: ApplyActor | undefined, b: ApplyActor | undefined): boolean {
  return (
    !!a && !!b && a.type === 'human_user' && b.type === 'human_user' && a.id !== null && a.id === b.id
  );
}

/** The local single-operator identity used by the CLI / standalone MCP server (no hosted session). */
export const LOCAL_OPERATOR: ApplyActor = { type: 'human_user', id: 'local-operator' };
