const crypto = require("node:crypto");
const { types, Client } = require("pg");

types.setTypeParser(1114, value => value);
types.setTypeParser(1184, value => value);
types.setTypeParser(1700, value => value);

const EXCLUDED_TABLES = new Set(["schema_migrations"]);
const DEFAULT_BATCH_SIZE = 25;

function buildImportPolicy(snapshot, targetRowCounts = {}) {
  return Object.fromEntries(snapshot.tableOrder.map(table => [table, {
    dataOwner: "ATELIER",
    createdBy: "core migrations and ATELIER application",
    seededBy: table === "plan_catalog" ? "001_saas_mvp.sql plan_catalog seed" : null,
    importPolicy: table === "plan_catalog" ? "RECONCILE_SEEDED_METADATA" : "COPY_EXACT",
    sourceRows: snapshot.rows[table].length,
    targetPreexistingRows: Number(targetRowCounts[table] || 0),
    referencedByCount: (snapshot.foreignKeys || []).filter(fk => fk.parent === table).length,
    hasForeignKeys: (snapshot.foreignKeys || []).some(fk => fk.child === table),
    rationale: table === "plan_catalog" ? "Core migration seeds stable catalog IDs; reconcile exact semantic rows before preserving target seed." : "Authoritative ATELIER business, identity, audit, configuration, or relationship data; preserve exact IDs and values."
  }]));
}

function quoteIdentifier(value) {
  if (!/^[a-z_][a-z0-9_]*$/.test(String(value || ""))) throw new Error("invalid table identifier");
  return `"${value}"`;
}

function normalizePrimaryKeyColumns(value) {
  if (Array.isArray(value)) return value;
  const text = String(value || "");
  if (!/^\{[a-z_][a-z0-9_]*(?:,[a-z_][a-z0-9_]*)*\}$/.test(text)) throw new Error("invalid primary key metadata");
  return text.slice(1, -1).split(",");
}

