create table if not exists ai_template_drafts (
  id uuid primary key, tenant_id uuid not null references tenants(id), workspace_id uuid not null references workspaces(id), store_id uuid not null references stores(id),
  base_config_version integer not null default 0, current_revision integer not null default 1 check (current_revision > 0), status text not null default 'draft' check (status in ('draft','applied','discarded')),
  prompt text not null check (length(prompt) between 1 and 4000), business_brief jsonb not null default '{}'::jsonb, provider text not null, model text not null, created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(id, tenant_id, workspace_id, store_id)
);
create table if not exists ai_template_draft_revisions (
  id uuid primary key, draft_id uuid not null references ai_template_drafts(id) on delete cascade, tenant_id uuid not null, workspace_id uuid not null, store_id uuid not null, revision integer not null check (revision > 0), document jsonb not null, change_instruction text not null, created_at timestamptz not null default now(), unique(draft_id, revision), foreign key(draft_id, tenant_id, workspace_id, store_id) references ai_template_drafts(id, tenant_id, workspace_id, store_id) on delete cascade
);
create table if not exists ai_template_request_receipts (
  id uuid primary key default gen_random_uuid(), tenant_id uuid not null, workspace_id uuid not null, store_id uuid not null, idempotency_key text not null, operation text not null, request_hash text not null, response jsonb not null, created_at timestamptz not null default now(), unique(tenant_id, workspace_id, store_id, idempotency_key, operation)
);
create table if not exists ai_workspace_skills (
  id uuid primary key, tenant_id uuid not null references tenants(id), workspace_id uuid not null references workspaces(id), store_id uuid not null references stores(id), name text not null, description text not null default '', status text not null default 'disabled' check (status in ('enabled','disabled')), document jsonb not null, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists ai_credit_accounts (
  tenant_id uuid not null references tenants(id), workspace_id uuid not null references workspaces(id), store_id uuid not null references stores(id), balance_points bigint not null default 0 check (balance_points >= 0), reserved_points bigint not null default 0 check (reserved_points >= 0), used_points bigint not null default 0 check (used_points >= 0), updated_at timestamptz not null default now(), primary key(tenant_id, workspace_id, store_id)
);
create table if not exists ai_credit_ledger (
  id uuid primary key default gen_random_uuid(), tenant_id uuid not null, workspace_id uuid not null, store_id uuid not null, idempotency_key text not null, entry_type text not null check (entry_type in ('reserve','reconcile','release')), points bigint not null check (points >= 0), metadata jsonb not null default '{}'::jsonb, created_at timestamptz not null default now(), unique(tenant_id, workspace_id, store_id, idempotency_key, entry_type)
);
create index if not exists ai_template_drafts_scope_status_idx on ai_template_drafts(tenant_id, workspace_id, store_id, status, updated_at desc);
create index if not exists ai_template_revisions_scope_idx on ai_template_draft_revisions(tenant_id, workspace_id, store_id, draft_id, revision desc);
create index if not exists ai_workspace_skills_scope_idx on ai_workspace_skills(tenant_id, workspace_id, store_id, status);
create index if not exists ai_credit_ledger_scope_idx on ai_credit_ledger(tenant_id, workspace_id, store_id, created_at desc);
