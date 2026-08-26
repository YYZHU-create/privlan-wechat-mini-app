-- ATELIER OS Sprint 3B: workflow integration inbox. Additive only.
-- Existing customer_events rows are the transactional domain-event source.

create table if not exists workflow_event_consumptions (
  id uuid primary key,
  tenant_id uuid not null,
  workspace_id uuid not null,
  event_id uuid not null,
  consumer_key text not null,
  status text not null default 'pending' check (status in ('pending','processing','succeeded','failed')),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  last_error text,
  workflow_instance_id uuid,
  result jsonb not null default '{}',
  processed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, workspace_id, event_id, consumer_key),
  foreign key (tenant_id, workspace_id) references workspaces(tenant_id, id),
  foreign key (tenant_id, workspace_id, workflow_instance_id) references workflow_instances(tenant_id, workspace_id, id)
);
create index if not exists workflow_event_consumptions_pending_idx on workflow_event_consumptions(tenant_id, workspace_id, status, updated_at);
create index if not exists workflow_event_consumptions_event_idx on workflow_event_consumptions(tenant_id, workspace_id, event_id);
