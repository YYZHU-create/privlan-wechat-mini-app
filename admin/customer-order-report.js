const fs = require("node:fs");
const path = require("node:path");
const { createPostgresDatabase } = require("./database");

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function inspectLegacyOrders(db, { apply = false } = {}) {
  const rows = (await db.query("select id,tenant_id,workspace_id,store_id,customer_id,customer_ref from orders order by created_at,id")).rows;
  const report = { totalOrders: rows.length, linkedOrders: 0, linkableOrders: 0, unlinkedOrders: 0, ambiguousOrders: 0, appliedOrders: 0, unresolved: [] };
  for (const order of rows) {
    if (order.customer_id) { report.linkedOrders += 1; continue; }
    const reference = String(order.customer_ref || "").trim();
    if (!UUID.test(reference)) { report.unlinkedOrders += 1; report.unresolved.push({ orderId: order.id, reason: reference ? "unsupported_reference" : "missing_reference" }); continue; }
    const candidates = (await db.query("select id,workspace_id from customers where id=$1 and tenant_id=$2 and store_id=$3", [reference, order.tenant_id, order.store_id])).rows;
    if (candidates.length !== 1) { const ambiguous = candidates.length > 1; report[ambiguous ? "ambiguousOrders" : "unlinkedOrders"] += 1; report.unresolved.push({ orderId: order.id, reason: ambiguous ? "ambiguous_reference" : "customer_not_found" }); continue; }
    report.linkableOrders += 1;
    if (apply) { await db.query("update orders set workspace_id=$1,customer_id=$2 where id=$3 and customer_id is null", [candidates[0].workspace_id, candidates[0].id, order.id]); report.appliedOrders += 1; }
  }
  return report;
}

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
  const db = await createPostgresDatabase(process.env.DATABASE_URL);
  try {
    const apply = process.argv.includes("--apply");
    const report = await inspectLegacyOrders(db, { apply });
    const targetIndex = process.argv.indexOf("--output");
    const target = targetIndex >= 0 ? path.resolve(process.argv[targetIndex + 1]) : path.resolve(process.cwd(), "customer-order-migration-report.json");
    fs.writeFileSync(target, JSON.stringify({ mode: apply ? "apply" : "dry-run", generatedAt: new Date().toISOString(), ...report }, null, 2));
    process.stdout.write(`${target}\n`);
  } finally { await db.close(); }
}

if (require.main === module) main().catch(error => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
module.exports = { inspectLegacyOrders };
