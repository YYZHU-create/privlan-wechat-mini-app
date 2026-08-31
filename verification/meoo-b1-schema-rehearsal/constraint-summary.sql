select contype, count(*)::int as count, md5(coalesce(string_agg(format('%s:%s:%s',conrelid::regclass::text,conname,pg_get_constraintdef(oid)), '|' order by conrelid::regclass::text,conname),'')) as digest
from pg_constraint
where connamespace='public'::regnamespace
group by contype
order by contype;
