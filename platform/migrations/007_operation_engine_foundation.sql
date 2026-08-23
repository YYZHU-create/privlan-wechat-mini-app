-- Merchant OS Sprint 2: store-scoped operation engine foundation.
create table if not exists staff_members (
  id uuid primary key,
  tenant_id uuid not null,
  workspace_id uuid not null,
  user_id uuid,
  display_name text not null,
  avatar_url text not null default '',
  title text not null default '',
  status text not null default 'active' check(status in ('active','inactive')),
  public_visible boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key(tenant_id,workspace_id) references workspaces(tenant_id,id),
  foreign key(user_id) references users(id)
);
create unique index if not exists staff_members_scope_id_idx on staff_members(tenant_id,workspace_id,id);
create index if not exists staff_members_workspace_status_idx on staff_members(workspace_id,status,display_name);

create table if not exists staff_store_assignments (
  id uuid primary key,
  tenant_id uuid not null,
  workspace_id uuid not null,
  store_id uuid not null,
  staff_id uuid not null,
  status text not null default 'active' check(status in ('active','inactive')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key(tenant_id,workspace_id) references workspaces(tenant_id,id),
  foreign key(tenant_id,workspace_id,store_id) references stores(tenant_id,workspace_id,id),
  foreign key(tenant_id,workspace_id,staff_id) references staff_members(tenant_id,workspace_id,id),
  unique(store_id,staff_id)
);
create unique index if not exists staff_store_assignments_scope_id_idx on staff_store_assignments(tenant_id,workspace_id,store_id,staff_id);
create index if not exists staff_store_assignments_staff_idx on staff_store_assignments(workspace_id,staff_id,status);

create table if not exists staff_schedules (
  id uuid primary key,
  tenant_id uuid not null,
  workspace_id uuid not null,
  store_id uuid not null,
  staff_id uuid not null,
  weekday integer not null check(weekday between 0 and 6),
  start_time time not null,
  end_time time not null,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check(end_time > start_time),
  foreign key(tenant_id,workspace_id) references workspaces(tenant_id,id),
  foreign key(tenant_id,workspace_id,store_id) references stores(tenant_id,workspace_id,id),
  foreign key(tenant_id,workspace_id,staff_id) references staff_members(tenant_id,workspace_id,id),
  unique(store_id,staff_id,weekday,start_time,end_time)
);
create index if not exists staff_schedules_availability_idx on staff_schedules(tenant_id,workspace_id,store_id,staff_id,weekday,enabled);

create table if not exists staff_leaves (
  id uuid primary key,
  tenant_id uuid not null,
  workspace_id uuid not null,
  store_id uuid not null,
  staff_id uuid not null,
  start_at timestamptz not null,
  end_at timestamptz not null,
  reason text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check(end_at > start_at),
  foreign key(tenant_id,workspace_id) references workspaces(tenant_id,id),
  foreign key(tenant_id,workspace_id,store_id) references stores(tenant_id,workspace_id,id),
  foreign key(tenant_id,workspace_id,staff_id) references staff_members(tenant_id,workspace_id,id)
);
create index if not exists staff_leaves_overlap_idx on staff_leaves(tenant_id,workspace_id,store_id,staff_id,start_at,end_at);

create table if not exists resources (
  id uuid primary key,
  tenant_id uuid not null,
  workspace_id uuid not null,
  name text not null,
  kind text not null default 'general',
  status text not null default 'active' check(status in ('active','inactive')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key(tenant_id,workspace_id) references workspaces(tenant_id,id)
);
create unique index if not exists resources_scope_id_idx on resources(tenant_id,workspace_id,id);
create index if not exists resources_workspace_status_idx on resources(workspace_id,status,name);

create table if not exists resource_store_assignments (
  id uuid primary key,
  tenant_id uuid not null,
  workspace_id uuid not null,
  store_id uuid not null,
  resource_id uuid not null,
  status text not null default 'active' check(status in ('active','inactive')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key(tenant_id,workspace_id) references workspaces(tenant_id,id),
  foreign key(tenant_id,workspace_id,store_id) references stores(tenant_id,workspace_id,id),
  foreign key(tenant_id,workspace_id,resource_id) references resources(tenant_id,workspace_id,id),
  unique(store_id,resource_id)
);
create unique index if not exists resource_store_assignments_scope_id_idx on resource_store_assignments(tenant_id,workspace_id,store_id,resource_id);

alter table appointment_advisors add column if not exists staff_id uuid;
alter table appointments add column if not exists resource_id uuid;

-- Each legacy advisor remains the store-specific compatibility record for one Staff member.
update appointment_advisors set staff_id=gen_random_uuid() where staff_id is null;
insert into staff_members(id,tenant_id,workspace_id,display_name,status,public_visible,created_at,updated_at)
select a.staff_id,a.tenant_id,a.workspace_id,a.name,case when a.enabled then 'active' else 'inactive' end,a.enabled,a.created_at,a.updated_at
from appointment_advisors a
on conflict(id) do nothing;
insert into staff_store_assignments(id,tenant_id,workspace_id,store_id,staff_id,status)
select gen_random_uuid(),a.tenant_id,a.workspace_id,a.store_id,a.staff_id,case when a.enabled then 'active' else 'inactive' end
from appointment_advisors a
on conflict(store_id,staff_id) do nothing;
insert into staff_schedules(id,tenant_id,workspace_id,store_id,staff_id,weekday,start_time,end_time,enabled)
select gen_random_uuid(),a.tenant_id,a.workspace_id,a.store_id,a.staff_id,h.weekday,h.start_time,h.end_time,h.enabled
from appointment_advisors a
join appointment_business_hours h on h.tenant_id=a.tenant_id and h.workspace_id=a.workspace_id and h.store_id=a.store_id
on conflict(store_id,staff_id,weekday,start_time,end_time) do nothing;

alter table appointment_advisors add constraint appointment_advisors_staff_scope_fk foreign key(tenant_id,workspace_id,staff_id) references staff_members(tenant_id,workspace_id,id);
alter table appointments add constraint appointments_resource_scope_fk foreign key(tenant_id,workspace_id,resource_id) references resources(tenant_id,workspace_id,id);
create unique index if not exists appointment_advisors_scope_staff_idx on appointment_advisors(tenant_id,workspace_id,store_id,staff_id);
create index if not exists appointments_resource_overlap_idx on appointments(tenant_id,workspace_id,store_id,resource_id,start_at,occupied_until) where resource_id is not null;
