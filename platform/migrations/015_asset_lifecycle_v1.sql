-- Asset Lifecycle v1: irreversible content delete, retained tombstones, and audited metadata purge.
-- Storage remains provider-owned; callers must verify exact object absence before invoking lifecycle RPCs.

create index if not exists assets_purge_candidate_idx
  on assets (tenant_id, workspace_id, store_id, deleted_at)
  where status = 'deleted' and deleted_at is not null;

create unique index if not exists audit_events_asset_lifecycle_request_idx
  on audit_events (tenant_id, workspace_id, action, resource_type, resource_id, request_id)
  where resource_type = 'asset'
    and action in ('asset.deleted', 'asset.purged', 'asset.links_reconciled');

create or replace function public.atelier_asset_finalize_delete_v1(
  p_tenant_id uuid,
  p_workspace_id uuid,
  p_store_id uuid,
  p_actor_type text,
  p_actor_id text,
  p_request_id text,
  p_asset_id uuid,
  p_storage_verified_at timestamptz,
  p_object_count integer
)
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_asset assets%rowtype;
  v_link_count integer := 0;
  v_object_count integer := 0;
  v_now timestamptz := now();
begin
  if p_tenant_id is null or p_workspace_id is null or p_asset_id is null
    or nullif(btrim(p_actor_type), '') is null or nullif(btrim(p_actor_id), '') is null
    or nullif(btrim(p_request_id), '') is null or p_storage_verified_at is null
    or p_object_count is null or p_object_count < 0 then
    return jsonb_build_object('code', 'ASSET_LIFECYCLE_INPUT_INVALID');
  end if;

  if p_storage_verified_at < v_now - interval '15 minutes' or p_storage_verified_at > v_now + interval '5 minutes' then
    return jsonb_build_object('code', 'STORAGE_VERIFICATION_STALE');
  end if;

  select * into v_asset
  from assets
  where id = p_asset_id
    and tenant_id = p_tenant_id
    and workspace_id = p_workspace_id
    and store_id is not distinct from p_store_id
  for update;

  if not found then
    return jsonb_build_object('code', 'ASSET_SCOPE_INVALID');
  end if;

  if v_asset.status = 'deleted' and v_asset.deleted_at is not null then
    return jsonb_build_object('ok', true, 'data', jsonb_build_object('id', v_asset.id, 'deleted', true, 'duplicate', true));
  end if;

  if v_asset.status <> 'deletion_requested' then
    return jsonb_build_object('code', 'ASSET_STATUS_TRANSITION_INVALID');
  end if;

  select count(*)::integer into v_object_count from asset_objects where asset_id = v_asset.id;
  if v_object_count <> p_object_count then
    return jsonb_build_object('code', 'ASSET_OBJECT_COUNT_MISMATCH');
  end if;

  if exists (
    select 1 from asset_links
    where asset_id = v_asset.id
      and (tenant_id <> v_asset.tenant_id or workspace_id <> v_asset.workspace_id or store_id is distinct from v_asset.store_id)
  ) then
    return jsonb_build_object('code', 'ASSET_LINK_SCOPE_MISMATCH');
  end if;

  select count(*)::integer into v_link_count from asset_links where asset_id = v_asset.id;
  delete from asset_links where asset_id = v_asset.id;
  update assets
  set status = 'deleted', deleted_at = v_now, updated_at = v_now
  where id = v_asset.id;

  insert into audit_events(id, tenant_id, workspace_id, actor_type, actor_id, action, resource_type, resource_id, request_id, metadata)
  values (
    gen_random_uuid(), v_asset.tenant_id, v_asset.workspace_id,
    left(btrim(p_actor_type), 80), left(btrim(p_actor_id), 160),
    'asset.deleted', 'asset', v_asset.id::text, left(btrim(p_request_id), 180),
    jsonb_build_object('deletedAt', v_now, 'storageVerifiedAt', p_storage_verified_at, 'objectCount', p_object_count, 'linksRemoved', v_link_count)
  );

  return jsonb_build_object('ok', true, 'data', jsonb_build_object('id', v_asset.id, 'deleted', true, 'duplicate', false, 'linksRemoved', v_link_count));
