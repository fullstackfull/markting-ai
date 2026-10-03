-- WAVE 0.3 — MCP OAuth token hygiene.
--
-- private.purge_expired_mcp_oauth_records() was defined in 20260825120000_mcp_oauth.sql but NEVER
-- scheduled, so expired authorization codes and expired access/refresh tokens accumulated indefinitely
-- (a slow unbounded-growth leak). This migration:
--   (1) extends the purge to ALSO drop long-revoked refresh tokens (not only expired ones), so a
--       revoked grant does not linger past a grace day, and
--   (2) schedules the purge daily via pg_cron, alongside adport-data-retention and
--       adport-account-selection-expiry.
-- Forward-only and additive. Immutable audit (public.audit_events) is unaffected — these are
-- short-lived OAuth credential rows, not an audit trail; audit retention is handled separately by
-- private.apply_data_retention().

create or replace function private.purge_expired_mcp_oauth_records()
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  delete from private.mcp_oauth_authorization_codes where expires_at < now() - interval '1 day';
  delete from private.mcp_oauth_refresh_tokens where expires_at < now() - interval '1 day';
  delete from private.mcp_oauth_refresh_tokens where revoked_at is not null and revoked_at < now() - interval '1 day';
  delete from private.mcp_oauth_access_tokens where expires_at < now() - interval '1 day';
end;
$$;

revoke all on function private.purge_expired_mcp_oauth_records() from public, anon, authenticated;
grant execute on function private.purge_expired_mcp_oauth_records() to adport_backend;

-- Daily at 03:41 (jittered off the hour; after retention at 03:17). cron.schedule upserts by job name.
select cron.schedule('adport-mcp-oauth-purge', '41 3 * * *', 'select private.purge_expired_mcp_oauth_records()');
