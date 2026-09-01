const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { Client } = require("pg");

const PROVIDER_MIGRATIONS = Object.freeze([
  "001_appointment_transaction_rpc.sql",
  "002_lock_down_core_data_access.sql",
  "003_visible_write_paths.sql"
]);

const CATALOG_QUERY_SQL = Object.freeze({
  tables: `select n.nspname as schema, c.relname as name
    from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relkind in ('r','p')
    order by n.nspname,c.relname;`,
  columns: `select table_schema as schema, table_name as "table", column_name as name,
      ordinal_position::int as ordinal, data_type as "dataType", udt_name as udt,
      (is_nullable='YES') as nullable, coalesce(column_default,'') as "default"
    from information_schema.columns where table_schema='public'
    order by table_schema,table_name,ordinal_position;`,
  indexes: `select n.nspname as schema, t.relname as "table", i.relname as name,
      am.amname as method, ix.indisunique as "unique", ix.indisprimary as "primary",
      ix.indisexclusion as exclusion,
      coalesce((select jsonb_agg(case when a.attnum is not null then a.attname else regexp_replace(pg_get_indexdef(i.oid,s.position,true),'\\s+',' ','g') end order by s.position)
        from generate_series(1,ix.indnkeyatts) as s(position)
        left join pg_attribute a on a.attrelid=t.oid and a.attnum=ix.indkey[s.position] and not a.attisdropped),'[]'::jsonb) as keys,
      coalesce(regexp_replace(pg_get_expr(ix.indpred,ix.indrelid),'\\s+',' ','g'),'') as predicate
    from pg_index ix join pg_class i on i.oid=ix.indexrelid join pg_class t on t.oid=ix.indrelid
      join pg_namespace n on n.oid=t.relnamespace join pg_am am on am.oid=i.relam
    where n.nspname='public' order by n.nspname,t.relname,i.relname;`,
  constraints: `select n.nspname as schema, rel.relname as "table", c.conname as name, c.contype as type,
      coalesce((select jsonb_agg(att.attname order by key.ordinality) from unnest(c.conkey) with ordinality key(attnum,ordinality)
        join pg_attribute att on att.attrelid=c.conrelid and att.attnum=key.attnum),'[]'::jsonb) as columns,
      case when c.confrelid=0 then null else c.confrelid::regclass::text end as "referencedTable",
      coalesce((select jsonb_agg(att.attname order by key.ordinality) from unnest(c.confkey) with ordinality key(attnum,ordinality)
        join pg_attribute att on att.attrelid=c.confrelid and att.attnum=key.attnum),'[]'::jsonb) as "referencedColumns",
      c.confupdtype as "updateAction", c.confdeltype as "deleteAction", c.condeferrable as deferrable,
      c.condeferred as "initiallyDeferred", c.convalidated as validated,
      regexp_replace(pg_get_constraintdef(c.oid,true),'\\s+',' ','g') as expression
    from pg_constraint c join pg_class rel on rel.oid=c.conrelid join pg_namespace n on n.oid=rel.relnamespace
    where n.nspname='public' order by n.nspname,rel.relname,c.conname;`,
  triggers: `select n.nspname as schema, rel.relname as "table", t.tgname as name,
      t.tgtype::int as type, t.tgenabled as enabled, regexp_replace(pg_get_triggerdef(t.oid,true),'\\s+',' ','g') as definition
    from pg_trigger t join pg_class rel on rel.oid=t.tgrelid join pg_namespace n on n.oid=rel.relnamespace
    where n.nspname='public' and not t.tgisinternal order by n.nspname,rel.relname,t.tgname;`,
  functions: `select n.nspname as schema, p.proname as name, pg_get_function_identity_arguments(p.oid) as "identityArguments",
      l.lanname as language, p.prokind as kind, p.prosecdef as "securityDefiner", coalesce(to_jsonb(p.proconfig),'[]'::jsonb) as config,
      has_function_privilege('anon',p.oid,'execute') as "anonExecute",
      has_function_privilege('authenticated',p.oid,'execute') as "authenticatedExecute",
      has_function_privilege('service_role',p.oid,'execute') as "serviceRoleExecute"
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace join pg_language l on l.oid=p.prolang
    where n.nspname='public' and p.prokind='f' order by n.nspname,p.proname,pg_get_function_identity_arguments(p.oid);`,
  foreignKeyValidation: `select count(*) filter (where c.contype='f' and not c.convalidated)::int as "unvalidatedForeignKeyCount"
    from pg_constraint c join pg_namespace n on n.oid=c.connamespace where n.nspname='public';`
});
const SOURCE_FUNCTIONS_SQL = `select n.nspname as schema, p.proname as name, pg_get_function_identity_arguments(p.oid) as "identityArguments",
      l.lanname as language, p.prokind as kind, p.prosecdef as "securityDefiner", coalesce(to_jsonb(p.proconfig),'[]'::jsonb) as config,
      false as "anonExecute", false as "authenticatedExecute", false as "serviceRoleExecute"
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace join pg_language l on l.oid=p.prolang
    where n.nspname='public' and p.prokind='f' order by n.nspname,p.proname,pg_get_function_identity_arguments(p.oid);`;
