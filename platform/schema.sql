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
  public_store_id text not null default ('store_public_' || replace(gen_random_uuid()::text, '-', '')) unique,
  name text not null,
  channel_mode text not null check (channel_mode in ('shared','merchant')),
  status text not null default 'draft',
  created_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, workspace_id, id)
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
  workspace_id uuid,
  store_id uuid not null references stores(id),
  order_no text not null,
  status text not null,
  payment_status text not null,
  amount_fen bigint not null check (amount_fen >= 0),
  customer_ref text,
  customer_id uuid,
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

create table customers (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  workspace_id uuid not null,
  store_id uuid not null,
  source text not null check (source in ('mini_program','merchant_manual','import','order','appointment')),
  name text,
  phone text,
  display_name text,
  avatar_url text,
  status text not null default 'active' check (status in ('active','blocked')),
  wechat_openid_hash text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  first_order_at timestamptz,
  last_order_at timestamptz,
  order_count integer not null default 0 check (order_count >= 0),
  total_spend_fen bigint not null default 0 check (total_spend_fen >= 0),
  appointment_count integer not null default 0 check (appointment_count >= 0),
  foreign key (tenant_id,workspace_id) references workspaces(tenant_id,id),
  foreign key (tenant_id,workspace_id,store_id) references stores(tenant_id,workspace_id,id),
  unique (workspace_id,wechat_openid_hash),
  unique (tenant_id,workspace_id,store_id,id)
);

alter table orders add constraint orders_customer_scope_fk foreign key (tenant_id,workspace_id,store_id,customer_id) references customers(tenant_id,workspace_id,store_id,id);
create index orders_customer_idx on orders (tenant_id,workspace_id,store_id,customer_id) where customer_id is not null;
create index customers_activity_idx on customers (tenant_id,workspace_id,store_id,last_seen_at desc);
create index customers_orders_idx on customers (tenant_id,workspace_id,store_id,last_order_at desc);

create table customer_events (
  id uuid primary key default gen_random_uuid(), tenant_id uuid not null, workspace_id uuid not null, store_id uuid not null,
  customer_id uuid not null, event_type text not null, source text not null, resource_type text, resource_id text,
  metadata jsonb not null default '{}', occurred_at timestamptz not null default now(), created_at timestamptz not null default now(),
  foreign key (tenant_id,workspace_id,store_id,customer_id) references customers(tenant_id,workspace_id,store_id,id),
  unique (tenant_id,workspace_id,store_id,event_type,source,resource_type,resource_id)
);
create index customer_events_customer_idx on customer_events (tenant_id,workspace_id,store_id,customer_id,occurred_at desc);

create table customer_tags (
  id uuid primary key default gen_random_uuid(), tenant_id uuid not null, workspace_id uuid not null, store_id uuid not null,
  name text not null, created_at timestamptz not null default now(), unique(tenant_id,workspace_id,store_id,id),
  foreign key (tenant_id,workspace_id,store_id) references stores(tenant_id,workspace_id,id)
);
create unique index customer_tags_name_idx on customer_tags (tenant_id,workspace_id,store_id,lower(name));
create table customer_tag_links (
  tenant_id uuid not null, workspace_id uuid not null, store_id uuid not null, customer_id uuid not null, tag_id uuid not null,
  created_at timestamptz not null default now(), primary key(customer_id,tag_id),
  foreign key (tenant_id,workspace_id,store_id,customer_id) references customers(tenant_id,workspace_id,store_id,id),
  foreign key (tenant_id,workspace_id,store_id,tag_id) references customer_tags(tenant_id,workspace_id,store_id,id)
);
create table customer_notes (
  id uuid primary key default gen_random_uuid(), tenant_id uuid not null, workspace_id uuid not null, store_id uuid not null,
  customer_id uuid not null, author_user_id uuid, content text not null, created_at timestamptz not null default now(),
  foreign key (tenant_id,workspace_id,store_id,customer_id) references customers(tenant_id,workspace_id,store_id,id)
);
create index customer_notes_customer_idx on customer_notes (tenant_id,workspace_id,store_id,customer_id,created_at desc);

