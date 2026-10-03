function enforceApplicationMigrationPolicy(env = process.env) {
  env.ATELIER_AUTO_MIGRATE = "0";
  return { autoMigrate: false };
}

function validateApplicationTarget(config, env = process.env) {
  const project = String(env.MEOO_PROJECT_URL_ID || config?.targetProjectId || "").trim();
  const environment = String(env.ATELIER_ENVIRONMENT || "").trim().toLowerCase();
  const targets = { g8o5cv1om41o: "production", asmhysidbg5g: "staging" };
  if (env.NODE_ENV === "production" || targets[project]) {
    if (!config) throw new Error("APPLICATION_TARGET_CONFIG_REQUIRED");
    if (!targets[project] || config.targetProjectId !== project ||
        config.environment !== targets[project] || environment !== targets[project]) {
      throw new Error("APPLICATION_TARGET_MISMATCH");
    }
  }
  return { declaredProjectId: project || null, environment: environment || null };
}

function validateApplicationDatabaseSelection(env = process.env) {
  if (String(env.ATELIER_DB_BACKEND || "native").trim().toLowerCase() === "meoo" && env.DATABASE_URL) {
    throw new Error("APPLICATION_DATABASE_SELECTION_AMBIGUOUS");
  }
}

module.exports = { enforceApplicationMigrationPolicy, validateApplicationTarget, validateApplicationDatabaseSelection };