exception when unique_violation then
  select * into v_asset from assets where id = p_asset_id and tenant_id = p_tenant_id and workspace_id = p_workspace_id and store_id is not distinct from p_store_id;
  if found and v_asset.status = 'deleted' and v_asset.deleted_at is not null then
    return jsonb_build_object('ok', true, 'data', jsonb_build_object('id', v_asset.id, 'deleted', true, 'duplicate', true));
  end if;
  raise;
end;
$$;

create or replace function public.atelier_asset_cleanup_deleted_links_v1(
  p_tenant_id uuid,
  p_workspace_id uuid,
  p_store_id uuid,
  p_actor_type text,
  p_actor_id text,
  p_request_id text,
  p_asset_id uuid
)
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_asset assets%rowtype;
  v_link_count integer := 0;
begin
  if p_tenant_id is null or p_workspace_id is null or p_asset_id is null
    or nullif(btrim(p_actor_type), '') is null or nullif(btrim(p_actor_id), '') is null
    or nullif(btrim(p_request_id), '') is null then
    return jsonb_build_object('code', 'ASSET_LIFECYCLE_INPUT_INVALID');
  end if;

  select * into v_asset
  from assets
  where id = p_asset_id
    and tenant_id = p_tenant_id
    and workspace_id = p_workspace_id
    and store_id is not distinct from p_store_id
  for update;

  if not found then
    return jsonb_build_object('code', 'ASSET_SCOPE_INVALID');
  end if;

  if v_asset.status <> 'deleted' or v_asset.deleted_at is null then
    return jsonb_build_object('code', 'ASSET_NOT_DELETED');
  end if;

  if exists (
    select 1 from asset_links
    where asset_id = v_asset.id
      and (tenant_id <> v_asset.tenant_id or workspace_id <> v_asset.workspace_id or store_id is distinct from v_asset.store_id)
  ) then
    return jsonb_build_object('code', 'ASSET_LINK_SCOPE_MISMATCH');
  end if;

  select count(*)::integer into v_link_count from asset_links where asset_id = v_asset.id;
  if v_link_count = 0 then
    return jsonb_build_object('ok', true, 'data', jsonb_build_object('id', v_asset.id, 'linksRemoved', 0, 'duplicate', true));
  end if;

  delete from asset_links where asset_id = v_asset.id;
  insert into audit_events(id, tenant_id, workspace_id, actor_type, actor_id, action, resource_type, resource_id, request_id, metadata)
  values (
    gen_random_uuid(), v_asset.tenant_id, v_asset.workspace_id,
    left(btrim(p_actor_type), 80), left(btrim(p_actor_id), 160),
    'asset.links_reconciled', 'asset', v_asset.id::text, left(btrim(p_request_id), 180),
    jsonb_build_object('deletedAt', v_asset.deleted_at, 'linksRemoved', v_link_count)
  );

  return jsonb_build_object('ok', true, 'data', jsonb_build_object('id', v_asset.id, 'linksRemoved', v_link_count, 'duplicate', false));
exception when unique_violation then
  return jsonb_build_object('ok', true, 'data', jsonb_build_object('id', p_asset_id, 'linksRemoved', 0, 'duplicate', true));
end;
$$;

create or replace function public.atelier_asset_purge_v1(
  p_tenant_id uuid,
  p_workspace_id uuid,
  p_store_id uuid,
  p_actor_type text,
  p_actor_id text,
  p_request_id text,
  p_asset_id uuid,
  p_retention_cutoff timestamptz,
  p_storage_verified_at timestamptz,
  p_object_count integer
)
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_asset assets%rowtype;
  v_object_count integer := 0;
  v_now timestamptz := now();
