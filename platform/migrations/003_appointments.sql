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
