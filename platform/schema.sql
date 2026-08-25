-- AUTHORITATIVE SCHEMA: generated from migrations 001-006. Apply migrations for upgrades.

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

alter table stores add column if not exists public_store_id text;
update stores set public_store_id='store_public_'||replace(gen_random_uuid()::text,'-','') where public_store_id is null or public_store_id='';
alter table stores alter column public_store_id set not null;
alter table stores alter column public_store_id set default ('store_public_'||replace(gen_random_uuid()::text,'-',''));
create unique index if not exists stores_public_store_id_idx on stores(public_store_id);
create unique index if not exists workspaces_tenant_id_id_idx on workspaces(tenant_id,id);
create unique index if not exists stores_scope_id_idx on stores(tenant_id,workspace_id,id);

create table if not exists customers (
 id uuid primary key, tenant_id uuid not null, workspace_id uuid not null, store_id uuid not null,
 source text not null check(source in('mini_program','merchant_manual','import')), name text not null, phone text not null,
 wechat_openid_hash text, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 foreign key(tenant_id,workspace_id) references workspaces(tenant_id,id),
 foreign key(tenant_id,workspace_id,store_id) references stores(tenant_id,workspace_id,id), unique(workspace_id,wechat_openid_hash)
);
create unique index if not exists customers_scope_id_idx on customers(tenant_id,workspace_id,store_id,id);

create table if not exists appointment_settings (
 tenant_id uuid not null, workspace_id uuid not null, store_id uuid not null, timezone text not null default 'Asia/Shanghai',
 slot_interval_minutes integer not null default 30 check(slot_interval_minutes between 5 and 120 and slot_interval_minutes%5=0),
 default_buffer_minutes integer not null default 0 check(default_buffer_minutes between 0 and 480),
 min_advance_minutes integer not null default 120 check(min_advance_minutes between 0 and 525600),
 max_advance_days integer not null default 30 check(max_advance_days between 1 and 365), booking_enabled boolean not null default true,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(), primary key(workspace_id,store_id),
 foreign key(tenant_id,workspace_id) references workspaces(tenant_id,id), foreign key(tenant_id,workspace_id,store_id) references stores(tenant_id,workspace_id,id)
);

create table if not exists appointment_services (
 id uuid primary key, tenant_id uuid not null, workspace_id uuid not null, store_id uuid not null, name text not null,
 description text not null default '', duration_minutes integer not null check(duration_minutes between 5 and 1440),
 buffer_minutes_override integer check(buffer_minutes_override between 0 and 480), enabled boolean not null default true, sort_order integer not null default 0,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 foreign key(tenant_id,workspace_id) references workspaces(tenant_id,id), foreign key(tenant_id,workspace_id,store_id) references stores(tenant_id,workspace_id,id)
);
create unique index if not exists appointment_services_scope_id_idx on appointment_services(tenant_id,workspace_id,store_id,id);
create index if not exists appointment_services_scope_sort_idx on appointment_services(workspace_id,store_id,enabled,sort_order);

create table if not exists appointment_advisors (
 id uuid primary key, tenant_id uuid not null, workspace_id uuid not null, store_id uuid not null, name text not null,
 enabled boolean not null default true, sort_order integer not null default 0, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 foreign key(tenant_id,workspace_id) references workspaces(tenant_id,id), foreign key(tenant_id,workspace_id,store_id) references stores(tenant_id,workspace_id,id)
);
create unique index if not exists appointment_advisors_scope_id_idx on appointment_advisors(tenant_id,workspace_id,store_id,id);
create index if not exists appointment_advisors_scope_sort_idx on appointment_advisors(workspace_id,store_id,enabled,sort_order);

create table if not exists appointment_advisor_services (
 tenant_id uuid not null, workspace_id uuid not null, store_id uuid not null, advisor_id uuid not null, service_id uuid not null,
 created_at timestamptz not null default now(), primary key(advisor_id,service_id),
 foreign key(tenant_id,workspace_id,store_id,advisor_id) references appointment_advisors(tenant_id,workspace_id,store_id,id),
 foreign key(tenant_id,workspace_id,store_id,service_id) references appointment_services(tenant_id,workspace_id,store_id,id)
);