begin
  if p_tenant_id is null or p_workspace_id is null or p_asset_id is null
    or nullif(btrim(p_actor_type), '') is null or nullif(btrim(p_actor_id), '') is null
    or nullif(btrim(p_request_id), '') is null or p_retention_cutoff is null
    or p_storage_verified_at is null or p_object_count is null or p_object_count < 0 then
    return jsonb_build_object('code', 'ASSET_LIFECYCLE_INPUT_INVALID');
  end if;

  if p_retention_cutoff > v_now - interval '30 days' then
    return jsonb_build_object('code', 'ASSET_RETENTION_NOT_MET');
  end if;

  if p_storage_verified_at < v_now - interval '15 minutes' or p_storage_verified_at > v_now + interval '5 minutes' then
    return jsonb_build_object('code', 'STORAGE_VERIFICATION_STALE');
  end if;

  select * into v_asset
  from assets
  where id = p_asset_id
    and tenant_id = p_tenant_id
    and workspace_id = p_workspace_id
    and store_id is not distinct from p_store_id
  for update;

  if not found then
    if exists (
      select 1 from audit_events
      where tenant_id = p_tenant_id and workspace_id = p_workspace_id
        and action = 'asset.purged' and resource_type = 'asset' and resource_id = p_asset_id::text
    ) then
      return jsonb_build_object('ok', true, 'data', jsonb_build_object('id', p_asset_id, 'purged', true, 'duplicate', true));
    end if;
    return jsonb_build_object('code', 'ASSET_SCOPE_INVALID');
  end if;

  if v_asset.status <> 'deleted' or v_asset.deleted_at is null or v_asset.deleted_at > p_retention_cutoff then
    return jsonb_build_object('code', 'ASSET_RETENTION_NOT_MET');
  end if;

  if not exists (
    select 1 from audit_events
    where tenant_id = v_asset.tenant_id and workspace_id = v_asset.workspace_id
      and action = 'asset.deleted' and resource_type = 'asset' and resource_id = v_asset.id::text
  ) then
    return jsonb_build_object('code', 'ASSET_DELETE_AUDIT_MISSING');
  end if;

  if exists (select 1 from asset_links where asset_id = v_asset.id) then
    return jsonb_build_object('code', 'ASSET_LINKS_PRESENT');
  end if;

  select count(*)::integer into v_object_count from asset_objects where asset_id = v_asset.id;
  if v_object_count <> p_object_count then
    return jsonb_build_object('code', 'ASSET_OBJECT_COUNT_MISMATCH');
  end if;

  insert into audit_events(id, tenant_id, workspace_id, actor_type, actor_id, action, resource_type, resource_id, request_id, metadata)
  values (
    gen_random_uuid(), v_asset.tenant_id, v_asset.workspace_id,
    left(btrim(p_actor_type), 80), left(btrim(p_actor_id), 160),
    'asset.purged', 'asset', v_asset.id::text, left(btrim(p_request_id), 180),
    jsonb_build_object('deletedAt', v_asset.deleted_at, 'purgedAt', v_now, 'storageVerifiedAt', p_storage_verified_at, 'objectCount', v_object_count)
  );

  delete from asset_objects where asset_id = v_asset.id;
  delete from assets where id = v_asset.id;
  return jsonb_build_object('ok', true, 'data', jsonb_build_object('id', v_asset.id, 'purged', true, 'duplicate', false));
exception when unique_violation then
  return jsonb_build_object('ok', true, 'data', jsonb_build_object('id', p_asset_id, 'purged', true, 'duplicate', true));
end;
$$;

revoke all on function public.atelier_asset_finalize_delete_v1(uuid, uuid, uuid, text, text, text, uuid, timestamptz, integer) from public;
revoke all on function public.atelier_asset_cleanup_deleted_links_v1(uuid, uuid, uuid, text, text, text, uuid) from public;
revoke all on function public.atelier_asset_purge_v1(uuid, uuid, uuid, text, text, text, uuid, timestamptz, timestamptz, integer) from public;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.atelier_asset_finalize_delete_v1(uuid, uuid, uuid, text, text, text, uuid, timestamptz, integer) to service_role;
    grant execute on function public.atelier_asset_cleanup_deleted_links_v1(uuid, uuid, uuid, text, text, text, uuid) to service_role;
    grant execute on function public.atelier_asset_purge_v1(uuid, uuid, uuid, text, text, text, uuid, timestamptz, timestamptz, integer) to service_role;
  end if;
end
$$;
