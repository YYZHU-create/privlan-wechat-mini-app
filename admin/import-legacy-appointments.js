const fs = require("node:fs");
const path = require("node:path");
const { createPostgresDatabase } = require("./database");
const { applyImport, inspectImport, sourceHash } = require("./appointment-import");

function argument(name) { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : ""; }

async function main() {
  const sourcePath = path.resolve(argument("--source"));
  const publicStoreId = argument("--public-store-id");
  const apply = process.argv.includes("--apply");
  const reportPath = argument("--report");
  if (!argument("--source") || !publicStoreId) throw new Error("Usage: node import-legacy-appointments.js --source export.json --public-store-id STORE_ID [--apply] [--report report.json]");
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
  const bytes = fs.readFileSync(sourcePath); const hash = sourceHash(bytes); const document = JSON.parse(bytes.toString("utf8"));
  const db = await createPostgresDatabase(process.env.DATABASE_URL);
  try {
    const result = apply ? await applyImport({ db, publicStoreId, document, hash }) : (await inspectImport({ db, publicStoreId, document, hash })).report;
    const output = `${JSON.stringify(result, null, 2)}\n`;
    if (reportPath) fs.writeFileSync(path.resolve(reportPath), output, "utf8");
    process.stdout.write(output);
    if (result.status === "invalid") process.exitCode = 2;
  } finally { await db.close(); }
}

main().catch(error => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