create table if not exists appointment_business_hours (
 id uuid primary key, tenant_id uuid not null, workspace_id uuid not null, store_id uuid not null, weekday integer not null check(weekday between 0 and 6),
 start_time time not null, end_time time not null, enabled boolean not null default true, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 check(end_time>start_time), foreign key(tenant_id,workspace_id) references workspaces(tenant_id,id),
 foreign key(tenant_id,workspace_id,store_id) references stores(tenant_id,workspace_id,id), unique(store_id,weekday,start_time,end_time)
);
create index if not exists appointment_business_hours_scope_idx on appointment_business_hours(workspace_id,store_id,weekday,enabled);

create table if not exists appointments (
 id uuid primary key, tenant_id uuid not null, workspace_id uuid not null, store_id uuid not null, customer_id uuid not null, service_id uuid not null, advisor_id uuid not null,
 appointment_number text not null, status text not null check(status in('pending','confirmed','completed','cancelled','no_show')),
 start_at timestamptz not null, service_end_at timestamptz not null, occupied_until timestamptz not null,
 duration_minutes_snapshot integer not null check(duration_minutes_snapshot>0), buffer_minutes_snapshot integer not null check(buffer_minutes_snapshot>=0),
 timezone_snapshot text not null, customer_name_snapshot text not null, customer_phone_snapshot text not null, service_name_snapshot text not null, advisor_name_snapshot text not null,
 notes text not null default '', source text not null check(source in('mini_program','merchant_manual','import')), idempotency_key text not null,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(), check(service_end_at>start_at), check(occupied_until>=service_end_at),
 foreign key(tenant_id,workspace_id) references workspaces(tenant_id,id), foreign key(tenant_id,workspace_id,store_id) references stores(tenant_id,workspace_id,id),
 foreign key(tenant_id,workspace_id,store_id,customer_id) references customers(tenant_id,workspace_id,store_id,id),
 foreign key(tenant_id,workspace_id,store_id,service_id) references appointment_services(tenant_id,workspace_id,store_id,id),
 foreign key(tenant_id,workspace_id,store_id,advisor_id) references appointment_advisors(tenant_id,workspace_id,store_id,id),
 unique(workspace_id,appointment_number), unique(workspace_id,idempotency_key)
);
create index if not exists appointments_workspace_start_idx on appointments(workspace_id,start_at);
create index if not exists appointments_advisor_start_idx on appointments(advisor_id,start_at);
create index if not exists appointments_customer_start_idx on appointments(customer_id,start_at);
create index if not exists appointments_scope_status_idx on appointments(tenant_id,workspace_id,store_id,status,start_at);

create table if not exists appointment_import_runs (
 id uuid primary key, tenant_id uuid not null, workspace_id uuid not null, store_id uuid not null,
 source_kind text not null check(source_kind in('normalized_json','feishu_export')), source_hash text not null,
 dry_run boolean not null default false, status text not null check(status in('completed','failed')),
 imported_customers integer not null default 0, imported_appointments integer not null default 0,
 report jsonb not null default '{}', created_at timestamptz not null default now(),
 foreign key(tenant_id,workspace_id) references workspaces(tenant_id,id),
 foreign key(tenant_id,workspace_id,store_id) references stores(tenant_id,workspace_id,id),
 unique(workspace_id,source_hash,dry_run)
);
create index if not exists appointment_import_runs_scope_idx on appointment_import_runs(tenant_id,workspace_id,store_id,created_at desc);

insert into appointment_settings(tenant_id,workspace_id,store_id) select tenant_id,workspace_id,id from stores on conflict(workspace_id,store_id) do nothing;
insert into appointment_services(id,tenant_id,workspace_id,store_id,name,description,duration_minutes,sort_order)
 select gen_random_uuid(),tenant_id,workspace_id,id,'预约服务','从原有预约系统迁移的默认服务',135,0 from stores s
 where not exists(select 1 from appointment_services x where x.store_id=s.id);
