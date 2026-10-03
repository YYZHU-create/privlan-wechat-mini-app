const fs = require('node:fs');
const path = require('node:path');
const { prepareApplicationRuntime } = require('./runtime-bootstrap');
const { validateProductionEnvironment, validateDatabaseBackend } = require('../admin/runtime-config');

// Local configuration validation only. No server, database, or network is started.
function readBundledEnvironment(root) {
  const file = path.join(root, '.runtime.env');
  if (!fs.existsSync(file)) return {};
  const result = {};
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    if (!line.trim() || line.trim().startsWith('#')) continue;
    const match = line.match(/^\s*(?:export\s+)?([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (!match) throw new Error('Unsupported bundled environment syntax');
    const [, key, raw] = match;
    // Bundled configuration is an image input, not a secret delivery mechanism.
    if (/SECRET|TOKEN|PASSWORD|PEPPER|MASTER_KEY|OPENID_HASH_KEY|DATABASE_URL|ATELIER_OPS_EMAIL|SERVICE_ROLE|PRIVATE_KEY|CREDENTIAL/.test(key)) {
      throw new Error('Sensitive configuration must not be bundled');
    }
    let value = raw.trim();
    if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
    else if (value.startsWith("'") && value.endsWith("'")) value = value.slice(1, -1);
    value = value.replace(/\$\{ROOT\}|\$ROOT\b/g, root);
    const expression = value.replace(root, '');
    if (/[\$`\\;"']/.test(expression) || /\s/.test(expression)) {
      throw new Error('Unsupported bundled environment expansion');
    }
    result[key] = value;
  }
  return result;
}

function preflight({ root, env = process.env }) {
  const input = { ...env, ...readBundledEnvironment(root), NODE_ENV: 'production' };
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
