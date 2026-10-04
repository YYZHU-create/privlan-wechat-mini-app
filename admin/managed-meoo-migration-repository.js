"use strict";
const { createNativeMigrationRepository } = require("./managed-existing-account-migration");
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function fail(code) { return new Error(code); }
function literal(value) {
  if (typeof value !== "string" || value.includes("\0")) throw fail("AUTH_MIGRATION_INVALID_SQL_VALUE");
  return "E'" + value.replace(/\\/g, "\\\\").replace(/'/g, "''") + "'";
}
// queryOnce must keep SQL/results in memory, bind the explicit project and never retry.
function createMeooMigrationRepository({ projectId, expectedDatabase, queryOnce }) {
  if (typeof queryOnce !== "function") throw fail("AUTH_MIGRATION_QUERY_TRANSPORT_REQUIRED");
  async function query(sql, parameters = []) {
    // Fully constructed DO bodies already contain escaped data, including
    // legacy hashes whose segments may start with digits after a dollar sign.
    const statement = parameters.length
      ? sql.replace(/\$(\d+)/g, (_, index) => literal(parameters[Number(index) - 1]))
      : sql;
    try {
      const rows = await queryOnce({ projectId, sql: statement });
      if (!Array.isArray(rows)) throw new Error();
      return { rows };
    } catch { throw fail("AUTH_MIGRATION_QUERY_NOT_CONFIRMED"); }
  }
  const readOnly = createNativeMigrationRepository({ projectId, expectedDatabase,
    db: { query, transaction: async () => { throw fail("AUTH_MIGRATION_TRANSACTION_UNAVAILABLE"); } } });
  async function commitIdentityLinks({ plan, providerUserId, original }) {
    if (plan.projectId !== projectId || !UUID.test(providerUserId) || !UUID.test(original.merchant.id) || !UUID.test(original.operator.id) ||
        plan.identities.length !== 2 || plan.identities.find(i => i.surface === "merchant")?.businessUserId !== original.merchant.id ||
        plan.identities.find(i => i.surface === "operator")?.businessUserId !== original.operator.id) {
      throw fail("AUTH_MIGRATION_IDENTITY_BINDING_MISMATCH");
    }
    const p = literal(projectId), o = literal(plan.providerOrigin), subject = literal(providerUserId);
    const merchant = literal(original.merchant.id), operator = literal(original.operator.id);
    // A single DO statement has one transaction even without connection affinity.
    // Fixed errors contain no credential values; no business row is updated.
    const body = `
    DECLARE m users%ROWTYPE; a operator_users%ROWTYPE; n integer;
    BEGIN
      IF current_database() <> ${literal(expectedDatabase)} THEN RAISE EXCEPTION 'AUTH_MIGRATION_DATABASE_IDENTITY_MISMATCH'; END IF;
      PERFORM pg_advisory_xact_lock(hashtextextended(${p} || ${o} || ${subject},0));
      SELECT * INTO m FROM users WHERE id=${merchant}::uuid FOR UPDATE;
      SELECT * INTO a FROM operator_users WHERE id=${operator}::uuid FOR UPDATE;
      IF m.id IS NULL OR a.id IS NULL OR m.login_identifier IS DISTINCT FROM ${literal(original.merchant.login_identifier)}
        OR m.status IS DISTINCT FROM ${literal(original.merchant.status)} OR m.password_hash IS DISTINCT FROM ${literal(original.merchant.password_hash)}
        OR a.email IS DISTINCT FROM ${literal(original.operator.email)} OR a.status IS DISTINCT FROM ${literal(original.operator.status)}
        OR a.role IS DISTINCT FROM ${literal(original.operator.role)} OR a.password_hash IS DISTINCT FROM ${literal(original.operator.password_hash)}
        THEN RAISE EXCEPTION 'AUTH_MIGRATION_ORIGINAL_ACCOUNT_CHANGED'; END IF;
      SELECT count(*) INTO n FROM managed_auth_identity_links WHERE project_id=${p} AND provider_origin=${o}
        AND (provider_user_id=${subject}::uuid OR merchant_user_id=${merchant}::uuid OR operator_user_id=${operator}::uuid);
      IF n <> 0 THEN
        IF n <> 2 OR NOT EXISTS(SELECT 1 FROM managed_auth_identity_links WHERE project_id=${p} AND provider_origin=${o}
          AND surface='merchant' AND provider_user_id=${subject}::uuid AND merchant_user_id=${merchant}::uuid)
          OR NOT EXISTS(SELECT 1 FROM managed_auth_identity_links WHERE project_id=${p} AND provider_origin=${o}
          AND surface='operator' AND provider_user_id=${subject}::uuid AND operator_user_id=${operator}::uuid)
          THEN RAISE EXCEPTION 'AUTH_MIGRATION_IDENTITY_LINK_CONFLICT'; END IF;
      ELSE
        INSERT INTO managed_auth_identity_links(project_id,provider_origin,surface,provider_user_id,merchant_user_id,operator_user_id)
          VALUES(${p},${o},'merchant',${subject}::uuid,${merchant}::uuid,null),(${p},${o},'operator',${subject}::uuid,null,${operator}::uuid);
      END IF;
    END`;
    let tag = "$migration$", suffix = 0;
    while (body.includes(tag)) tag = `$migration${++suffix}$`;
    const sql = `DO ${tag}${body}${tag};`;
    await query(sql);
    const result = await query(`select surface,provider_user_id,merchant_user_id,operator_user_id from managed_auth_identity_links
      where project_id=$1 and provider_origin=$2 and provider_user_id=$3::uuid`, [projectId, plan.providerOrigin, providerUserId]);
    if (result.rows.length !== 2 || !plan.identities.every(i => result.rows.some(r => r.surface === i.surface &&
      (i.surface === "merchant" ? r.merchant_user_id : r.operator_user_id) === i.businessUserId))) {
      throw fail("AUTH_MIGRATION_LINKS_NOT_CONFIRMED");
    }
    return { identityLinkCount: 2 };
  }
  return { ...readOnly, commitIdentityLinks };
}
module.exports = { createMeooMigrationRepository };