const SOURCE_CATALOG_QUERY_SQL = Object.freeze({ ...CATALOG_QUERY_SQL, functions: SOURCE_FUNCTIONS_SQL });const CATALOG_SQL = "-- Provider-normalized catalog uses CATALOG_QUERY_SQL category queries.";
const TARGET_QUERY_ORDER = Object.freeze(["tables", "columns", "indexes", "constraints", "triggers", "functions", "foreignKeyValidation"]);

function parityError(code, details = {}) { const error = new Error(code); error.code = code; Object.assign(error, details); return error; }
function normalizeString(value) { return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : value; }
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  return normalizeString(value);
}
function objectKey(kind, value) {
  if (kind === "tables") return `${value.schema}.${value.name}`;
  if (kind === "columns") return `${value.schema}.${value.table}.${value.name}`;
  if (kind === "indexes") return `${value.schema}.${value.table}.${value.name}`;
  if (kind === "constraints") return `${value.schema}.${value.table}.${value.name}`;
  if (kind === "triggers") return `${value.schema}.${value.table}.${value.name}`;
  if (kind === "functions") return `${value.schema}.${value.name}(${value.identityArguments || ""})`;
  throw parityError("SCHEMA_PARITY_OBJECT_KIND_INVALID");
}
function maps(kind, values) { return new Map((values || []).map(value => [objectKey(kind, value), canonical(value)])); }
function compareMaps(kind, source, target) {
  const sourceMap = maps(kind, source); const targetMap = maps(kind, target);
  const missing = [...sourceMap.keys()].filter(key => !targetMap.has(key));
  const extra = [...targetMap.keys()].filter(key => !sourceMap.has(key));
  const changed = [...sourceMap.keys()].filter(key => targetMap.has(key) && JSON.stringify(sourceMap.get(key)) !== JSON.stringify(targetMap.get(key)));
  return { missing, extra, changed, pass: !missing.length && !extra.length && !changed.length };
}
function providerMigrationFiles(root) { return PROVIDER_MIGRATIONS.map(file => path.join(root, "platform", "provider-migrations", "meoo", file)); }
function providerInventory(root = path.resolve(__dirname, "..")) {
  const functions = new Set(); const constraints = new Set();
  for (const file of providerMigrationFiles(root)) {
    const text = fs.readFileSync(file, "utf8");
    for (const match of text.matchAll(/create\s+or\s+replace\s+function\s+public\.([a-z_][a-z0-9_]*)\s*\(/gi)) functions.add(match[1]);
    for (const match of text.matchAll(/alter\s+table\s+(?:public\.)?([a-z_][a-z0-9_]*)[\s\S]{0,500}?add\s+constraint\s+([a-z_][a-z0-9_]*)/gi)) constraints.add(`public.${match[1]}.${match[2]}`);
  }
  return { functions: [...functions].sort(), constraints: [...constraints].sort() };
}
function normalizeCatalog(value) {
  const catalog = value && typeof value === "object" ? value : {};
  return Object.fromEntries(["tables", "columns", "indexes", "constraints", "triggers", "functions"].map(key => [key, Array.isArray(catalog[key]) ? catalog[key] : []]));
}
function coreFunctionShape(value) {
  const { anonExecute, authenticatedExecute, serviceRoleExecute, ...semantic } = value;
  return semantic;
}
function attachQueryEvidence(catalog, queryStates, metadata = {}) {
  Object.defineProperties(catalog, {
    queryStates: { value: Object.freeze({ ...queryStates }), enumerable: false },
    queryMetadata: { value: Object.freeze({ ...metadata }), enumerable: false }
  });
  return catalog;
}
function compareProviderNormalizedCatalogs({ source, target, inventory }) {
  const sourceCatalog = normalizeCatalog(source); const targetCatalog = normalizeCatalog(target);
  const table = compareMaps("tables", sourceCatalog.tables, targetCatalog.tables);
  const column = compareMaps("columns", sourceCatalog.columns, targetCatalog.columns);
  const index = compareMaps("indexes", sourceCatalog.indexes, targetCatalog.indexes);
  const trigger = compareMaps("triggers", sourceCatalog.triggers, targetCatalog.triggers);
  const constraint = compareMaps("constraints", sourceCatalog.constraints, targetCatalog.constraints);
  const providerConstraints = new Set(inventory.constraints || []);
  const unclassifiedTargetConstraints = constraint.extra.filter(key => !providerConstraints.has(key));
  const targetCoreUnvalidatedForeignKeyCount = targetCatalog.constraints.filter(value => value.type === "f" && value.validated !== true && !providerConstraints.has(objectKey("constraints", value))).length;
  const coreConstraintPass = !constraint.missing.length && !constraint.changed.length && !unclassifiedTargetConstraints.length && targetCoreUnvalidatedForeignKeyCount === 0;
  const sourceFunctions = maps("functions", sourceCatalog.functions.map(coreFunctionShape));
  const expectedProviderFunctions = new Set(inventory.functions || []);
  const targetCoreFunctions = targetCatalog.functions.filter(fn => !expectedProviderFunctions.has(fn.name)).map(coreFunctionShape);
  const targetCoreFunctionMap = maps("functions", targetCoreFunctions);
  const coreFunctionMissing = [...sourceFunctions.keys()].filter(key => !targetCoreFunctionMap.has(key));
  const coreFunctionChanged = [...sourceFunctions.keys()].filter(key => targetCoreFunctionMap.has(key) && JSON.stringify(sourceFunctions.get(key)) !== JSON.stringify(targetCoreFunctionMap.get(key)));
  const targetOnlyFunctions = targetCatalog.functions.filter(fn => !sourceFunctions.has(objectKey("functions", coreFunctionShape(fn))));
  const classifiedProvider = targetOnlyFunctions.filter(fn => expectedProviderFunctions.has(fn.name));
  const unexpectedTargetFunctions = targetOnlyFunctions.filter(fn => !expectedProviderFunctions.has(fn.name));
  const providerNames = classifiedProvider.map(fn => fn.name).sort();
  const expectedProviderFunctionInventory = [...expectedProviderFunctions].every(name => providerNames.filter(value => value === name).length === 1) && providerNames.length === expectedProviderFunctions.size;
  const providerSecurityState = expectedProviderFunctionInventory && classifiedProvider.every(fn => fn.anonExecute === false && fn.authenticatedExecute === false && fn.serviceRoleExecute === true);
  const unclassified = [...table.extra, ...column.extra, ...index.extra, ...trigger.extra, ...unclassifiedTargetConstraints, ...unexpectedTargetFunctions.map(fn => objectKey("functions", fn))];
  const coreFunctionPass = !coreFunctionMissing.length && !coreFunctionChanged.length;
  return {
    coreTableParity: table.pass,
    coreColumnParity: column.pass,
    coreIndexParity: index.pass,
    coreConstraintParity: coreConstraintPass,
    coreTriggerParity: trigger.pass,
    coreFunctionParity: coreFunctionPass,
    expectedProviderFunctionInventory,
    expectedProviderSecurityState: providerSecurityState,
    coreUnvalidatedForeignKeyCount: targetCoreUnvalidatedForeignKeyCount,
    targetUnvalidatedForeignKeyCount: targetCoreUnvalidatedForeignKeyCount,
    unclassifiedTargetConstraints: unclassifiedTargetConstraints.length,
    unexpectedTargetFunctionCount: unexpectedTargetFunctions.length,
    unclassifiedTargetSchemaObjects: unclassified.length,
    targetSchemaProviderNormalizedParity: table.pass && column.pass && index.pass && coreConstraintPass && trigger.pass && coreFunctionPass && expectedProviderFunctionInventory && providerSecurityState && !unclassified.length,
    details: { table, column, index, constraint, trigger, coreFunctionMissing, coreFunctionChanged, providerNames, unexpectedTargetFunctions: unexpectedTargetFunctions.map(fn => objectKey("functions", fn)) }
  };
}
async function readSourceCatalog({ connectionString, clientFactory = options => new Client(options) } = {}) {
  if (!/^postgres(?:ql)?:\/\//i.test(String(connectionString || ""))) throw parityError("SCHEMA_PARITY_SOURCE_CONNECTION_REQUIRED");
  const client = clientFactory({ connectionString, application_name: "atelier-meoo-schema-parity", options: "-c default_transaction_read_only=on" });
  const catalog = {}; const states = {}; const metadata = {};
  try {
    await client.connect(); await client.query("begin isolation level repeatable read read only");
    for (const category of TARGET_QUERY_ORDER) {
      let result;
      try { result = await client.query(SOURCE_CATALOG_QUERY_SQL[category]); }
      catch (error) { throw parityError("SCHEMA_PARITY_SOURCE_CATEGORY_QUERY_FAILED", { category, sqlClass: category, sourceCode: error.code || "" }); }
      if (category === "foreignKeyValidation") metadata[category] = result.rows[0] || {};
      else catalog[category] = result.rows;
      states[category] = "PASS";
    }
    await client.query("rollback"); return attachQueryEvidence(normalizeCatalog(catalog), states, metadata);
  } catch (error) { try { await client.query("rollback"); } catch {} throw error; }
  finally { await client.end().catch(() => {}); }
}
function cliCommand() { return process.platform === "win32" ? (process.env.ComSpec || "cmd.exe") : "meoo"; }
function quoteWindowsArg(value) { return `"${String(value).replace(/[\^&|<>()"]/g, "^$&")}"`; }
function meooCommandArgs(args) { return ["meoo", ...args].map(quoteWindowsArg).join(" "); }
function runMeooJson({ args, root, run = spawnSync }) {
  const options = { cwd: root, encoding: "utf8", windowsHide: true, shell: false };
  const result = process.platform === "win32"
    ? run(cliCommand(), ["/d", "/s", "/c", meooCommandArgs(args)], options)
    : run(cliCommand(), args, options);
  if (!result || result.status !== 0) return { ok: false, result, message: String(result?.stderr || result?.stdout || "").trim() };
  try {
    const body = JSON.parse(result.stdout || "");
    if (body?.success !== true || !Array.isArray(body?.data?.rows)) return { ok: false, result, message: String(body?.error?.code || "SCHEMA_PARITY_TARGET_QUERY_INVALID") };
    return { ok: true, rows: body.data.rows };
  } catch { return { ok: false, result, message: "SCHEMA_PARITY_TARGET_QUERY_INVALID" }; }
}
function sleepSync(milliseconds) { if (milliseconds > 0) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds); }
function readTargetCategory({ root, targetProjectId, category, run, retryDelayMs = 30000, maxAttempts = 3 }) {
  const sql = CATALOG_QUERY_SQL[category]; if (!sql) throw parityError("SCHEMA_PARITY_CATEGORY_INVALID", { category });
  const file = path.join(root, ".cutover-artifacts", "provider-normalized-catalog", `${category}.sql`);
  fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, sql, "utf8");
  let lastMessage = "";
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const response = runMeooJson({ args: ["--json", "db", "query", "--project", targetProjectId, "--file", file], root, run });
    if (response.ok) return { rows: response.rows, attempts: attempt, state: "PASS" };
    lastMessage = response.message;
    if (attempt < maxAttempts) sleepSync(retryDelayMs);
  }
  throw parityError("SCHEMA_PARITY_TARGET_CATEGORY_QUERY_FAILED", { category, attempts: maxAttempts, errorMessage: lastMessage, sqlClass: category });
}
function readTargetCatalog({ root = path.resolve(__dirname, ".."), targetProjectId, run = spawnSync, retryDelayMs, maxAttempts } = {}) {
  if (!/^[A-Za-z0-9_-]{6,120}$/.test(String(targetProjectId || ""))) throw parityError("SCHEMA_PARITY_TARGET_PROJECT_INVALID");
  const catalog = {}; const states = {}; const metadata = {};
  for (const category of TARGET_QUERY_ORDER) {
    const result = readTargetCategory({ root, targetProjectId, category, run, retryDelayMs, maxAttempts });
    if (category === "foreignKeyValidation") metadata[category] = result.rows[0] || {};
    else catalog[category] = result.rows;
    states[category] = `PASS:${result.attempts}`;
  }
  return attachQueryEvidence(normalizeCatalog(catalog), states, metadata);
}
async function verifyProviderNormalizedSchemaParity({ connectionString, targetProjectId, root = path.resolve(__dirname, ".."), clientFactory, run, retryDelayMs, maxAttempts } = {}) {
  const source = await readSourceCatalog({ connectionString, clientFactory });
  const target = readTargetCatalog({ root, targetProjectId, run, retryDelayMs, maxAttempts });
  const result = compareProviderNormalizedCatalogs({ source, target, inventory: providerInventory(root) });
  return { ...result, queryStates: { source: source.queryStates, target: target.queryStates }, queryMetadata: { source: source.queryMetadata, target: target.queryMetadata } };
}

module.exports = { CATALOG_SQL, CATALOG_QUERY_SQL, SOURCE_CATALOG_QUERY_SQL, PROVIDER_MIGRATIONS, TARGET_QUERY_ORDER, compareProviderNormalizedCatalogs, normalizeCatalog, providerInventory, readSourceCatalog, readTargetCatalog, readTargetCategory, verifyProviderNormalizedSchemaParity };