insert into appointment_advisors(id,tenant_id,workspace_id,store_id,name,sort_order)
 select gen_random_uuid(),tenant_id,workspace_id,id,'默认服务人员',0 from stores s where not exists(select 1 from appointment_advisors x where x.store_id=s.id);
insert into appointment_advisor_services(tenant_id,workspace_id,store_id,advisor_id,service_id)
 select a.tenant_id,a.workspace_id,a.store_id,a.id,s.id from appointment_advisors a join appointment_services s on s.store_id=a.store_id on conflict(advisor_id,service_id) do nothing;
insert into appointment_business_hours(id,tenant_id,workspace_id,store_id,weekday,start_time,end_time)
 select gen_random_uuid(),s.tenant_id,s.workspace_id,s.id,d.weekday,'09:00','18:00' from stores s cross join generate_series(0,6) d(weekday)
 where not exists(select 1 from appointment_business_hours h where h.store_id=s.id and h.weekday=d.weekday);

alter table appointment_settings
  drop constraint if exists appointment_settings_slot_interval_minutes_check;
alter table appointment_settings
  add constraint appointment_settings_slot_interval_minutes_check
  check (slot_interval_minutes between 5 and 300 and slot_interval_minutes % 5 = 0);

alter table appointment_settings
  alter column min_advance_minutes set default 0;
update appointment_settings set min_advance_minutes = 0 where min_advance_minutes <> 0;

alter table appointment_settings
  drop constraint if exists appointment_settings_default_buffer_minutes_check;
update appointment_settings
set default_buffer_minutes = least(30, greatest(1, default_buffer_minutes));
alter table appointment_settings
  alter column default_buffer_minutes set default 1;
alter table appointment_settings
  add constraint appointment_settings_default_buffer_minutes_check
  check (default_buffer_minutes between 1 and 30);

create table if not exists orders (
 id uuid primary key default gen_random_uuid(), tenant_id uuid not null references tenants(id), workspace_id uuid,
 store_id uuid not null references stores(id), order_no text not null, status text not null, payment_status text not null,
 amount_fen bigint not null check (amount_fen >= 0), customer_ref text, data jsonb not null default '{}', created_at timestamptz not null default now(),
 unique (tenant_id,store_id,order_no)
);

alter table customers alter column name drop not null;
alter table customers alter column phone drop not null;
alter table customers drop constraint if exists customers_source_check;
do $$ begin
  if not exists (select 1 from pg_constraint where conname='customers_source_check') then
    alter table customers add constraint customers_source_check check (source in ('mini_program','merchant_manual','import','order','appointment'));
  end if;
end $$;
alter table customers add column if not exists display_name text;
alter table customers add column if not exists avatar_url text;
alter table customers add column if not exists status text not null default 'active' check (status in ('active','blocked'));
alter table customers add column if not exists first_seen_at timestamptz;
alter table customers add column if not exists last_seen_at timestamptz;
alter table customers add column if not exists first_order_at timestamptz;
alter table customers add column if not exists last_order_at timestamptz;
alter table customers add column if not exists order_count integer not null default 0 check (order_count >= 0);
alter table customers add column if not exists total_spend_fen bigint not null default 0 check (total_spend_fen >= 0);
alter table customers add column if not exists appointment_count integer not null default 0 check (appointment_count >= 0);
update customers set display_name = coalesce(display_name, nullif(name,'')), first_seen_at = coalesce(first_seen_at, created_at), last_seen_at = coalesce(last_seen_at, updated_at);
alter table customers alter column first_seen_at set default now();
alter table customers alter column first_seen_at set not null;
alter table customers alter column last_seen_at set default now();
alter table customers alter column last_seen_at set not null;
update customers c set appointment_count = x.count from (select customer_id,count(*)::int count from appointments group by customer_id) x where x.customer_id=c.id;
create unique index if not exists customers_scope_id_idx on customers(tenant_id,workspace_id,store_id,id);
create index if not exists customers_activity_idx on customers(tenant_id,workspace_id,store_id,last_seen_at desc);
create index if not exists customers_orders_idx on customers(tenant_id,workspace_id,store_id,last_order_at desc);

