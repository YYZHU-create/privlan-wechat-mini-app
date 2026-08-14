create table if not exists workspace_media_folders (
  id uuid primary key,
  tenant_id uuid not null references tenants(id),
  workspace_id uuid not null references workspaces(id),
  name text not null,
  created_at timestamptz not null default now(),
  unique(workspace_id, name)
);

create table if not exists merchant_ai_connections (
  id uuid primary key,
  tenant_id uuid not null references tenants(id),
  workspace_id uuid not null references workspaces(id),
  store_id uuid not null references stores(id),
  provider_preset text not null,
  provider_name text not null,
  base_url text not null,
  model text not null,
  encrypted_secret jsonb not null,
  timeout_ms integer not null default 12000,
  max_tokens integer not null default 500,
  status text not null default 'active',
  last_test_ok boolean,
  last_test_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists merchant_ai_policies (
  tenant_id uuid not null references tenants(id),
  workspace_id uuid not null references workspaces(id),
  store_id uuid not null references stores(id),
  mode text not null default 'rules',
  connection_id uuid references merchant_ai_connections(id),
  fallback_to_rules boolean not null default true,
  updated_at timestamptz not null default now(),
  primary key(workspace_id, store_id)
);

create index if not exists merchant_ai_connections_scope_idx on merchant_ai_connections(tenant_id,workspace_id,store_id,status);
create index if not exists media_folders_scope_idx on workspace_media_folders(tenant_id,workspace_id);
