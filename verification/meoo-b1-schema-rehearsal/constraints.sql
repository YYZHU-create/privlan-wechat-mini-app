select conrelid::regclass::text as table_name, conname, pg_get_constraintdef(oid) as definition
from pg_constraint
where connamespace='public'::regnamespace
order by 1,2;
