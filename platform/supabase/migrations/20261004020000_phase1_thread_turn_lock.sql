-- Phase 1N — per-thread turn serialization. Forward-only, additive. A single in-flight turn per
-- thread is claimed via a compare-and-set on these columns; different threads/orgs run in parallel.
alter table public.markting_threads
  add column if not exists processing_request_id text,
  add column if not exists processing_at timestamptz;
