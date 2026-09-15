const fs = require("node:fs");
const path = require("node:path");
const { loadRuntimeConfig } = require("../admin/target-runtime-config");

const root = path.resolve(__dirname, "..");
const configPath = process.env.ATELIER_RUNTIME_CONFIG_PATH || path.join(root, "runtime-config.json");
if (fs.existsSync(configPath)) {
  const result = loadRuntimeConfig(configPath, { env: process.env, deploymentProjectId: process.env.MEOO_PROJECT_URL_ID });
  process.env.ATELIER_RUNTIME_CONFIG_FILE_PRESENT = "true";
  process.env.ATELIER_RUNTIME_CONFIG_FILE_READABLE = "true";
  process.env.ATELIER_RUNTIME_CONFIG_LOAD_STATUS = "LOADED_VALIDATED";
  console.log(`runtime-config-loaded schema=${result.config.schemaVersion} digest=${result.runtimeConfigDigest}`);
} else {
  process.env.ATELIER_RUNTIME_CONFIG_FILE_PRESENT = "false";
  process.env.ATELIER_RUNTIME_CONFIG_FILE_READABLE = "false";
  process.env.ATELIER_RUNTIME_CONFIG_LOAD_STATUS = "NOT_FOUND_FAIL_CLOSED";
}
process.chdir(path.join(root, "admin"));
require(path.join(root, "admin", "server.js"));
