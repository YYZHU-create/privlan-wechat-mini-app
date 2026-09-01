const { Client } = require("pg");
const sql = `select
md5(coalesce((select string_agg(format('%s.%s:%s:%s:%s:%s',table_name,column_name,data_type,udt_name,is_nullable,coalesce(column_default,'')), '|' order by table_name,column_name) from information_schema.columns where table_schema='public'),'')) as columns_digest,
md5(coalesce((select string_agg(format('%s:%s:%s',conrelid::regclass::text,conname,pg_get_constraintdef(oid)), '|' order by conrelid::regclass::text,conname) from pg_constraint where connamespace='public'::regnamespace),'')) as constraints_digest,
md5(coalesce((select string_agg(format('%s:%s',tablename,indexname), '|' order by tablename,indexname) from pg_indexes where schemaname='public'),'')) as indexes_digest,
md5(coalesce((select string_agg(format('%s:%s:%s',event_object_table,trigger_name,action_statement), '|' order by event_object_table,trigger_name,action_statement) from information_schema.triggers where trigger_schema='public'),'')) as triggers_digest,
md5(coalesce((select string_agg(format('%s:%s',routine_name,external_language), '|' order by routine_name,external_language) from information_schema.routines where routine_schema='public'),'')) as routines_digest`;
(async()=>{const c=new Client({connectionString:process.env.ATELIER_REAL_POSTGRES_URL});await c.connect();console.log(JSON.stringify((await c.query(sql)).rows[0]));await c.end()})().catch(e=>{console.error(e.message);process.exit(1)});
