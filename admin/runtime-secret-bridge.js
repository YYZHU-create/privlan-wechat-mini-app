'use strict';
const NAMES = Object.freeze(['ATELIER_LICENSE_PEPPER', 'ATELIER_MASTER_KEY', 'ATELIER_APPOINTMENT_GATEWAY_TOKEN', 'ATELIER_OPENID_HASH_KEY']);
function validateSecrets(secrets) {
  if (!secrets || Object.keys(secrets).length !== NAMES.length || NAMES.some(name => typeof secrets[name] !== 'string')) throw new Error('SECRET_BRIDGE_INVALID_FIELDS');
  const key = secrets.ATELIER_MASTER_KEY;
  if (secrets.ATELIER_LICENSE_PEPPER.length < 32 || secrets.ATELIER_APPOINTMENT_GATEWAY_TOKEN.length < 32 || Buffer.byteLength(secrets.ATELIER_OPENID_HASH_KEY) < 32 || Buffer.from(key, 'base64').length !== 32 || Buffer.from(key, 'base64').toString('base64') !== key) throw new Error('SECRET_BRIDGE_INVALID_FORMAT');
}
async function loadRuntimeSecrets({ env = process.env, fetchImpl = globalThis.fetch } = {}) {
  if (env.ATELIER_RUNTIME_SECRET_BRIDGE !== 'staging') return { delivery: 'INHERITED', count: 0 };
  if (env.MEOO_PROJECT_URL_ID !== 'asmhysidbg5g' || env.ATELIER_ENVIRONMENT !== 'staging' || env.ATELIER_AUTH_PROVIDER !== 'supabase' || env.ATELIER_DB_BACKEND !== 'meoo' || env.ATELIER_AUTO_MIGRATE !== '0' || env.DATABASE_URL) throw new Error('SECRET_BRIDGE_TARGET_MISMATCH');
  const url = new URL(env.SUPABASE_URL || '');
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || !env.SUPABASE_SERVICE_ROLE_KEY) throw new Error('SECRET_BRIDGE_CONNECTION_REQUIRED');
  const endpoint = `${url.href.replace(/\/$/, '')}/functions/v1/feeldao-staging-runtime-config`;
  let response, payload;
  try {
    response = await fetchImpl(endpoint, { method: 'GET', redirect: 'error', cache: 'no-store', headers: { Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, Accept: 'application/json' }, signal: AbortSignal.timeout(10000) });
    if (!response.ok || !String(response.headers.get('content-type') || '').includes('application/json')) throw new Error();
    const text = await response.text();
    if (Buffer.byteLength(text) > 16384) throw new Error();
    payload = JSON.parse(text);
  } catch { throw new Error('SECRET_BRIDGE_REQUEST_FAILED'); }
  if (payload.projectId !== env.MEOO_PROJECT_URL_ID) throw new Error('SECRET_BRIDGE_PROJECT_MISMATCH');
  validateSecrets(payload.secrets);
  if (NAMES.some(name => env[name] && env[name] !== payload.secrets[name])) throw new Error('SECRET_BRIDGE_INHERITED_CONFLICT');
  // All checks complete before any environment mutation; security policy is not part of the payload.
  for (const name of NAMES) env[name] = payload.secrets[name];
  return { delivery: 'STAGING_EDGE_FUNCTION', count: NAMES.length };
}
module.exports = { loadRuntimeSecrets, validateSecrets, NAMES };
