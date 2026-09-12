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
