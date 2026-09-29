#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const { loadRuntimeConfig } = require("../admin/target-runtime-config");
const { canaryConfigDigest } = require("../admin/asset-lifecycle-permit");

function bootstrapRuntimeConfig({ root = path.resolve(__dirname, ".."), env = process.env, log = console.log } = {}) {
  const configPath = env.ATELIER_RUNTIME_CONFIG_PATH || path.join(root, "runtime-config.json");
  if (!fs.existsSync(configPath)) {
    env.ATELIER_RUNTIME_CONFIG_FILE_PRESENT = "false";
    env.ATELIER_RUNTIME_CONFIG_FILE_READABLE = "false";
    env.ATELIER_RUNTIME_CONFIG_LOAD_STATUS = "NOT_FOUND_FAIL_CLOSED";
    env.ATELIER_RUNTIME_CONFIG_DIGEST = "unknown";
    env.ATELIER_CANARY_CONFIG_DIGEST = canaryConfigDigest({ enabled: false });
    return { status: env.ATELIER_RUNTIME_CONFIG_LOAD_STATUS };
  }
  env.ATELIER_RUNTIME_CONFIG_FILE_PRESENT = "true";
  try {
    const result = loadRuntimeConfig(configPath, { env, deploymentProjectId: env.MEOO_PROJECT_URL_ID });
    env.ATELIER_RUNTIME_CONFIG_FILE_READABLE = "true";
    env.ATELIER_RUNTIME_CONFIG_LOAD_STATUS = "LOADED_VALIDATED";
    env.ATELIER_RUNTIME_CONFIG_DIGEST = result.runtimeConfigDigest;
    env.ATELIER_CANARY_CONFIG_DIGEST = canaryConfigDigest(result.config.media.lifecycleCanary);
    log(`runtime-config-loaded schema=${result.config.schemaVersion} digest=${result.runtimeConfigDigest}`);
    return { status: env.ATELIER_RUNTIME_CONFIG_LOAD_STATUS, config: result.config, runtimeConfigDigest: result.runtimeConfigDigest };
  } catch {
    env.ATELIER_RUNTIME_CONFIG_FILE_READABLE = "false";
    env.ATELIER_RUNTIME_CONFIG_LOAD_STATUS = "INVALID_FAIL_CLOSED";
    env.ATELIER_RUNTIME_CONFIG_DIGEST = "unknown";
    env.ATELIER_CANARY_CONFIG_DIGEST = canaryConfigDigest({ enabled: false });
    return { status: env.ATELIER_RUNTIME_CONFIG_LOAD_STATUS };
  }
}

if (require.main === module) {
  const root = path.resolve(__dirname, "..");
  bootstrapRuntimeConfig({ root });
  process.chdir(path.join(root, "admin"));
  require(path.join(root, "admin", "server.js"));
}

module.exports = { bootstrapRuntimeConfig };
