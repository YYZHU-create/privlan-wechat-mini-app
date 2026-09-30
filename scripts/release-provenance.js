#!/usr/bin/env node
// Local release evidence. This program never invokes a deployment command.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');

const SHA = /^[0-9a-f]{40}$/;
const PROJECT = /^[a-z0-9]{6,32}$/;
const BLOCKED_NAME = /^(?:\.env(?:\..*)?|credentials?(?:\..*)?|secrets?(?:\..*)?|.*\.(?:pem|key|p12|pfx))$/i;

function sha256(data) { return crypto.createHash('sha256').update(data).digest('hex'); }
function git(repo, ...args) { return execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8' }).trim(); }
function assertOutside(root, output) {
  const relative = path.relative(root, output);
  if (!relative || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative))) {
    throw new Error('OUTPUT_INSIDE_BUILD_CONTEXT');
  }
}
function inventory(root) {
  const files = [];
  function visit(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const absolute = path.join(dir, entry.name);
      const relative = path.relative(root, absolute).split(path.sep).join('/');
      if (entry.isSymbolicLink()) throw new Error(`SYMLINK_IN_BUILD_CONTEXT:${relative}`);
      if (BLOCKED_NAME.test(entry.name)) throw new Error(`SENSITIVE_FILENAME_IN_BUILD_CONTEXT:${relative}`);
      if (entry.isDirectory()) { visit(absolute); continue; }
      if (!entry.isFile()) throw new Error(`UNSUPPORTED_BUILD_INPUT:${relative}`);
      const data = fs.readFileSync(absolute);
      files.push({ path: relative, bytes: data.length, sha256: sha256(data) });
    }
  }
  visit(root);
  files.sort((a, b) => Buffer.compare(Buffer.from(a.path), Buffer.from(b.path)));
  return files;
}
function digestFiles(files) {
  return sha256(files.map(f => `${f.path}\0${f.bytes}\0${f.sha256}\n`).join(''));
}
function readManifest(manifestPath) {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  if (manifest.schemaVersion !== 'feeldao-release-provenance-v1' || !SHA.test(manifest.sourceCommit) ||
      !PROJECT.test(manifest.project) || !Array.isArray(manifest.files) ||
      manifest.fileCount !== manifest.files.length ||
      manifest.buildContextDigest !== `sha256:${digestFiles(manifest.files)}`) {
    throw new Error('INVALID_MANIFEST');
  }
  return manifest;
}
function prepare({ repo, buildContext, output, project, environment }) {
  repo = fs.realpathSync(repo);
  buildContext = fs.realpathSync(buildContext);
  output = path.resolve(output);
  assertOutside(buildContext, output);
  if (!PROJECT.test(project)) throw new Error('INVALID_PROJECT');
  if (!['staging', 'production'].includes(environment)) throw new Error('INVALID_ENVIRONMENT');
  const sourceCommit = git(repo, 'rev-parse', 'HEAD').toLowerCase();
  if (!SHA.test(sourceCommit)) throw new Error('INVALID_SOURCE_COMMIT');
  if (git(repo, 'status', '--porcelain=v1', '--untracked-files=all')) throw new Error('SOURCE_REPO_NOT_CLEAN');
  const identityPath = path.join(buildContext, 'runtime-build.json');
  if (!fs.existsSync(identityPath)) throw new Error('BUILD_IDENTITY_MISSING');
  const identity = JSON.parse(fs.readFileSync(identityPath, 'utf8'));
  const declaredCommits = [identity.sourceCommit, identity.commitSha].filter(Boolean);
  if (!declaredCommits.length || declaredCommits.some(value => String(value).toLowerCase() !== sourceCommit)) {
    throw new Error('BUILD_SOURCE_MISMATCH');
  }
  if (identity.declaredTargetProjectId !== project || identity.environment !== environment) throw new Error('BUILD_TARGET_MISMATCH');
  const files = inventory(buildContext);
  const manifest = {
    schemaVersion: 'feeldao-release-provenance-v1',
    evidenceClass: 'LOCAL_BUILD_INPUT',
    sourceCommit, project, environment,
    buildContextDigest: `sha256:${digestFiles(files)}`,
    fileCount: files.length, files,
    generatedAtUtc: new Date().toISOString(),
    platformReleaseBinding: 'NOT_VERIFIED'
  };
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  return manifest;
}
function verify({ manifestPath, buildContext }) {
  const manifest = readManifest(manifestPath);
  const current = inventory(fs.realpathSync(buildContext));
  if (JSON.stringify(current) !== JSON.stringify(manifest.files) || `sha256:${digestFiles(current)}` !== manifest.buildContextDigest) {
    throw new Error('BUILD_CONTEXT_DRIFT');
  }
  return { sourceCommit: manifest.sourceCommit, buildContextDigest: manifest.buildContextDigest, fileCount: current.length };
}
function finalize({ manifestPath, releaseListPath, releaseVersion, output }) {
  const manifest = readManifest(manifestPath);
  const raw = fs.readFileSync(releaseListPath);
  const listing = JSON.parse(raw.toString('utf8'));
  const versions = listing?.data?.versions;
  if (!Array.isArray(versions)) throw new Error('INVALID_RELEASE_LIST');
  const matches = versions.filter(v => v.version === Number(releaseVersion));
  if (matches.length !== 1 || matches[0].isActive !== true || matches[0].status !== 'SUCCESS') throw new Error('ACTIVE_RELEASE_MISMATCH');
  if (matches[0].commitId && matches[0].commitId !== manifest.sourceCommit) throw new Error('RELEASE_COMMIT_MISMATCH');
  if (!matches[0].createdAt || !Number.isFinite(Date.parse(matches[0].createdAt)) ||
      Date.parse(matches[0].createdAt) < Date.parse(manifest.generatedAtUtc)) throw new Error('RELEASE_PREDATES_MANIFEST');
  const receipt = {
    schemaVersion: 'feeldao-release-receipt-v1',
    evidenceClass: 'LOCAL_CAPTURE_PLUS_CLI_RELEASE_LIST',
    project: manifest.project, environment: manifest.environment,
    sourceCommit: manifest.sourceCommit, buildContextDigest: manifest.buildContextDigest,
    manifestSha256: `sha256:${sha256(fs.readFileSync(manifestPath))}`,
    cliReleaseListSha256: `sha256:${sha256(raw)}`,
    releaseVersion: matches[0].version, releaseStatus: matches[0].status,
    releaseCreatedAt: matches[0].createdAt || null,
    releaseCommitId: matches[0].commitId || null,
    observedAtUtc: new Date().toISOString(),
    platformReleaseToArtifactBinding: 'NOT_VERIFIED',
    runtimeAcceptance: 'NOT_VERIFIED'
  };
  fs.mkdirSync(path.dirname(path.resolve(output)), { recursive: true });
  fs.writeFileSync(output, JSON.stringify(receipt, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  return receipt;
}
function parseArgs(argv) {
  const [command, ...rest] = argv;
  const args = {};
  for (let i = 0; i < rest.length; i += 2) {
    if (!rest[i]?.startsWith('--') || !rest[i + 1]) throw new Error('INVALID_ARGUMENTS');
    args[rest[i].slice(2)] = rest[i + 1];
  }
  return { command, args };
}
if (require.main === module) {
  try {
    const { command, args } = parseArgs(process.argv.slice(2));
    const result = command === 'prepare' ? prepare({ repo: args.repo, buildContext: args['build-context'], output: args.output, project: args.project, environment: args.environment })
      : command === 'verify' ? verify({ manifestPath: args.manifest, buildContext: args['build-context'] })
      : command === 'finalize' ? finalize({ manifestPath: args.manifest, releaseListPath: args['release-list'], releaseVersion: args.release, output: args.output })
      : (() => { throw new Error('COMMAND_MUST_BE_PREPARE_VERIFY_OR_FINALIZE'); })();
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
module.exports = { prepare, verify, finalize, inventory, digestFiles };
