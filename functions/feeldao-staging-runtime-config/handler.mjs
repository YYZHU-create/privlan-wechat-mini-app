export const SECRET_NAMES = Object.freeze(['ATELIER_LICENSE_PEPPER', 'ATELIER_MASTER_KEY', 'ATELIER_APPOINTMENT_GATEWAY_TOKEN', 'ATELIER_OPENID_HASH_KEY']);

export function createHandler({ getEnv, cryptoImpl = globalThis.crypto }) {
  return async function handler(request) {
    const headers = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Pragma': 'no-cache' };
    const reply = (status, body) => new Response(JSON.stringify(body), { status, headers });
    if (request.method !== 'GET') return reply(405, { code: 'METHOD_NOT_ALLOWED' });
    const expected = getEnv('SUPABASE_SERVICE_ROLE_KEY');
    const authorization = request.headers.get('authorization') || '';
    if (!expected || authorization.length > 8192) return reply(403, { code: 'FORBIDDEN' });
    const encode = new TextEncoder();
    const [left, right] = await Promise.all([authorization, `Bearer ${expected}`].map(value => cryptoImpl.subtle.digest('SHA-256', encode.encode(value))));
    const a = new Uint8Array(left), b = new Uint8Array(right);
    let difference = 0;
    for (let i = 0; i < a.length; i++) difference |= a[i] ^ b[i];
    if (difference) return reply(403, { code: 'FORBIDDEN' });
    const secrets = Object.fromEntries(SECRET_NAMES.map(name => [name, getEnv(name)]));
    if (SECRET_NAMES.some(name => typeof secrets[name] !== 'string' || !secrets[name])) return reply(503, { code: 'CONFIGURATION_INCOMPLETE' });
    return reply(200, { projectId: 'asmhysidbg5g', secrets });
  };
}
