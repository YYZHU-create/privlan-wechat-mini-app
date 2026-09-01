-- Launch V1 additive domain extensions. Migration 011 remains reserved by isolated AI work.
alter table tenants drop constraint if exists tenants_status_check;
alter table tenants add constraint tenants_status_check check (status in ('trial','active','suspended'));

create table if not exists membership_level_rules (
 id uuid primary key default gen_random_uuid(), tenant_id uuid not null, workspace_id uuid not null, store_id uuid not null,
 level_id uuid not null, spend_threshold_fen bigint, points_threshold bigint, appointment_count_threshold integer,
 effective_from timestamptz not null default now(), enabled boolean not null default true, manual_only boolean not null default false,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 foreign key (tenant_id,workspace_id,store_id,level_id) references membership_levels(tenant_id,workspace_id,store_id,id),
 unique (tenant_id,workspace_id,store_id,level_id)
);
create table if not exists membership_overrides (
 tenant_id uuid not null, workspace_id uuid not null, store_id uuid not null, customer_id uuid not null,
 level_id uuid not null, reason text not null, expires_at timestamptz, created_by text not null, created_at timestamptz not null default now(),
 primary key (tenant_id,workspace_id,store_id,customer_id),
 foreign key (tenant_id,workspace_id,store_id,customer_id) references customers(tenant_id,workspace_id,store_id,id),
 foreign key (tenant_id,workspace_id,store_id,level_id) references membership_levels(tenant_id,workspace_id,store_id,id)
);
create table if not exists membership_redemptions (
 id uuid primary key default gen_random_uuid(), tenant_id uuid not null, workspace_id uuid not null, store_id uuid not null,
 customer_id uuid not null, level_id uuid, benefit_key text not null, quantity integer not null default 1 check(quantity>0), idempotency_key text not null,
 redeemed_at timestamptz not null default now(), actor_id text,
 foreign key (tenant_id,workspace_id,store_id,customer_id) references customers(tenant_id,workspace_id,store_id,id),
 foreign key (tenant_id,workspace_id,store_id,level_id) references membership_levels(tenant_id,workspace_id,store_id,id),
 unique (tenant_id,workspace_id,store_id,idempotency_key)
);
create table if not exists operator_feature_flags (
 id uuid primary key default gen_random_uuid(), key text not null unique, description text not null default '', default_enabled boolean not null default false,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists operator_feature_flag_overrides (
 flag_id uuid not null references operator_feature_flags(id) on delete cascade, tenant_id uuid not null references tenants(id), workspace_id uuid references workspaces(id), enabled boolean not null,
 updated_by uuid not null references operator_users(id), updated_at timestamptz not null default now(), primary key(flag_id,tenant_id,workspace_id)
);
create table if not exists marketing_audiences (
 id uuid primary key default gen_random_uuid(), tenant_id uuid not null, workspace_id uuid not null, store_id uuid not null,
 name text not null, criteria jsonb not null default '{}', status text not null default 'draft' check(status in ('draft','active','archived')),
 created_by text, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 foreign key (tenant_id,workspace_id,store_id) references stores(tenant_id,workspace_id,id), unique(tenant_id,workspace_id,store_id,name), unique(tenant_id,workspace_id,store_id,id)
);
create table if not exists marketing_offers (
 id uuid primary key default gen_random_uuid(), tenant_id uuid not null, workspace_id uuid not null, store_id uuid not null,
 code text not null, name text not null, description text not null default '', status text not null default 'draft' check(status in ('draft','active','disabled','expired')),
 starts_at timestamptz, expires_at timestamptz, max_uses integer, single_use boolean not null default true,
 created_by text, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 foreign key (tenant_id,workspace_id,store_id) references stores(tenant_id,workspace_id,id), unique(tenant_id,workspace_id,store_id,code), unique(tenant_id,workspace_id,store_id,id)
);
create table if not exists marketing_issuances (
 id uuid primary key default gen_random_uuid(), tenant_id uuid not null, workspace_id uuid not null, store_id uuid not null,
 offer_id uuid not null, customer_id uuid not null, idempotency_key text not null, status text not null default 'issued' check(status in ('issued','redeemed','expired','revoked')),
 issued_at timestamptz not null default now(), expires_at timestamptz, redeemed_at timestamptz, actor_id text,
 foreign key (tenant_id,workspace_id,store_id,offer_id) references marketing_offers(tenant_id,workspace_id,store_id,id),
 foreign key (tenant_id,workspace_id,store_id,customer_id) references customers(tenant_id,workspace_id,store_id,id),
 unique(tenant_id,workspace_id,store_id,idempotency_key), unique(tenant_id,workspace_id,store_id,id)
);
create table if not exists marketing_redemptions (
 id uuid primary key default gen_random_uuid(), tenant_id uuid not null, workspace_id uuid not null, store_id uuid not null,
 issuance_id uuid not null, customer_id uuid not null, idempotency_key text not null, redeemed_at timestamptz not null default now(), actor_id text,
 foreign key (tenant_id,workspace_id,store_id,issuance_id) references marketing_issuances(tenant_id,workspace_id,store_id,id),
 foreign key (tenant_id,workspace_id,store_id,customer_id) references customers(tenant_id,workspace_id,store_id,id),
 unique(tenant_id,workspace_id,store_id,idempotency_key), unique(tenant_id,workspace_id,store_id,id), unique(issuance_id)
);
create table if not exists marketing_campaigns (
 id uuid primary key default gen_random_uuid(), tenant_id uuid not null, workspace_id uuid not null, store_id uuid not null,
 name text not null, audience_id uuid, offer_id uuid, status text not null default 'draft' check(status in ('draft','scheduled','active','paused','completed','archived')),
 starts_at timestamptz, ends_at timestamptz, created_by text, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 foreign key (tenant_id,workspace_id,store_id) references stores(tenant_id,workspace_id,id),
 foreign key (tenant_id,workspace_id,store_id,audience_id) references marketing_audiences(tenant_id,workspace_id,store_id,id),
 foreign key (tenant_id,workspace_id,store_id,offer_id) references marketing_offers(tenant_id,workspace_id,store_id,id)
);
create index if not exists marketing_scope_idx on marketing_campaigns(tenant_id,workspace_id,store_id,status,updated_at desc);





alter table workflow_tasks add column if not exists retry_count integer not null default 0;
alter table workflow_tasks add column if not exists last_error text;
alter table workflow_tasks add column if not exists retry_limit integer not null default 3;

