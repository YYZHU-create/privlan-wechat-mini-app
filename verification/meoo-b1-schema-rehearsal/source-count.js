const { Client } = require("pg");
(async () => {
  const client = new Client({ connectionString: process.env.ATELIER_REAL_POSTGRES_URL });
  await client.connect();
  const result = await client.query("select (select count(*) from information_schema.tables where table_schema='public' and table_type='BASE TABLE')::int as tables,(select count(*) from information_schema.columns where table_schema='public')::int as columns,(select count(*) from pg_indexes where schemaname='public')::int as indexes,(select count(*) from information_schema.table_constraints where constraint_schema='public')::int as constraints,(select count(*) from information_schema.triggers where trigger_schema='public')::int as triggers,(select count(*) from information_schema.routines where routine_schema='public')::int as routines,(select count(*) from information_schema.sequences where sequence_schema='public')::int as sequences");
  console.log(JSON.stringify(result.rows[0]));
  await client.end();
})().catch(error => { console.error(error.message); process.exit(1); });
