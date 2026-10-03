-- Provider subjects are separate from permanent business identities.
-- Provisioning is an explicit server/admin operation, never email auto-linking.
create table managed_auth_identity_links (
  project_id text not null check (length(project_id) between 1 and 100),
  provider_origin text not null check (provider_origin ~ '^https://[A-Za-z0-9.-]+(:[0-9]+)?$'),
  surface text not null check (surface in ('merchant', 'operator')),
  provider_user_id uuid not null,
  merchant_user_id uuid references users(id),
  operator_user_id uuid references operator_users(id),
  created_at timestamptz not null default now(),
  primary key (project_id, provider_origin, surface, provider_user_id),
  constraint managed_auth_surface_identity_check check (
    (surface = 'merchant' and merchant_user_id is not null and operator_user_id is null)
    or (surface = 'operator' and operator_user_id is not null and merchant_user_id is null)
  )
);

create unique index managed_auth_merchant_identity_unique
  on managed_auth_identity_links(project_id, provider_origin, merchant_user_id)
  where merchant_user_id is not null;
create unique index managed_auth_operator_identity_unique
  on managed_auth_identity_links(project_id, provider_origin, operator_user_id)
  where operator_user_id is not null;

alter table managed_auth_identity_links enable row level security;
revoke all on managed_auth_identity_links from public;

-- Portable local PostgreSQL does not define Supabase roles. Where they exist,
-- remove default client grants and grant only server-side operations.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on managed_auth_identity_links from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke all on managed_auth_identity_links from authenticated;
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant select, insert, update, delete on managed_auth_identity_links to service_role;
  end if;
end $$;