function canonical(value) {
  if (value === null || value === undefined) return null;
  if (Buffer.isBuffer(value)) return { $byteaSha256: crypto.createHash("sha256").update(value).digest("hex") };
  if (Array.isArray(value)) return value.map(canonical);
  if (typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  return value;
}

function digestStrings(values) {
  const hash = crypto.createHash("sha256");
  for (const value of [...values].sort()) hash.update(value).update("\n");
  return hash.digest("hex");
}

function rowDigest(rows) {
  return digestStrings(rows.map(row => JSON.stringify(canonical(row))));
}

function semanticRows(table, rows) {
  if (table === "plan_catalog") return rows.map(row => ({
    id: row.id,
    display_name: row.display_name,
    price_fen: Number(row.price_fen),
    duration_hours: row.duration_hours === null ? null : Number(row.duration_hours),
    public: Boolean(row.public),
    entitlements: row.entitlements || {}
  }));
  return rows;
}

function dataFingerprint(snapshot) {
  const perTable = Object.fromEntries(Object.entries(snapshot.rows).map(([table, rows]) => [table, rowDigest(semanticRows(table, rows))]));
  const ids = [];
  const passwordRows = [];
  const relationships = [];
  for (const [table, rows] of Object.entries(snapshot.rows)) {
    for (const row of rows) {
      if (row.id !== undefined && row.id !== null) ids.push(`${table}:${String(row.id).toLowerCase()}`);
      if (row.password_hash !== undefined && row.id !== undefined) passwordRows.push(`${table}:${row.id}:${row.password_hash}`);
      for (const key of ["tenant_id", "workspace_id", "store_id", "customer_id", "user_id", "membership_id"]) {
        if (row[key] !== undefined && row[key] !== null) relationships.push(`${table}:${row.id || ""}:${key}:${String(row[key]).toLowerCase()}`);
      }
    }
  }
  return {
    tableDigests: perTable,
    criticalDigest: digestStrings(Object.entries(perTable).map(([table, digest]) => `${table}:${digest}`)),
    stableIdDigest: digestStrings(ids),
    passwordHashDigest: digestStrings(passwordRows),
    relationshipDigest: digestStrings(relationships)
  };
}

function topologicalOrder(tables, foreignKeys) {
  const set = new Set(tables);
  const incoming = new Map(tables.map(table => [table, 0]));
  const outgoing = new Map(tables.map(table => [table, []]));
  for (const { child, parent } of foreignKeys) {
    if (!set.has(child) || !set.has(parent) || child === parent) continue;
    incoming.set(child, incoming.get(child) + 1);
    outgoing.get(parent).push(child);
  }
  const ready = tables.filter(table => incoming.get(table) === 0).sort();
  const order = [];
  while (ready.length) {
    const table = ready.shift();
    order.push(table);
    for (const child of outgoing.get(table).sort()) {
      incoming.set(child, incoming.get(child) - 1);
      if (incoming.get(child) === 0) ready.push(child);
    }
    ready.sort();
  }
  const cyclic = tables.filter(table => !order.includes(table));
  if (cyclic.length) throw new Error(`foreign-key cycle detected: ${cyclic.join(",")}`);
  return order;
}

async function readSourceSnapshot({ connectionString, onProgress = () => {} }) {
  if (!connectionString) throw new Error("ATELIER_REAL_POSTGRES_URL is required");
  const client = new Client({ connectionString, application_name: "atelier-meoo-data-rehearsal-readonly" });
  await client.connect();
  try {
    await client.query("begin isolation level repeatable read read only");
    const identity = (await client.query("select current_database() database, current_user db_user, version() version, clock_timestamp() snapshot_at")).rows[0];
    if (identity.database !== "atelier_os_staging") throw new Error("unexpected source database");
    const migrations = (await client.query("select version from schema_migrations order by version")).rows.map(row => row.version);
    if (migrations.at(-1) !== "010_workflow_event_contract_immutability") throw new Error("unexpected source migration state");
    const tables = (await client.query("select table_name from information_schema.tables where table_schema='public' and table_type='BASE TABLE' order by table_name"))
      .rows.map(row => row.table_name).filter(table => !EXCLUDED_TABLES.has(table));
    const foreignKeys = (await client.query("select replace(conrelid::regclass::text, 'public.', '') child, replace(confrelid::regclass::text, 'public.', '') parent from pg_constraint where contype='f' and connamespace='public'::regnamespace order by 1,2"))
      .rows;
    const primaryKeys = Object.fromEntries((await client.query(`
      select
        cls.relname as table_name,
        array_agg(att.attname order by ord.ordinality) as columns
      from pg_index idx
      join pg_class cls on cls.oid = idx.indrelid
      join pg_namespace ns on ns.oid = cls.relnamespace and ns.nspname = 'public'
      join unnest(idx.indkey) with ordinality ord(attnum, ordinality) on true
      join pg_attribute att on att.attrelid = cls.oid and att.attnum = ord.attnum
      where idx.indisprimary
      group by cls.relname
    `)).rows.map(row => [row.table_name, normalizePrimaryKeyColumns(row.columns)]));
    const tableOrder = topologicalOrder(tables, foreignKeys);
    const rows = {};
    for (const table of tableOrder) {
      rows[table] = (await client.query(`select to_jsonb(source_row) as row from public.${quoteIdentifier(table)} source_row`)).rows.map(row => row.row);
      onProgress({ phase: "extract", table, rows: rows[table].length });
    }
    await client.query("commit");
    const snapshot = { identity, migrations, tables, foreignKeys, primaryKeys, tableOrder, rows };
    return { snapshot, fingerprint: dataFingerprint(snapshot) };
  } catch (error) {
    try { await client.query("rollback"); } catch {}
    throw error;
  } finally {
    await client.end();
  }
}

function createTargetClient({ url = process.env.SUPABASE_URL, serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY, fetchImpl = globalThis.fetch } = {}) {
  if (!/^https:\/\//i.test(String(url || "")) || !serviceRoleKey || typeof fetchImpl !== "function") throw new Error("Meoo service-role configuration is required");
  const baseUrl = String(url).replace(/\/$/, "");
  const headers = { apikey: serviceRoleKey, Authorization: `Bearer ${serviceRoleKey}`, "Content-Type": "application/json" };
  async function request(table, options = {}) {
    const response = await fetchImpl(`${baseUrl}/rest/v1/${table}${options.query || ""}`, { method: options.method || "GET", headers: { ...headers, ...(options.headers || {}) }, body: options.body });
    const text = await response.text();
    if (!response.ok) throw new Error(`target ${options.method || "GET"} failed for ${table}: HTTP ${response.status}`);
    return text ? JSON.parse(text) : null;
  }
  return { request };
}

function batches(rows, size) {
  const output = [];
  for (let index = 0; index < rows.length; index += size) output.push(rows.slice(index, index + size));
  return output;
}

async function migrateSnapshot(snapshot, target, { batchSize = DEFAULT_BATCH_SIZE, policy, onProgress = () => {} } = {}) {
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 100) throw new Error("batch size must be 1-100");
  if (!policy || typeof policy !== "object") throw new Error("import policy is required");
  for (const table of snapshot.tableOrder) {
    const rule = policy[table];
    if (!rule || !rule.importPolicy) throw new Error(`missing import policy for ${table}`);
    const rows = snapshot.rows[table];
    if (rule.importPolicy === "BLOCKED_REVIEW") throw new Error(`import policy blocked for ${table}`);
    if (rule.importPolicy === "TARGET_PROVIDER_MANAGED" || rule.importPolicy === "DERIVED_REBUILD") {
      if (rows.length) throw new Error(`unsupported source rows for ${table} policy ${rule.importPolicy}`);
      onProgress({ phase: "skip", table, rows: 0 });
      continue;
    }
    if (rule.importPolicy === "RECONCILE_SEEDED_METADATA") {
      const targetRows = await target.request(table, { query: "?select=*" });
      if (rowDigest(semanticRows(table, targetRows)) !== rowDigest(semanticRows(table, rows))) throw new Error(`seeded metadata mismatch for ${table}`);
      onProgress({ phase: "reconcile", table, rows: rows.length });
      continue;
    }
    if (rule.importPolicy !== "COPY_EXACT") throw new Error(`unknown import policy for ${table}`);
    const existing = await target.request(table, { query: "?select=*&limit=1" });
    if (existing.length) throw new Error(`copy-exact target is not empty for ${table}`);
    for (const batch of batches(rows, batchSize)) {
      await target.request(table, { method: "POST", headers: { Prefer: "return=minimal,resolution=error-rollback" }, body: JSON.stringify(batch) });
      onProgress({ phase: "insert", table, rows: batch.length });
    }
  }
}

async function readTargetSnapshot(snapshot, target, { pageSize = 100 } = {}) {
  const rows = {};
  for (const table of snapshot.tableOrder) {
    const all = [];
    for (let offset = 0;; offset += pageSize) {
      const page = await target.request(table, { query: `?select=*&limit=${pageSize}&offset=${offset}` });
      all.push(...page);
      if (page.length < pageSize) break;
    }
    rows[table] = all;
  }
  return { ...snapshot, rows };
}

async function cleanupSnapshot(snapshot, target, { policy, onProgress = () => {} } = {}) {
  if (!policy || typeof policy !== "object") throw new Error("import policy is required for cleanup");
  for (const table of [...snapshot.tableOrder].reverse()) {
    if (!snapshot.rows[table].length) continue;
    const rule = policy[table];
    if (!rule || !rule.importPolicy) throw new Error(`missing import policy for ${table}`);
    if (rule.importPolicy !== "COPY_EXACT") {
      onProgress({ phase: "preserve", table, rows: snapshot.rows[table].length });
      continue;
    }
    const primaryKey = snapshot.primaryKeys?.[table];
    if (!Array.isArray(primaryKey) || primaryKey.length === 0) throw new Error(`missing primary key metadata for ${table}`);
    const query = `?${encodeURIComponent(primaryKey[0])}=not.is.null`;
    await target.request(table, { method: "DELETE", query, headers: { Prefer: "return=minimal" } });
    onProgress({ phase: "cleanup", table, rows: snapshot.rows[table].length });
  }
}

module.exports = { DEFAULT_BATCH_SIZE, canonical, semanticRows, dataFingerprint, buildImportPolicy, topologicalOrder, normalizePrimaryKeyColumns, readSourceSnapshot, createTargetClient, migrateSnapshot, readTargetSnapshot, cleanupSnapshot };