alter table orders add column if not exists workspace_id uuid;
alter table orders add column if not exists customer_id uuid;
update orders o set workspace_id=s.workspace_id from stores s where o.store_id=s.id and o.tenant_id=s.tenant_id and o.workspace_id is null;
create index if not exists orders_customer_idx on orders(tenant_id,workspace_id,store_id,customer_id) where customer_id is not null;
do $$ begin
  if not exists (select 1 from pg_constraint where conname='orders_customer_workspace_required_check') then
    alter table orders add constraint orders_customer_workspace_required_check check (customer_id is null or workspace_id is not null) not valid;
  end if;
end $$;
do $$ begin
  if not exists (select 1 from pg_constraint where conname='orders_customer_scope_fk') then
    alter table orders add constraint orders_customer_scope_fk foreign key (tenant_id,workspace_id,store_id,customer_id) references customers(tenant_id,workspace_id,store_id,id) not valid;
  end if;
end $$;

create table if not exists customer_events (
 id uuid primary key default gen_random_uuid(), tenant_id uuid not null, workspace_id uuid not null, store_id uuid not null,
 customer_id uuid not null, event_type text not null, source text not null, resource_type text, resource_id text,
 metadata jsonb not null default '{}', occurred_at timestamptz not null default now(), created_at timestamptz not null default now(),
 foreign key (tenant_id,workspace_id,store_id,customer_id) references customers(tenant_id,workspace_id,store_id,id),
 unique (tenant_id,workspace_id,store_id,event_type,source,resource_type,resource_id)
);
create index if not exists customer_events_customer_idx on customer_events(tenant_id,workspace_id,store_id,customer_id,occurred_at desc);

create table if not exists customer_tags (
 id uuid primary key default gen_random_uuid(), tenant_id uuid not null, workspace_id uuid not null, store_id uuid not null,
 name text not null, created_at timestamptz not null default now(), unique(tenant_id,workspace_id,store_id,id),
 foreign key (tenant_id,workspace_id,store_id) references stores(tenant_id,workspace_id,id)
);
create unique index if not exists customer_tags_name_idx on customer_tags(tenant_id,workspace_id,store_id,lower(name));
create table if not exists customer_tag_links (
 tenant_id uuid not null, workspace_id uuid not null, store_id uuid not null, customer_id uuid not null, tag_id uuid not null,
 created_at timestamptz not null default now(), primary key(customer_id,tag_id),
 foreign key (tenant_id,workspace_id,store_id,customer_id) references customers(tenant_id,workspace_id,store_id,id),
 foreign key (tenant_id,workspace_id,store_id,tag_id) references customer_tags(tenant_id,workspace_id,store_id,id)
);

create table if not exists customer_notes (
 id uuid primary key default gen_random_uuid(), tenant_id uuid not null, workspace_id uuid not null, store_id uuid not null,
 customer_id uuid not null, author_user_id uuid, content text not null check (length(content) between 1 and 5000), created_at timestamptz not null default now(),
 foreign key (tenant_id,workspace_id,store_id,customer_id) references customers(tenant_id,workspace_id,store_id,id)
);
create index if not exists customer_notes_customer_idx on customer_notes(tenant_id,workspace_id,store_id,customer_id,created_at desc);

