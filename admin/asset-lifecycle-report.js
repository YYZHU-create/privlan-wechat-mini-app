const RETENTION_DAYS = 30;
const MAX_REPORT_BATCH_SIZE = 100;

function retentionCutoff(now = new Date()) {
  return new Date(now.getTime() - RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString();
}

function lifecycleReportScope(scope = {}) {
  const tenantId = String(scope.tenantId || "").trim();
  const workspaceId = String(scope.workspaceId || "").trim();
  if (!tenantId || !workspaceId) {
    const error = new Error("ASSET_LIFECYCLE_SCOPE_REQUIRED");
    error.code = "ASSET_LIFECYCLE_SCOPE_REQUIRED";
    throw error;
  }
  return { tenantId, workspaceId, storeId: null, actorType: "operator" };
}

// This report deliberately has no apply option, provider, or lifecycle RPC dependency.
async function generateLifecycleMaintenanceReport({ repository, scope, requestId, operatorUserId, now = new Date(), onEvent = () => {} }) {
  if (!repository || typeof repository.countDeletedAssets !== "function") {
    const error = new Error("ASSET_LIFECYCLE_REPORT_DEPENDENCY_INVALID");
    error.code = "ASSET_LIFECYCLE_REPORT_DEPENDENCY_INVALID";
    throw error;
  }
  const reportScope = lifecycleReportScope(scope);
  const generatedAt = now.toISOString();
  const cutoff = retentionCutoff(now);
  const startedAt = Date.now();
  const [retentionCandidateCount, reconciliationCandidateCount, oldDeletedCount, oldLinkedCount] = await Promise.all([
    repository.countDeletedAssets(reportScope, { allStores: true }),
    repository.countDeletedAssets(reportScope, { allStores: true, withLinks: true }),
    repository.countDeletedAssets(reportScope, { allStores: true, retentionCutoff: cutoff }),
    repository.countDeletedAssets(reportScope, { allStores: true, retentionCutoff: cutoff, withLinks: true })
  ]);
  const purgeCandidateCount = Math.max(0, oldDeletedCount - oldLinkedCount);
  const report = {
    mode: "dry-run",
    tenantId: reportScope.tenantId,
    workspaceId: reportScope.workspaceId,
    purgeCandidateCount,
    retentionCandidateCount,
    reconciliationCandidateCount,
    requestId: String(requestId || ""),
    generatedAt,
    storageVerificationRequired: purgeCandidateCount > 0
  };
  try {
    onEvent("asset_lifecycle_dry_run_requested", {
      requestId: report.requestId,
      operatorUserId: String(operatorUserId || ""),
      tenantId: report.tenantId,
      workspaceId: report.workspaceId,
      candidateCounts: {
        purge: report.purgeCandidateCount,
        retention: report.retentionCandidateCount,
        reconciliation: report.reconciliationCandidateCount
      },
      durationMs: Date.now() - startedAt,
      result: "ok"
    });
  } catch {}
  return report;
}

module.exports = { MAX_REPORT_BATCH_SIZE, RETENTION_DAYS, retentionCutoff, lifecycleReportScope, generateLifecycleMaintenanceReport };
