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