create table if not exists membership_programs (
 id uuid primary key default gen_random_uuid(), tenant_id uuid not null, workspace_id uuid not null, store_id uuid not null,
 enabled boolean not null default false, points_enabled boolean not null default false, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 foreign key (tenant_id,workspace_id,store_id) references stores(tenant_id,workspace_id,id), unique(tenant_id,workspace_id,store_id)
);
create table if not exists membership_levels (
 id uuid primary key default gen_random_uuid(), tenant_id uuid not null, workspace_id uuid not null, store_id uuid not null,
 name text not null, level_order integer not null, growth_threshold bigint not null default 0 check (growth_threshold >= 0), enabled boolean not null default true,
 benefits jsonb not null default '{}', created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 foreign key (tenant_id,workspace_id,store_id) references stores(tenant_id,workspace_id,id), unique(tenant_id,workspace_id,store_id,id), unique(tenant_id,workspace_id,store_id,level_order), unique(tenant_id,workspace_id,store_id,name)
);
create table if not exists customer_memberships (
 id uuid primary key default gen_random_uuid(), tenant_id uuid not null, workspace_id uuid not null, store_id uuid not null, customer_id uuid not null, level_id uuid not null,
 status text not null default 'active' check(status in ('active','inactive')), joined_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 foreign key (tenant_id,workspace_id,store_id,customer_id) references customers(tenant_id,workspace_id,store_id,id),
 foreign key (tenant_id,workspace_id,store_id,level_id) references membership_levels(tenant_id,workspace_id,store_id,id)
);
create unique index if not exists customer_memberships_active_idx on customer_memberships(tenant_id,workspace_id,store_id,customer_id) where status='active';

create table if not exists customer_points_accounts (
 tenant_id uuid not null, workspace_id uuid not null, store_id uuid not null, customer_id uuid not null,
 balance bigint not null default 0 check(balance >= 0), created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 primary key(tenant_id,workspace_id,store_id,customer_id), foreign key (tenant_id,workspace_id,store_id,customer_id) references customers(tenant_id,workspace_id,store_id,id)
);
create table if not exists customer_points_ledger (
 id uuid primary key default gen_random_uuid(), tenant_id uuid not null, workspace_id uuid not null, store_id uuid not null, customer_id uuid not null,
 type text not null check(type in ('earn','spend','adjust','expire')), points bigint not null, balance_after bigint not null check(balance_after >= 0), reason text not null,
 source_type text not null, source_id text, operator_id uuid, idempotency_key text not null, created_at timestamptz not null default now(),
 foreign key (tenant_id,workspace_id,store_id,customer_id) references customers(tenant_id,workspace_id,store_id,id),
 unique(tenant_id,workspace_id,store_id,idempotency_key)
);
create index if not exists customer_points_ledger_customer_idx on customer_points_ledger(tenant_id,workspace_id,store_id,customer_id,created_at desc);
create unique index if not exists customer_points_ledger_source_idx on customer_points_ledger(tenant_id,workspace_id,store_id,source_type,source_id,type) where source_id is not null;

insert into membership_programs(tenant_id,workspace_id,store_id) select tenant_id,workspace_id,id from stores on conflict(tenant_id,workspace_id,store_id) do nothing;
insert into membership_levels(tenant_id,workspace_id,store_id,name,level_order,growth_threshold) select tenant_id,workspace_id,id,'普通会员',1,0 from stores on conflict(tenant_id,workspace_id,store_id,level_order) do nothing;

alter table users add column if not exists avatar_url text;

create index if not exists users_display_name_idx on users(display_name);

