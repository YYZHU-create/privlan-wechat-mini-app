create extension if not exists pgcrypto;
create extension if not exists vector;

create table tenants (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  status text not null check (status in ('trial','active','past_due','suspended','closed')),
  created_at timestamptz not null default now()
);

create table workspaces (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  name text not null,
  plan_id text not null,
  created_at timestamptz not null default now(),
  unique (tenant_id, id)
);

create table stores (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  workspace_id uuid not null references workspaces(id),
  name text not null,
  channel_mode text not null check (channel_mode in ('shared','merchant')),
  status text not null default 'draft',
  created_at timestamptz not null default now(),
  unique (tenant_id, id)
);

create table memberships (
  tenant_id uuid not null references tenants(id),
  workspace_id uuid not null references workspaces(id),
  user_id uuid not null,
  role text not null check (role in ('owner','admin','designer','operator','customer_service')),
  created_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);

create table design_documents (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  store_id uuid not null references stores(id),
  schema_version integer not null,
  version integer not null,
  status text not null check (status in ('draft','published')),
  document jsonb not null,
  override_keys jsonb not null default '[]',
  updated_at timestamptz not null default now(),
  unique (tenant_id, store_id, version)
);

create table assets (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  store_id uuid not null references stores(id),
  object_key text not null,
  mime_type text not null,
  bytes bigint not null,
  source_asset_id uuid,
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now(),
  unique (tenant_id, object_key)
);

create table products (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  store_id uuid not null references stores(id),
  merchant_sku text not null,
  title text not null,
  status text not null default 'draft',
  data jsonb not null,
  updated_at timestamptz not null default now(),
  unique (tenant_id, store_id, merchant_sku)
);

create table inventory_reservations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  store_id uuid not null references stores(id),
  sku_id uuid not null,
  order_id uuid not null,
  quantity integer not null check (quantity > 0),
  expires_at timestamptz not null,
  unique (tenant_id, store_id, sku_id, order_id)
);

create table orders (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  store_id uuid not null references stores(id),
  order_no text not null,
  status text not null,
  payment_status text not null,
  amount_fen bigint not null check (amount_fen >= 0),
  customer_ref text,
  data jsonb not null default '{}',
  created_at timestamptz not null default now(),
  unique (tenant_id, store_id, order_no)
);

create table publish_jobs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  store_id uuid not null references stores(id),
  channel_mode text not null check (channel_mode in ('shared','merchant')),
  environment text not null check (environment in ('preview','staging','production')),
  version text not null,
  status text not null,
  retry_count integer not null default 0,
  rollback_version text,
  request_id text not null,
  log jsonb not null default '[]',
  created_at timestamptz not null default now()
);

create table knowledge_chunks (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  store_id uuid not null references stores(id),
  source_type text not null,
  source_ref text not null,
  content text not null,
  embedding vector(1024),
  updated_at timestamptz not null default now()
);

create table ai_usage_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  store_id uuid not null references stores(id),
  request_id text not null unique,
  provider text not null,
  model text,
  intent_code text,
  result_code text not null,
  input_tokens integer not null default 0,
  output_tokens integer not null default 0,
  weighted_points integer not null default 0,
  escalated boolean not null default false,
  safety_event boolean not null default false,
  created_at timestamptz not null default now()
);

create table operator_users (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  display_name text not null,
  password_hash text not null,
  role text not null check (role in ('super_admin','operations','support','finance','auditor')),
  status text not null default 'active' check (status in ('active','disabled')),
  mfa_required boolean not null default true,
  created_at timestamptz not null default now()
);

create table operator_sessions (
  id uuid primary key default gen_random_uuid(),
  operator_id uuid not null references operator_users(id),
  token_hash text not null unique,
  ip_address inet,
  user_agent text,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

create table ai_provider_catalog (
  id text primary key,
  display_name text not null,
  protocol text not null check (protocol in ('openai')),
  default_base_url text,
  default_model text,
  capabilities jsonb not null default '{}',
  enabled boolean not null default true,
  updated_at timestamptz not null default now()
);

create table tenant_ai_connections (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references tenants(id),
  store_id uuid references stores(id),
  owner_type text not null check (owner_type in ('merchant','platform')),
  provider_id text references ai_provider_catalog(id),
  provider_name text not null,
  protocol text not null check (protocol in ('openai')),
  base_url text not null,
  model text not null,
  encrypted_secret bytea not null,
  kms_key_id text not null,
  settings jsonb not null default '{}',
  status text not null default 'active' check (status in ('active','disabled')),
  last_test_ok boolean,
  last_test_at timestamptz,
  last_error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((owner_type = 'platform' and tenant_id is null and store_id is null) or (owner_type = 'merchant' and tenant_id is not null and store_id is not null))
);

create table tenant_ai_policies (
  tenant_id uuid not null references tenants(id),
  store_id uuid not null references stores(id),
  mode text not null check (mode in ('rules','byok','platform')),
  connection_id uuid references tenant_ai_connections(id),
  platform_connection_id uuid references tenant_ai_connections(id),
  daily_point_limit bigint not null default 100000,
  fallback_to_rules boolean not null default true,
  updated_at timestamptz not null default now(),
  primary key (tenant_id, store_id)
);

create table ai_usage_reservations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  store_id uuid not null references stores(id),
  request_id text not null unique,
  points bigint not null check (points > 0),
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create table subscriptions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  plan_id text not null,
  status text not null check (status in ('trial','active','past_due','cancelled','refunded')),
  current_period_end timestamptz,
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create table feature_flags (
  id text not null,
  scope text not null check (scope in ('global','plan','tenant')),
  target_id text not null default '*',
  enabled boolean not null,
  config jsonb not null default '{}',
  updated_at timestamptz not null default now(),
  primary key (id, scope, target_id)
);

create table support_tickets (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  title text not null,
  priority text not null check (priority in ('low','normal','high','urgent')),
  status text not null check (status in ('open','in_progress','resolved','closed')),
  request_id text,
  assigned_operator_id uuid references operator_users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table incidents (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  severity text not null check (severity in ('minor','major','critical')),
  status text not null check (status in ('investigating','monitoring','resolved')),
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);

create table impersonation_sessions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  operator_id uuid not null references operator_users(id),
  reason text not null,
  expires_at timestamptz not null,
  ended_at timestamptz,
  created_at timestamptz not null default now()
);

create table audit_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references tenants(id),
  workspace_id uuid,
  actor_type text not null default 'merchant' check (actor_type in ('merchant','operator','system')),
  actor_id text not null,
  action text not null,
  resource_type text not null,
  resource_id text,
  request_id text not null,
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create index knowledge_chunks_scope_idx on knowledge_chunks (tenant_id, store_id, source_type);
create index publish_jobs_scope_idx on publish_jobs (tenant_id, store_id, created_at desc);
create index orders_scope_idx on orders (tenant_id, store_id, created_at desc);
create index audit_events_scope_idx on audit_events (tenant_id, created_at desc);
create index ai_connections_scope_idx on tenant_ai_connections (tenant_id, store_id, status);
create index ai_usage_reservations_expiry_idx on ai_usage_reservations (expires_at);
create index support_tickets_scope_idx on support_tickets (tenant_id, status, created_at desc);
create index operator_sessions_expiry_idx on operator_sessions (operator_id, expires_at);