create table membership_programs (
  id uuid primary key default gen_random_uuid(), tenant_id uuid not null, workspace_id uuid not null, store_id uuid not null,
  enabled boolean not null default false, points_enabled boolean not null default false, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  foreign key (tenant_id,workspace_id,store_id) references stores(tenant_id,workspace_id,id), unique(tenant_id,workspace_id,store_id)
);
create table membership_levels (
  id uuid primary key default gen_random_uuid(), tenant_id uuid not null, workspace_id uuid not null, store_id uuid not null,
  name text not null, level_order integer not null, growth_threshold bigint not null default 0, enabled boolean not null default true, benefits jsonb not null default '{}',
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), foreign key (tenant_id,workspace_id,store_id) references stores(tenant_id,workspace_id,id),
  unique(tenant_id,workspace_id,store_id,id), unique(tenant_id,workspace_id,store_id,level_order), unique(tenant_id,workspace_id,store_id,name)
);
create table customer_memberships (
  id uuid primary key default gen_random_uuid(), tenant_id uuid not null, workspace_id uuid not null, store_id uuid not null, customer_id uuid not null, level_id uuid not null,
  status text not null default 'active' check(status in ('active','inactive')), joined_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  foreign key (tenant_id,workspace_id,store_id,customer_id) references customers(tenant_id,workspace_id,store_id,id), foreign key (tenant_id,workspace_id,store_id,level_id) references membership_levels(tenant_id,workspace_id,store_id,id)
);
create unique index customer_memberships_active_idx on customer_memberships (tenant_id,workspace_id,store_id,customer_id) where status='active';
create table customer_points_accounts (
  tenant_id uuid not null, workspace_id uuid not null, store_id uuid not null, customer_id uuid not null, balance bigint not null default 0 check(balance >= 0), created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  primary key(tenant_id,workspace_id,store_id,customer_id), foreign key (tenant_id,workspace_id,store_id,customer_id) references customers(tenant_id,workspace_id,store_id,id)
);
create table customer_points_ledger (
  id uuid primary key default gen_random_uuid(), tenant_id uuid not null, workspace_id uuid not null, store_id uuid not null, customer_id uuid not null, type text not null check(type in ('earn','spend','adjust','expire')), points bigint not null, balance_after bigint not null check(balance_after >= 0), reason text not null, source_type text not null, source_id text, operator_id uuid, idempotency_key text not null, created_at timestamptz not null default now(),
  foreign key (tenant_id,workspace_id,store_id,customer_id) references customers(tenant_id,workspace_id,store_id,id), unique(tenant_id,workspace_id,store_id,idempotency_key)
);
create index customer_points_ledger_customer_idx on customer_points_ledger (tenant_id,workspace_id,store_id,customer_id,created_at desc);
create unique index customer_points_ledger_source_idx on customer_points_ledger (tenant_id,workspace_id,store_id,source_type,source_id,type) where source_id is not null;

create table appointment_settings (
  tenant_id uuid not null,
  workspace_id uuid not null,
  store_id uuid not null,
  timezone text not null default 'Asia/Shanghai',
  slot_interval_minutes integer not null default 30 check (slot_interval_minutes between 5 and 300 and slot_interval_minutes % 5 = 0),
  default_buffer_minutes integer not null default 1 check (default_buffer_minutes between 1 and 30),
  min_advance_minutes integer not null default 0 check (min_advance_minutes between 0 and 525600),
  max_advance_days integer not null default 30 check (max_advance_days between 1 and 365),
  booking_enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (workspace_id,store_id),
  foreign key (tenant_id,workspace_id) references workspaces(tenant_id,id),
  foreign key (tenant_id,workspace_id,store_id) references stores(tenant_id,workspace_id,id)
);

create table appointment_services (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  workspace_id uuid not null,
  store_id uuid not null,
  name text not null,
  description text not null default '',
  duration_minutes integer not null check (duration_minutes between 5 and 1440),
  buffer_minutes_override integer check (buffer_minutes_override between 0 and 480),
  enabled boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (tenant_id,workspace_id) references workspaces(tenant_id,id),
  foreign key (tenant_id,workspace_id,store_id) references stores(tenant_id,workspace_id,id),
  unique (tenant_id,workspace_id,store_id,id)
);

create table appointment_advisors (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  workspace_id uuid not null,
  store_id uuid not null,
  name text not null,
  enabled boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (tenant_id,workspace_id) references workspaces(tenant_id,id),
  foreign key (tenant_id,workspace_id,store_id) references stores(tenant_id,workspace_id,id),
  unique (tenant_id,workspace_id,store_id,id)
);

