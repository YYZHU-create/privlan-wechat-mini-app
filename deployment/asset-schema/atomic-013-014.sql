BEGIN;

-- BEGIN 013_asset_contract_v1.sql (exact source body)
-- Asset Contract v1: additive metadata and relationship model.
-- Storage objects remain provider-owned; this migration never touches Storage.

alter table assets add column purpose text;
alter table assets add column visibility text default 'PRIVATE';
alter table assets add column status text default 'pending';
alter table assets add column created_by uuid references users(id) on delete set null;
alter table assets add column updated_at timestamptz not null default now();
alter table assets add column deleted_at timestamptz;

alter table assets add constraint assets_purpose_check
  check (purpose is null or purpose in (
    'product_main','product_gallery','product_detail','brand_logo',
    'workspace_branding','mini_program_banner','content_image','content_video'
  ));
alter table assets add constraint assets_visibility_check
  check (visibility is null or visibility in ('PRIVATE','PUBLISHED'));
alter table assets add constraint assets_status_check
  check (status is null or status in ('pending','ready','failed','deletion_requested','deleted'));

create table asset_objects (
  id uuid primary key default gen_random_uuid(),
  asset_id uuid not null references assets(id) on delete restrict,
  storage_provider text not null,
  bucket text not null,
  object_key text not null,
  variant text not null,
  mime_type text not null,
  size_bytes bigint not null check (size_bytes >= 0),
  checksum text not null,
  checksum_algorithm text not null default 'sha256' check (checksum_algorithm = 'sha256'),
  original_filename text,
  width integer check (width is null or width > 0),
  height integer check (height is null or height > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (storage_provider, bucket, object_key),
  unique (asset_id, variant)
);

create table asset_links (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete restrict,
  workspace_id uuid not null references workspaces(id) on delete restrict,
  store_id uuid references stores(id) on delete restrict,
  asset_id uuid not null references assets(id) on delete restrict,
  entity_type text not null check (entity_type in ('workspace_config_product','brand','workspace','content')),
  entity_id text not null,
  purpose text not null check (purpose in (
    'product_main','product_gallery','product_detail','brand_logo',
    'workspace_branding','mini_program_banner','content_image','content_video'
  )),
  position integer check (position is null or position >= 0),
  created_at timestamptz not null default now(),
  unique (tenant_id, workspace_id, entity_type, entity_id, purpose, position)
);

create index assets_contract_scope_idx
  on assets (tenant_id, workspace_id, status, purpose, created_at desc);
create index asset_objects_asset_idx on asset_objects (asset_id);
create index asset_links_scope_entity_idx
  on asset_links (tenant_id, workspace_id, entity_type, entity_id);
create index asset_links_asset_idx on asset_links (asset_id);

-- Cross-scope equality (asset versus link) is enforced by the application/service
-- layer. No trigger is introduced in V1; Service Role callers must validate scope.

-- END 013_asset_contract_v1.sql

-- BEGIN 014_asset_access_hardening.sql (exact source body)
-- Asset access hardening: keep asset metadata behind the server-side API.
-- No client-facing policies are created in V1. Service Role is the only
-- runtime role that receives the DML permissions required by the media API.

alter table asset_objects enable row level security;
alter table asset_links enable row level security;

revoke all on table asset_objects from public;
revoke all on table asset_links from public;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on table asset_objects from anon;
    revoke all on table asset_links from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke all on table asset_objects from authenticated;
    revoke all on table asset_links from authenticated;
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    revoke all on table asset_objects from service_role;
    revoke all on table asset_links from service_role;
    grant select, insert, update, delete on table asset_objects to service_role;
    grant select, insert, update, delete on table asset_links to service_role;
  end if;
end
$$;

-- END 014_asset_access_hardening.sql

COMMIT;
