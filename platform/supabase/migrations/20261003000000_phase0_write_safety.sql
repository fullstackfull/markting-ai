-- Phase 0 (P0-A) write-path safety: atomic/idempotent apply, actor model, apply-time revalidation.
-- Forward-only. Adds a lifecycle state machine and actor/approval columns to pending_operations and
-- admits the pre-write 'applying' intent audit event. No destructive change; no data loss.

alter table public.pending_operations
  add column if not exists state text not null default 'pending'
    check (state in ('pending', 'applying', 'applied', 'failed', 'superseded', 'rejected', 'expired')),
  add column if not exists requested_by_type text,
  add column if not exists requested_by_id text,
  add column if not exists approved_by_type text,
  add column if not exists approved_by_id text,
  add column if not exists preview_digest text,
  add column if not exists claimed_at timestamptz,
  add column if not exists applied_at timestamptz,
  add column if not exists failed_at timestamptz,
  add column if not exists apply_attempt_id uuid,
  add column if not exists result jsonb,
  add column if not exists failure_reason text;

-- Backfill legacy rows: a consumed row is terminal (treat as applied); an active row is pending.
update public.pending_operations
  set state = case when consumed_at is null then 'pending' else 'applied' end
  where state is null or state = 'pending';

-- The atomic claim (UPDATE … WHERE state='pending' … RETURNING) reads by (org, id); keep it fast.
create index if not exists pending_operations_claimable_idx
  on public.pending_operations (organization_id, id)
  where state = 'pending';

-- SEC-08: a pre-write 'applying' intent row is written before the external provider call, so a
-- completed-but-uncommitted write (crash after applyWrite) remains reconstructable from the log.
alter table public.audit_events drop constraint if exists audit_events_event_check;
alter table public.audit_events add constraint audit_events_event_check
  check (event in (
    'validated', 'applying', 'applied', 'rejected', 'note', 'connected', 'revoked',
    'api_key_created', 'api_key_revoked', 'member_invited', 'member_role_updated',
    'member_removed', 'settings_updated', 'deletion_requested',
    'subscription_updated', 'account_access_updated'
  ));
