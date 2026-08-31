const { Client } = require("pg");
const sql = "select conrelid::regclass::text as table_name, conname, pg_get_constraintdef(oid) as definition from pg_constraint where connamespace='public'::regnamespace order by 1,2";
(async()=>{const c=new Client({connectionString:process.env.ATELIER_REAL_POSTGRES_URL});await c.connect();process.stdout.write(JSON.stringify((await c.query(sql)).rows));await c.end()})().catch(e=>{process.stderr.write(e.message);process.exit(1)});
