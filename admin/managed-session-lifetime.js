"use strict";
const crypto = require("node:crypto");
const FIXED_LIFETIME_MS = 7 * 24 * 3600000;
function failure(code) { const e = new Error(code); e.code = code; return e; }

// Server-only encrypted provider state. The repository must supply a cross-process
// exclusive transaction/lease; a JavaScript-only mutex is insufficient in runtime.
function createManagedSessionLifetime({ projectId, providerOrigin, key, repository, managedAuth, now = Date.now }) {
  let origin;
  try { origin = new URL(providerOrigin); } catch { throw failure("MANAGED_SESSION_STORE_NOT_CONFIGURED"); }
  if (!["asmhysidbg5g", "g8o5cv1om41o"].includes(projectId) || origin.protocol !== "https:" ||
      origin.origin !== providerOrigin || !Buffer.isBuffer(key) || key.length !== 32 ||
      !repository?.insert || !repository?.withLockedSession || !managedAuth?.resolve || !managedAuth?.refresh) {
    throw failure("MANAGED_SESSION_STORE_NOT_CONFIGURED");
  }
  const encryptionKey = Buffer.from(key);
  const binding = r => JSON.stringify([projectId, providerOrigin, r.sessionId, r.surface, r.businessUserId, r.providerUserId, r.issuedAt, r.deadline]);
  function seal(r, session) {
    if (!session?.accessToken || !session?.refreshToken || !Number.isFinite(Number(session.expiresAt)) || Number(session.expiresAt) * 1000 <= now()) {
      throw failure("MANAGED_SESSION_PROVIDER_STATE_INVALID");
    }
    const iv = crypto.randomBytes(12), cipher = crypto.createCipheriv("aes-256-gcm", encryptionKey, iv);
    cipher.setAAD(Buffer.from(binding(r)));
    const body = Buffer.concat([cipher.update(JSON.stringify(session), "utf8"), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), body]).toString("base64url");
  }
  function open(r) {
    try {
      const bytes = Buffer.from(r.encryptedState, "base64url");
      const decipher = crypto.createDecipheriv("aes-256-gcm", encryptionKey, bytes.subarray(0, 12));
      decipher.setAAD(Buffer.from(binding(r))); decipher.setAuthTag(bytes.subarray(12, 28));
      return JSON.parse(Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString("utf8"));
    } catch { throw failure("MANAGED_SESSION_STATE_NOT_VERIFIED"); }
  }
  function verifyIdentity(identity, r) {
    if (!identity || identity.surface !== r.surface || identity.businessUserId !== r.businessUserId ||
        identity.providerUserId !== r.providerUserId || identity.principal?.id !== r.businessUserId || identity.principal?.status !== "active") {
      throw failure("MANAGED_SESSION_IDENTITY_CHANGED");
    }
  }
  async function issue({ sessionId, surface, businessUserId, providerResult, transaction }) {
    if (!sessionId || !businessUserId || !["merchant", "operator"].includes(surface) || !providerResult?.identity?.providerUserId) {
      throw failure("MANAGED_SESSION_IDENTITY_CHANGED");
    }
    const issuedAt = now();
    const row = { projectId, providerOrigin, sessionId, surface, businessUserId,
      providerUserId: providerResult.identity.providerUserId, issuedAt, deadline: issuedAt + FIXED_LIFETIME_MS };
    verifyIdentity(providerResult.identity, row);
    row.encryptedState = seal(row, providerResult.session);
    await repository.insert(row, transaction);
    return { expiresAt: new Date(row.deadline) };
  }
  async function resolve({ sessionId, surface, businessUserId }) {
    return repository.withLockedSession({ projectId, providerOrigin, sessionId, surface }, async locked => {
      const r = locked?.row;
      if (!r || r.revoked || r.deadline <= now()) return null;
      if (r.projectId !== projectId || r.providerOrigin !== providerOrigin || r.sessionId !== sessionId || r.surface !== surface ||
          r.businessUserId !== businessUserId || !Number.isFinite(r.issuedAt) || !Number.isFinite(r.deadline) ||
          r.issuedAt > now() || r.deadline !== r.issuedAt + FIXED_LIFETIME_MS) throw failure("MANAGED_SESSION_STATE_NOT_VERIFIED");
      const state = open(r);
      let identity;
      if (Number(state.expiresAt) * 1000 <= now() + 30000) {
        if (locked.markRefreshStarted) await locked.markRefreshStarted();
        const result = await managedAuth.refresh({ refreshToken: state.refreshToken, surface, businessUserId });
        verifyIdentity(result?.identity, r);
        if (now() >= r.deadline) return null;
        const encryptedState = seal(r, result.session);
        // Persist the rotated refresh token before accepting the request.
        await locked.updateEncryptedState(encryptedState);
        identity = result.identity;
      } else {
        identity = await managedAuth.resolve(state.accessToken, surface);
        verifyIdentity(identity, r);
      }
      if (now() >= r.deadline) return null;
      return { identity, expiresAt: new Date(r.deadline) };
    });
  }
  return { issue, resolve };
}
module.exports = { createManagedSessionLifetime, FIXED_LIFETIME_MS };
