const fs = require('node:fs');
const path = require('node:path');
const { prepareApplicationRuntime } = require('./runtime-bootstrap');
const { validateProductionEnvironment, validateDatabaseBackend } = require('../admin/runtime-config');

// Local configuration validation only. No server, database, or network is started.
function preflight({ root, env = process.env }) {
  const input = { ...env, NODE_ENV: 'production' };
  if (!input.ATELIER_DB_BACKEND) input.ATELIER_DB_BACKEND = input.DATABASE_URL ? 'native' : 'meoo';
  const runtime = prepareApplicationRuntime({ root, env: input, log() {} });
  validateProductionEnvironment(input);
  const backend = validateDatabaseBackend(input);
  return {
    result: 'PASS_LOCAL_CONFIGURATION',
    environment: input.ATELIER_ENVIRONMENT,
    declaredProject: runtime.declaredProjectId,
    backend,
    autoMigrate: input.ATELIER_AUTO_MIGRATE,
    runtimeSecretInjection: 'NOT_VERIFIED'
  };
}

if (require.main === module) {
  try {
    const root = path.resolve(process.argv[2] || path.join(__dirname, '..'));
    const protectedFile = process.argv[3];
    const supplied = protectedFile ? JSON.parse(fs.readFileSync(protectedFile, 'utf8')) : {};
    if (!supplied || Array.isArray(supplied) || typeof supplied !== 'object' ||
      Object.values(supplied).some(value => typeof value !== 'string')) {
      throw new Error('Invalid environment object');
    }
    console.log(JSON.stringify(preflight({ root, env: { ...process.env, ...supplied } })));
  } catch {
    // Validation errors may carry configuration details; do not serialize them.
    console.error('IMAGE_STARTUP_PREFLIGHT=BLOCKED_INVALID_OR_MISSING_CONFIGURATION');
    process.exitCode = 2;
  }
}

module.exports = { preflight };