create table appointment_advisor_services (
  tenant_id uuid not null,
  workspace_id uuid not null,
  store_id uuid not null,
  advisor_id uuid not null,
  service_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (advisor_id,service_id),
  foreign key (tenant_id,workspace_id,store_id,advisor_id) references appointment_advisors(tenant_id,workspace_id,store_id,id),
  foreign key (tenant_id,workspace_id,store_id,service_id) references appointment_services(tenant_id,workspace_id,store_id,id)
);

create table appointment_business_hours (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  workspace_id uuid not null,
  store_id uuid not null,
  weekday integer not null check (weekday between 0 and 6),
  start_time time not null,
  end_time time not null,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (end_time > start_time),
  foreign key (tenant_id,workspace_id) references workspaces(tenant_id,id),
  foreign key (tenant_id,workspace_id,store_id) references stores(tenant_id,workspace_id,id),
  unique (store_id,weekday,start_time,end_time)
);

create table appointments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  workspace_id uuid not null,
  store_id uuid not null,
  customer_id uuid not null,
  service_id uuid not null,
  advisor_id uuid not null,
  appointment_number text not null,
  status text not null check (status in ('pending','confirmed','completed','cancelled','no_show')),
  start_at timestamptz not null,
  service_end_at timestamptz not null,
  occupied_until timestamptz not null,
  duration_minutes_snapshot integer not null check (duration_minutes_snapshot > 0),
  buffer_minutes_snapshot integer not null check (buffer_minutes_snapshot >= 0),
  timezone_snapshot text not null,
  customer_name_snapshot text not null,
  customer_phone_snapshot text not null,
  service_name_snapshot text not null,
  advisor_name_snapshot text not null,
  notes text not null default '',
  source text not null check (source in ('mini_program','merchant_manual','import')),
  idempotency_key text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (service_end_at > start_at),
  check (occupied_until >= service_end_at),
  foreign key (tenant_id,workspace_id) references workspaces(tenant_id,id),
  foreign key (tenant_id,workspace_id,store_id) references stores(tenant_id,workspace_id,id),
  foreign key (tenant_id,workspace_id,store_id,customer_id) references customers(tenant_id,workspace_id,store_id,id),
  foreign key (tenant_id,workspace_id,store_id,service_id) references appointment_services(tenant_id,workspace_id,store_id,id),
  foreign key (tenant_id,workspace_id,store_id,advisor_id) references appointment_advisors(tenant_id,workspace_id,store_id,id),
  unique (workspace_id,appointment_number),
  unique (workspace_id,idempotency_key)
);

create table appointment_import_runs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  workspace_id uuid not null,
  store_id uuid not null,
  source_kind text not null check (source_kind in ('normalized_json','feishu_export')),
  source_hash text not null,
  dry_run boolean not null default false,
  status text not null check (status in ('completed','failed')),
  imported_customers integer not null default 0,
  imported_appointments integer not null default 0,
  report jsonb not null default '{}',
  created_at timestamptz not null default now(),
  foreign key (tenant_id,workspace_id) references workspaces(tenant_id,id),
  foreign key (tenant_id,workspace_id,store_id) references stores(tenant_id,workspace_id,id),
  unique (workspace_id,source_hash,dry_run)
);

create index customers_scope_id_idx on customers (tenant_id,workspace_id,store_id,id);
create index appointment_services_scope_sort_idx on appointment_services (workspace_id,store_id,enabled,sort_order);
create index appointment_advisors_scope_sort_idx on appointment_advisors (workspace_id,store_id,enabled,sort_order);
create index appointment_business_hours_scope_idx on appointment_business_hours (workspace_id,store_id,weekday,enabled);
create index appointments_workspace_start_idx on appointments (workspace_id,start_at);
create index appointments_advisor_start_idx on appointments (advisor_id,start_at);
create index appointments_customer_start_idx on appointments (customer_id,start_at);
create index appointments_scope_status_idx on appointments (tenant_id,workspace_id,store_id,status,start_at);
create index appointment_import_runs_scope_idx on appointment_import_runs (tenant_id,workspace_id,store_id,created_at desc);
