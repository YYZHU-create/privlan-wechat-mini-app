-- Server-only provider state; permanent identities and existing rows are retained.
create table managed_auth_session_state (
  session_id uuid primary key,
  project_id text not null,
  provider_origin text not null,
  surface text not null check (surface in ('merchant','operator')),
  provider_user_id uuid not null,
  business_user_id uuid not null,
  merchant_session_id uuid references merchant_sessions(id),
  operator_session_id uuid references operator_sessions(id),
  issued_at_ms bigint not null,
  deadline_ms bigint not null,
  encrypted_state text not null check (length(encrypted_state) between 40 and 32768),
  foreign key(project_id,provider_origin,surface,provider_user_id)
    references managed_auth_identity_links(project_id,provider_origin,surface,provider_user_id),
  check (deadline_ms = issued_at_ms + 604800000),
  check ((surface='merchant' and merchant_session_id is not null and merchant_session_id=session_id and operator_session_id is null)
    or (surface='operator' and operator_session_id is not null and operator_session_id=session_id and merchant_session_id is null))
);
alter table managed_auth_session_state enable row level security;
revoke all on managed_auth_session_state from public;
do $$ begin
  if exists(select 1 from pg_roles where rolname='anon') then revoke all on managed_auth_session_state from anon; end if;
  if exists(select 1 from pg_roles where rolname='authenticated') then revoke all on managed_auth_session_state from authenticated; end if;
  if exists(select 1 from pg_roles where rolname='service_role') then
    grant select,insert,update,delete on managed_auth_session_state to service_role;
  end if;
end $$;
