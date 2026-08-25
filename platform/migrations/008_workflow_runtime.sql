-- ATELIER OS Sprint 3A: generic Workflow Runtime Core.
-- Additive only. Existing SaaS and business tables are intentionally untouched.

create table if not exists workflow_definitions (
  id uuid primary key,
  tenant_id uuid not null,
  workspace_id uuid not null,
  workflow_key text not null,
  name text not null,
  status text not null default 'active' check (status in ('active','archived')),
  created_by text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, workspace_id, workflow_key),
  unique (tenant_id, workspace_id, id),
  foreign key (tenant_id, workspace_id) references workspaces(tenant_id, id)
);
create index if not exists workflow_definitions_scope_idx on workflow_definitions(tenant_id, workspace_id, status);

create table if not exists workflow_versions (
  id uuid primary key,
  definition_id uuid not null,
  tenant_id uuid not null,
  workspace_id uuid not null,
  version integer not null check (version > 0),
  status text not null default 'published' check (status in ('published','retired')),
  definition_json jsonb not null,
  created_by text not null,
  created_at timestamptz not null default now(),
  unique (definition_id, version),
  unique (tenant_id, workspace_id, id),
  unique (tenant_id, workspace_id, definition_id, id),
  foreign key (tenant_id, workspace_id) references workspaces(tenant_id, id),
  foreign key (tenant_id, workspace_id, definition_id) references workflow_definitions(tenant_id, workspace_id, id)
);
create index if not exists workflow_versions_scope_idx on workflow_versions(tenant_id, workspace_id, definition_id, version desc);

create table if not exists workflow_instances (
  id uuid primary key,
  definition_id uuid not null,
  version_id uuid not null,
  tenant_id uuid not null,
  workspace_id uuid not null,
  status text not null check (status in ('running','completed','cancelled','failed')),
  context jsonb not null default '{}',
  idempotency_key text,
  started_by text not null,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  updated_at timestamptz not null default now(),
  next_event_sequence integer not null default 1 check (next_event_sequence > 0),
  unique (tenant_id, workspace_id, id),
  unique (tenant_id, workspace_id, definition_id, id),
  foreign key (tenant_id, workspace_id) references workspaces(tenant_id, id),
  foreign key (tenant_id, workspace_id, definition_id, version_id) references workflow_versions(tenant_id, workspace_id, definition_id, id)
);
create unique index if not exists workflow_instances_idempotency_idx on workflow_instances(tenant_id, workspace_id, idempotency_key) where idempotency_key is not null;
create index if not exists workflow_instances_scope_status_idx on workflow_instances(tenant_id, workspace_id, status, updated_at desc);

create table if not exists workflow_tasks (
  id uuid primary key,
  instance_id uuid not null,
  definition_id uuid not null,
  tenant_id uuid not null,
  workspace_id uuid not null,
  task_key text not null,
  task_type text not null,
  status text not null check (status in ('pending','completed','cancelled','failed')),
  input jsonb not null default '{}',
  output jsonb,
  assigned_user_id text,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (instance_id, task_key),
  unique (tenant_id, workspace_id, id),
  unique (tenant_id, workspace_id, instance_id, id),
  foreign key (tenant_id, workspace_id) references workspaces(tenant_id, id),
  foreign key (tenant_id, workspace_id, definition_id, instance_id) references workflow_instances(tenant_id, workspace_id, definition_id, id)
);
create index if not exists workflow_tasks_scope_status_idx on workflow_tasks(tenant_id, workspace_id, status, created_at);
create index if not exists workflow_tasks_instance_idx on workflow_tasks(instance_id, created_at);

create table if not exists workflow_events (
  id uuid primary key,
  instance_id uuid not null,
  task_id uuid,
  tenant_id uuid not null,
  workspace_id uuid not null,
  sequence integer not null check (sequence > 0),
  event_type text not null,
  actor_id text not null,
  payload jsonb not null default '{}',
  created_at timestamptz not null default now(),
  unique (instance_id, sequence),
  foreign key (tenant_id, workspace_id) references workspaces(tenant_id, id),
  foreign key (tenant_id, workspace_id, instance_id) references workflow_instances(tenant_id, workspace_id, id),
  foreign key (tenant_id, workspace_id, instance_id, task_id) references workflow_tasks(tenant_id, workspace_id, instance_id, id)
);
create index if not exists workflow_events_scope_idx on workflow_events(tenant_id, workspace_id, instance_id, sequence);

create or replace function workflow_versions_reject_published_mutation() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' or old.status = 'published' or new.status = 'published' then
    raise exception 'WORKFLOW_PUBLISHED_VERSION_IMMUTABLE' using errcode = '55000';
  end if;
  return new;
end;
$$;

create trigger workflow_versions_immutable_trigger
before update or delete on workflow_versions
for each row execute function workflow_versions_reject_published_mutation();
