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

create table audit_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  workspace_id uuid,
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
