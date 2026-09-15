#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const { createDeploymentArtifact, TARGETS } = require("../admin/target-runtime-config");

function arg(name, fallback) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

const targetProjectId = arg("--target-project");
const configPath = arg("--config");
const sourceCommit = arg("--source-commit");
const outputDir = arg("--output");
if (!targetProjectId || !configPath || !sourceCommit || !outputDir) {
  console.error("USAGE: prepare-image-runtime.js --target-project <id> --config <path> --source-commit <sha> --output <dir>");
  process.exit(2);
}
const config = JSON.parse(fs.readFileSync(path.resolve(configPath), "utf8"));
const knownTarget = Object.values(TARGETS).find(value => value.targetProjectId === targetProjectId);
if (!knownTarget) throw new Error("UNKNOWN_DEPLOYMENT_TARGET");
const sourceDir = path.resolve(__dirname, "..");
const result = createDeploymentArtifact({ sourceDir, outputDir: path.resolve(outputDir), targetProjectId, sourceCommit, config });
const evidencePath = `${path.resolve(outputDir)}.deployment-evidence.json`;
fs.writeFileSync(evidencePath, JSON.stringify({ ...result.evidence, artifactDigestLocation: "EXTERNAL_RELEASE_RECORD", artifactDigestCircularity: "NO" }, null, 2) + "\n");
console.log(JSON.stringify({ outputDir: path.resolve(outputDir), ...result.evidence, evidencePath }, null, 2));
