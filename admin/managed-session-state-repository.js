"use strict";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function failure(code) { const e = new Error(code); e.code = code; return e; }
function selection(surface) {
  if (surface === "merchant") return { table: "merchant_sessions", owner: "user_id", link: "merchant_user_id" };
  if (surface === "operator") return { table: "operator_sessions", owner: "operator_id", link: "operator_user_id" };
  throw failure("MANAGED_SESSION_BINDING_INVALID");
}
function createManagedSessionStateRepository({ db, projectId, providerOrigin }) {
  if (!db?.query || !db?.transaction || !["asmhysidbg5g", "g8o5cv1om41o"].includes(projectId)) throw failure("MANAGED_SESSION_STORE_NOT_CONFIGURED");
  async function insert(r) {
    const s = selection(r.surface);
    if (r.projectId !== projectId || r.providerOrigin !== providerOrigin || !UUID.test(r.sessionId) ||
        !UUID.test(r.businessUserId) || !UUID.test(r.providerUserId)) throw failure("MANAGED_SESSION_BINDING_INVALID");
    await db.transaction(async tx => {
      const proof = await tx.query(`select s.id from ${s.table} s join managed_auth_identity_links l
        on l.${s.link}=s.${s.owner} and l.project_id=$2 and l.provider_origin=$3 and l.surface=$4 and l.provider_user_id=$5
        where s.id=$1 and s.${s.owner}=$6 and s.auth_provider='supabase' and s.revoked_at is null and s.expires_at>now() for update of s`,
      [r.sessionId,projectId,providerOrigin,r.surface,r.providerUserId,r.businessUserId]);
      if (proof.rows.length !== 1) throw failure("MANAGED_SESSION_BINDING_INVALID");
      await tx.query(`insert into managed_auth_session_state(session_id,project_id,provider_origin,surface,provider_user_id,business_user_id,
        merchant_session_id,operator_session_id,issued_at_ms,deadline_ms,encrypted_state) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [r.sessionId,projectId,providerOrigin,r.surface,r.providerUserId,r.businessUserId,
        r.surface === "merchant" ? r.sessionId : null,r.surface === "operator" ? r.sessionId : null,r.issuedAt,r.deadline,r.encryptedState]);
    });
  }
  async function withLockedSession(input, callback) {
    const s = selection(input.surface);
    if (input.projectId !== projectId || input.providerOrigin !== providerOrigin || !UUID.test(input.sessionId)) throw failure("MANAGED_SESSION_BINDING_INVALID");
    return db.transaction(async tx => {
      const rows = (await tx.query(`select v.* from managed_auth_session_state v join ${s.table} s on s.id=v.session_id and s.${s.owner}=v.business_user_id
        where v.session_id=$1 and v.project_id=$2 and v.provider_origin=$3 and v.surface=$4
        and s.auth_provider='supabase' and s.revoked_at is null and s.expires_at>now() for update of v,s`,
      [input.sessionId,projectId,providerOrigin,input.surface])).rows;
      if (rows.length !== 1) return null;
      const v = rows[0];
      const row = { sessionId:v.session_id,projectId:v.project_id,providerOrigin:v.provider_origin,surface:v.surface,
        providerUserId:v.provider_user_id,businessUserId:v.business_user_id,issuedAt:Number(v.issued_at_ms),deadline:Number(v.deadline_ms),encryptedState:v.encrypted_state };
      return callback({ row, updateEncryptedState: async encrypted => {
        const result = await tx.query("update managed_auth_session_state set encrypted_state=$2 where session_id=$1 returning session_id", [row.sessionId,encrypted]);
        if (result.rows.length !== 1) throw failure("MANAGED_SESSION_STORE_WRITE_NOT_CONFIRMED");
      } });
    });
  }
  return { insert, withLockedSession };
}
module.exports = { createManagedSessionStateRepository };
