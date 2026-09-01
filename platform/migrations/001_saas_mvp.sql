create table if not exists schema_migrations (
  version text primary key,
  applied_at timestamptz not null default now()
);

create table if not exists tenants (
  id uuid primary key,
  name text not null,
  status text not null default 'trial',
  created_at timestamptz not null default now()
);

create table if not exists users (
  id uuid primary key,
  login_identifier text not null unique,
  password_hash text not null,
  display_name text,
  status text not null default 'active' check (status in ('active','disabled')),
  password_change_required boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists workspaces (
  id uuid primary key,
  tenant_id uuid not null references tenants(id),
  name text not null,
  plan_id text not null default 'TRIAL',
  created_at timestamptz not null default now()
);

create table if not exists stores (
  id uuid primary key,
  tenant_id uuid not null references tenants(id),
  workspace_id uuid not null references workspaces(id),
  name text not null,
  channel_mode text not null default 'shared',
  status text not null default 'draft',
  created_at timestamptz not null default now()
);

create table if not exists memberships (
  tenant_id uuid not null references tenants(id),
  workspace_id uuid not null references workspaces(id),
  user_id uuid not null references users(id),
  role text not null,
  created_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);

create table if not exists workspace_configs (
  workspace_id uuid primary key references workspaces(id),
  tenant_id uuid not null references tenants(id),
  store_id uuid not null references stores(id),
  schema_version integer not null default 1,
  version integer not null default 1,
  document jsonb not null,
  updated_at timestamptz not null default now()
);

create table if not exists merchant_sessions (
  id uuid primary key,
  user_id uuid not null references users(id),
  workspace_id uuid not null references workspaces(id),
  token_hash text not null unique,
  csrf_token_hash text not null,
  ip_address text,
  user_agent text,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists plan_catalog (
  id text primary key,
  display_name text not null,
  price_fen integer not null default 0,
  duration_hours integer,
  public boolean not null default true,
  entitlements jsonb not null default '{}',
  updated_at timestamptz not null default now()
);

create table if not exists subscriptions (
  id uuid primary key,
  tenant_id uuid not null references tenants(id),
  workspace_id uuid references workspaces(id),
  plan_id text not null,
  status text not null,
  started_at timestamptz,
  expires_at timestamptz,
  current_period_end timestamptz,
  source text not null default 'system',
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table subscriptions add column if not exists workspace_id uuid references workspaces(id);
alter table subscriptions add column if not exists started_at timestamptz;
alter table subscriptions add column if not exists expires_at timestamptz;
alter table subscriptions add column if not exists source text not null default 'system';
alter table subscriptions add column if not exists updated_at timestamptz not null default now();

create unique index if not exists subscriptions_workspace_idx on subscriptions(workspace_id) where workspace_id is not null;

create table if not exists license_codes (
  id uuid primary key,
  code_hash text not null unique,
  code_masked text not null,
  plan_id text not null references plan_catalog(id),
  duration_hours integer not null check (duration_hours > 0),
  status text not null default 'unused',
  redeem_deadline timestamptz,
  max_uses integer not null default 1 check (max_uses > 0),
  used_count integer not null default 0 check (used_count >= 0),
  batch_id text,
  channel text,
  note text,
  created_by text not null,
  created_at timestamptz not null default now(),
  disabled_at timestamptz
);

create table if not exists license_redemptions (
  id uuid primary key,
  license_id uuid not null references license_codes(id),
  tenant_id uuid not null references tenants(id),
  workspace_id uuid not null references workspaces(id),
  user_id uuid not null references users(id),
  plan_id text not null,
  previous_expires_at timestamptz,
  new_expires_at timestamptz not null,
  redeemed_at timestamptz not null default now(),
  unique (license_id, workspace_id)
);

create table if not exists legacy_imports (
  id uuid primary key,
  source_hash text not null unique,
  tenant_id uuid not null references tenants(id),
  workspace_id uuid not null references workspaces(id),
  backup_path text not null,
  imported_at timestamptz not null default now(),
  metadata jsonb not null default '{}'
);

create table if not exists assets (
  id uuid primary key,
  tenant_id uuid not null references tenants(id),
  workspace_id uuid references workspaces(id),
  store_id uuid not null references stores(id),
  object_key text not null,
  original_name text,
  mime_type text not null,
  bytes bigint not null,
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now()
);

alter table assets add column if not exists workspace_id uuid references workspaces(id);
alter table assets add column if not exists original_name text;
create unique index if not exists assets_workspace_key_idx on assets(workspace_id, object_key) where workspace_id is not null;

create table if not exists audit_events (
  id uuid primary key,
  tenant_id uuid,
  workspace_id uuid,
  actor_type text not null,
  actor_id text not null,
  action text not null,
  resource_type text not null,
  resource_id text,
  request_id text not null,
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create table if not exists operator_users (
  id uuid primary key,
  email text not null unique,
  display_name text not null,
  password_hash text not null,
  role text not null,
  status text not null default 'active',
  created_at timestamptz not null default now()
);

create table if not exists operator_sessions (
  id uuid primary key,
  operator_id uuid not null references operator_users(id),
  token_hash text not null unique,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

insert into plan_catalog (id, display_name, price_fen, duration_hours, public, entitlements)
values
  ('TRIAL', '24小时体验', 0, 24, true, '{"preview":true,"ai":true}'),
  ('PRO', 'PRO', 29900, 720, true, '{"preview":true,"ai":true,"media":true}'),
  ('PRO_LEGACY', 'PRO', 0, null, false, '{"preview":true,"ai":true,"media":true}')
on conflict (id) do nothing;

create index if not exists merchant_sessions_token_idx on merchant_sessions(token_hash, expires_at);
create index if not exists memberships_user_idx on memberships(user_id, workspace_id);
create index if not exists license_codes_status_idx on license_codes(status, redeem_deadline);
create index if not exists license_redemptions_workspace_idx on license_redemptions(workspace_id, redeemed_at desc);
