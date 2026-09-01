-- Cutover tooling finalization: validate every existing public FK after a fresh
-- Core/Provider schema build and before any business-data import.
do $$
declare
  item record;
begin
  for item in
    select c.conrelid::regclass as owning_table, c.conname
    from pg_constraint c
    where c.contype = 'f'
      and c.connamespace = 'public'::regnamespace
      and not c.convalidated
    order by c.conrelid::regclass::text, c.conname
  loop
    execute format('alter table %s validate constraint %I', item.owning_table, item.conname);
  end loop;

  if exists (
    select 1
    from pg_constraint c
    where c.contype = 'f'
      and c.connamespace = 'public'::regnamespace
      and not c.convalidated
  ) then
    raise exception 'CUTOVER_TARGET_UNVALIDATED_FOREIGN_KEYS_REMAIN';
  end if;
end $$;
