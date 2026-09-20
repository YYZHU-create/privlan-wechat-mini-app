const crypto = require("node:crypto");
const { createAssetRepository } = require("./asset-repository");
const { createMeooStorageProvider } = require("./storage-provider");
const { RETENTION_DAYS, retentionCutoff } = require("./asset-lifecycle-report");

const MAX_BATCH_SIZE = 100;

function option(argv, name) {
  const prefix = `--${name}=`;
  const value = argv.find(item => item.startsWith(prefix));
  return value ? value.slice(prefix.length) : null;
}

function parseArgs(argv = process.argv.slice(2)) {
  const mode = option(argv, "mode") || "purge";
  if (!["purge", "reconcile-links"].includes(mode)) throw new Error("ASSET_LIFECYCLE_MODE_INVALID");
  const tenantId = option(argv, "tenant-id");
  const workspaceId = option(argv, "workspace-id");
  const storeId = option(argv, "store-id");
  const actorId = option(argv, "actor-id");
  const runId = option(argv, "run-id");
  const apply = argv.includes("--apply");
  const batchSize = Number(option(argv, "batch-size") || 25);
  if (!tenantId || !workspaceId || !actorId || !Number.isInteger(batchSize) || batchSize < 1 || batchSize > MAX_BATCH_SIZE) throw new Error("ASSET_LIFECYCLE_SCOPE_OR_BATCH_INVALID");
  if (apply && !runId) throw new Error("ASSET_LIFECYCLE_RUN_ID_REQUIRED");
  return { mode, apply, batchSize, runId: runId || `dry_${crypto.randomUUID()}`, actorId, scope: { tenantId, workspaceId, storeId: storeId || null, actorType: "system" } };
}

async function verifyStorageAbsent(provider, scope, objects) {
  for (const object of objects) {
    if (typeof provider.verifyDeleted !== "function") throw new Error("ASSET_STORAGE_DELETE_VERIFICATION_UNAVAILABLE");
    if (!(await provider.verifyDeleted(scope, object.object_key))) return false;
  }
  return true;
}

async function runMaintenance({ repository, provider, options, now = new Date(), onEvent = () => {} }) {
  const emit = (event, fields) => { try { onEvent(event, fields); } catch {} };
  const lifecycleEvent = (operation, assetId, input = {}) => emit("lifecycle_reconciliation", {
    operation,
    assetId,
    tenantId: options.scope.tenantId,
    workspaceId: options.scope.workspaceId,
    requestId: input.requestId || null,
    attempt: input.attempt || 1,
    errorClass: input.errorClass || null,
    reconciliationResult: input.reconciliationResult || null
  });
  const cutoff = retentionCutoff(now);
  const candidates = await repository.listDeletedAssets(options.scope, { retentionCutoff: options.mode === "purge" ? cutoff : null, batchSize: options.batchSize });
  const summary = { mode: options.mode, dryRun: !options.apply, runId: options.runId, cutoff: options.mode === "purge" ? cutoff : null, scanned: candidates.length, eligible: 0, applied: 0, skipped: [] };

  for (const asset of candidates) {
    const links = await repository.listAssetLinks(options.scope, asset.id);
    if (options.mode === "reconcile-links") {
      if (!links.length) { summary.skipped.push({ assetId: asset.id, code: "NO_LINKS" }); continue; }
      summary.eligible += 1;
      if (options.apply) {
        const requestId = `${options.runId}:${asset.id}`;
        try {
          const result = await repository.cleanupDeletedAssetLinks(options.scope, asset.id, { actorType: "system", actorId: options.actorId, requestId });
          lifecycleEvent("cleanup", asset.id, { requestId, reconciliationResult: result?.reconciliation?.outcome || null });
        } catch (error) {
          lifecycleEvent("cleanup", asset.id, { requestId, errorClass: error.code || "DATABASE_UNAVAILABLE", reconciliationResult: error.reconciliation?.outcome || "INDETERMINATE" });
          throw error;
        }
        summary.applied += 1;
      }
      continue;
    }

    if (links.length) { summary.skipped.push({ assetId: asset.id, code: "ASSET_LINKS_PRESENT" }); continue; }
    const objects = await repository.listAssetObjects(options.scope, asset.id);
    let absent;
    try { absent = await verifyStorageAbsent(provider, options.scope, objects); }
    catch (error) { summary.skipped.push({ assetId: asset.id, code: error.code || "STORAGE_VERIFICATION_FAILED" }); continue; }
    if (!absent) { summary.skipped.push({ assetId: asset.id, code: "STORAGE_OBJECT_PRESENT" }); continue; }
    summary.eligible += 1;
    if (options.apply) {
      const requestId = `${options.runId}:${asset.id}`;
      try {
        const result = await repository.purgeDeletedAsset(options.scope, asset.id, {
          actorType: "system",
          actorId: options.actorId,
          requestId,
          retentionCutoff: cutoff,
          storageVerifiedAt: new Date().toISOString(),
          objectCount: objects.length
        });
        lifecycleEvent("purge", asset.id, { requestId, reconciliationResult: result?.reconciliation?.outcome || null });
      } catch (error) {
        lifecycleEvent("purge", asset.id, { requestId, errorClass: error.code || "DATABASE_UNAVAILABLE", reconciliationResult: error.reconciliation?.outcome || "INDETERMINATE" });
        throw error;
      }
      summary.applied += 1;
    }
  }
  return summary;
}

async function main() {
  const options = parseArgs();
  const summary = await runMaintenance({ repository: createAssetRepository(), provider: createMeooStorageProvider(), options });
  process.stdout.write(`${JSON.stringify(summary)}\n`);
}

if (require.main === module) {
  main().catch(error => {
    process.stderr.write(`${error.code || error.message || "ASSET_LIFECYCLE_MAINTENANCE_FAILED"}\n`);
    process.exitCode = 1;
  });
}

module.exports = { MAX_BATCH_SIZE, RETENTION_DAYS, parseArgs, retentionCutoff, runMaintenance, verifyStorageAbsent };
