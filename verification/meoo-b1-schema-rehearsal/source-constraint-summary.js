const { Client } = require("pg");
const sql = "select contype, count(*)::int as count, md5(coalesce(string_agg(format('%s:%s:%s',conrelid::regclass::text,conname,pg_get_constraintdef(oid)), '|' order by conrelid::regclass::text,conname),'')) as digest from pg_constraint where connamespace='public'::regnamespace group by contype order by contype";
(async()=>{const c=new Client({connectionString:process.env.ATELIER_REAL_POSTGRES_URL});await c.connect();console.log(JSON.stringify((await c.query(sql)).rows));await c.end()})().catch(e=>{console.error(e.message);process.exit(1)});
