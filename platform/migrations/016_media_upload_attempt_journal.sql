-- Media V1 durable upload attempts and request idempotency.
-- This is additive; it does not change existing asset, Storage, or lifecycle records.

create table public.media_upload_attempts (
  attempt_id uuid primary key,
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  workspace_id uuid not null references public.workspaces(id) on delete restrict,
  store_id uuid references public.stores(id) on delete restrict,
  owner_user_id uuid not null,
  operation text not null check (operation = 'POST /api/media/v1/upload'),
  idempotency_key_hash text not null check (idempotency_key_hash ~ '^[0-9a-f]{64}$'),
  request_fingerprint text not null check (request_fingerprint ~ '^[0-9a-f]{64}$'),
  asset_id uuid not null unique,
  expected_object_key text not null,
  content_sha256 text not null check (content_sha256 ~ '^[0-9a-f]{64}$'),
  content_length bigint not null check (content_length > 0),
  content_type text not null,
  original_name text not null,
  purpose text not null,
  variant text not null,
  entity_id text,
  position integer check (position is null or position >= 0),
  synthetic_canary boolean not null default false,
  asset_metadata jsonb not null default '{}'::jsonb,
  phase text not null check (phase in (
    'ATTEMPT_CREATED','DB_ASSET_CREATED','STORAGE_OBJECT_PRESENT',
    'ASSET_OBJECT_RECORDED','LINKS_RECORDED','READY_COMMITTED',
    'CLEANUP_REQUIRED','CLEANED'
  )),
  terminal_state text check (terminal_state is null or terminal_state in ('CONSISTENT_READY','CONSISTENT_CLEANED')),
  lease_token uuid,
  lease_expires_at timestamptz not null,
  last_error_class text,
  result jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint media_upload_attempt_idempotency_scope_uq unique nulls not distinct
    (tenant_id, workspace_id, store_id, owner_user_id, operation, idempotency_key_hash),
  constraint media_upload_attempt_terminal_state_ck check (
    (phase = 'READY_COMMITTED' and terminal_state = 'CONSISTENT_READY') or
    (phase = 'CLEANED' and terminal_state = 'CONSISTENT_CLEANED') or
    (phase not in ('READY_COMMITTED','CLEANED') and terminal_state is null)
  )
);

create index media_upload_attempt_recovery_idx
  on public.media_upload_attempts (lease_expires_at, created_at)
  where phase in ('ATTEMPT_CREATED','DB_ASSET_CREATED','STORAGE_OBJECT_PRESENT',
    'ASSET_OBJECT_RECORDED','LINKS_RECORDED','CLEANUP_REQUIRED');

alter table public.media_upload_attempts enable row level security;
revoke all on table public.media_upload_attempts from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on table public.media_upload_attempts from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on table public.media_upload_attempts from authenticated';
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant select, insert, update, delete on table public.media_upload_attempts to service_role;
  end if;
end
$$;