-- ATELIER OS Sprint 3A: generic Workflow Runtime Core. Keep additive.
create table if not exists workflow_definitions (
  id uuid primary key, tenant_id uuid not null, workspace_id uuid not null,
  workflow_key text not null, name text not null, status text not null default 'active' check (status in ('active','archived')),
  created_by text not null, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (tenant_id, workspace_id, workflow_key), unique (tenant_id, workspace_id, id),
  foreign key (tenant_id, workspace_id) references workspaces(tenant_id, id)
);
create index if not exists workflow_definitions_scope_idx on workflow_definitions(tenant_id, workspace_id, status);
create table if not exists workflow_versions (
  id uuid primary key, definition_id uuid not null, tenant_id uuid not null, workspace_id uuid not null,
  version integer not null check (version > 0), status text not null default 'published' check (status in ('published','retired')),
  definition_json jsonb not null, created_by text not null, created_at timestamptz not null default now(), unique (definition_id, version), unique (tenant_id, workspace_id, id), unique (tenant_id, workspace_id, definition_id, id),
  foreign key (tenant_id, workspace_id) references workspaces(tenant_id, id), foreign key (tenant_id, workspace_id, definition_id) references workflow_definitions(tenant_id, workspace_id, id)
);
create index if not exists workflow_versions_scope_idx on workflow_versions(tenant_id, workspace_id, definition_id, version desc);
create table if not exists workflow_instances (
  id uuid primary key, definition_id uuid not null, version_id uuid not null,
  tenant_id uuid not null, workspace_id uuid not null, status text not null check (status in ('running','completed','cancelled','failed')),
  context jsonb not null default '{}', idempotency_key text, started_by text not null, started_at timestamptz not null default now(),
  completed_at timestamptz, updated_at timestamptz not null default now(), next_event_sequence integer not null default 1 check (next_event_sequence > 0),
  unique (tenant_id, workspace_id, id), unique (tenant_id, workspace_id, definition_id, id), foreign key (tenant_id, workspace_id) references workspaces(tenant_id, id),
  foreign key (tenant_id, workspace_id, definition_id, version_id) references workflow_versions(tenant_id, workspace_id, definition_id, id)
);
create unique index if not exists workflow_instances_idempotency_idx on workflow_instances(tenant_id, workspace_id, idempotency_key) where idempotency_key is not null;
create index if not exists workflow_instances_scope_status_idx on workflow_instances(tenant_id, workspace_id, status, updated_at desc);
create table if not exists workflow_tasks (
  id uuid primary key, instance_id uuid not null, definition_id uuid not null,
  tenant_id uuid not null, workspace_id uuid not null, task_key text not null, task_type text not null,
  status text not null check (status in ('pending','completed','cancelled','failed')), input jsonb not null default '{}', output jsonb,
  assigned_user_id text, created_at timestamptz not null default now(), completed_at timestamptz, unique (instance_id, task_key), unique (tenant_id, workspace_id, id), unique (tenant_id, workspace_id, instance_id, id),
  foreign key (tenant_id, workspace_id) references workspaces(tenant_id, id), foreign key (tenant_id, workspace_id, definition_id, instance_id) references workflow_instances(tenant_id, workspace_id, definition_id, id)
);
create index if not exists workflow_tasks_scope_status_idx on workflow_tasks(tenant_id, workspace_id, status, created_at);
create index if not exists workflow_tasks_instance_idx on workflow_tasks(instance_id, created_at);
create table if not exists workflow_events (
  id uuid primary key, instance_id uuid not null, task_id uuid,
  tenant_id uuid not null, workspace_id uuid not null, sequence integer not null check (sequence > 0), event_type text not null,
  actor_id text not null, payload jsonb not null default '{}', created_at timestamptz not null default now(), unique (instance_id, sequence),
  foreign key (tenant_id, workspace_id) references workspaces(tenant_id, id), foreign key (tenant_id, workspace_id, instance_id) references workflow_instances(tenant_id, workspace_id, id),
  foreign key (tenant_id, workspace_id, instance_id, task_id) references workflow_tasks(tenant_id, workspace_id, instance_id, id)
);
create index if not exists workflow_events_scope_idx on workflow_events(tenant_id, workspace_id, instance_id, sequence);
create or replace function workflow_versions_reject_published_mutation() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' or old.status = 'published' or new.status = 'published' then raise exception 'WORKFLOW_PUBLISHED_VERSION_IMMUTABLE' using errcode = '55000'; end if;
  return new;
end;
$$;
create trigger workflow_versions_immutable_trigger before update or delete on workflow_versions for each row execute function workflow_versions_reject_published_mutation();
