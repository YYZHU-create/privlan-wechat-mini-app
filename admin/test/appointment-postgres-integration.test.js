const test = require("node:test");
const assert = require("node:assert/strict");
const { DateTime } = require("luxon");
const { createPostgresDatabase } = require("../database");
const { createSaasService } = require("../saas-service");
const { createAppointmentService } = require("../appointment-service");

const connectionString = process.env.ATELIER_REAL_POSTGRES_URL || "";

test("real PostgreSQL serializes same-advisor booking while allowing different advisors", { skip: !connectionString }, async () => {
  const db = await createPostgresDatabase(connectionString, { max: 8 });
  let account = null;
  const hashKey = "real-postgres-openid-test-key-32-bytes";
  const previousHashKey = process.env.ATELIER_OPENID_HASH_KEY;
  process.env.ATELIER_OPENID_HASH_KEY = hashKey;
  try {
    const saas = createSaasService({ db, licensePepper: "real-postgres-license-test-key-32-bytes" });
    account = await saas.register({ login: `postgres-appointment-${Date.now()}@example.com`, password: "postgres-test-password", storeName: "PostgreSQL 并发隔离店", template: "blank" });
    await db.query("update subscriptions set status='active',expires_at=now()+interval '1 day' where workspace_id=$1", [account.workspace.id]);
    const scope = { tenantId: account.workspace.tenantId, workspaceId: account.workspace.id, storeId: account.workspace.storeId, userId: account.user.id, subscription: { status: "active" } };
    const service = createAppointmentService({ db, openIdHashKey: hashKey });
    await service.updateSettings(scope, { timezone: "Asia/Shanghai", slotIntervalMinutes: 15, defaultBufferMinutes: 1, maxAdvanceDays: 30, bookingEnabled: true });
    const services = await service.listServices(scope); const advisors = await service.listAdvisors(scope);
    const secondAdvisor = await service.saveAdvisor(scope, { name: "并发顾问 B", enabled: true });
    const start = DateTime.now().setZone("Asia/Shanghai").plus({ days: 2 }).startOf("day").plus({ hours: 10 }).toUTC().toISO();
    const input = (openid, advisorId, idempotencyKey, offsetMinutes = 0) => ({
      publicStoreId: account.workspace.publicStoreId,
      openid,
      customerName: `客户 ${openid.slice(-1)}`,
      customerPhone: `1380013800${openid.slice(-1)}`,
      serviceId: services[0].id,
      advisorId,
      startAt: DateTime.fromISO(start).plus({ minutes: offsetMinutes }).toISO(),
      notes: "",
      idempotencyKey
    });
    const sameAdvisor = await Promise.allSettled([
      service.createAppointment(input("openid-real-1", advisors[0].id, "real-same-1")),
      service.createAppointment(input("openid-real-2", advisors[0].id, "real-same-2"))
    ]);
    assert.equal(sameAdvisor.filter(item => item.status === "fulfilled").length, 1);
    const rejection = sameAdvisor.find(item => item.status === "rejected");
    assert.equal(rejection.reason.code, "APPOINTMENT_CONFLICT");

    const differentAdvisors = await Promise.all([
      service.createAppointment(input("openid-real-3", advisors[0].id, "real-different-1", 120)),
      service.createAppointment(input("openid-real-4", secondAdvisor.id, "real-different-2", 120))
    ]);
    assert.equal(differentAdvisors.length, 2);
    assert.notEqual(differentAdvisors[0].number, differentAdvisors[1].number);

    const firstAppointment = (await db.query("select customer_id from appointments where idempotency_key=$1", ["real-same-1"])).rows[0];
    assert.ok(firstAppointment?.customer_id);
    const touched = await saas.customerService.touchMiniProgramCustomer(scope, { openid: "openid-real-1" });
    assert.equal(touched.id, firstAppointment.customer_id);
    const membership = await saas.customerService.joinMembership(scope, touched.id);
    assert.equal(membership.status, "active");
    assert.equal((await saas.customerService.joinMembership(scope, touched.id)).id, membership.id);
    assert.equal((await saas.customerService.adjustPoints(scope, touched.id, { points: 100, idempotencyKey: "real-points-1", reason: "integration" })).balance, 100);
    assert.equal((await saas.customerService.adjustPoints(scope, touched.id, { points: -50, idempotencyKey: "real-points-2", reason: "integration" })).balance, 50);
    await assert.rejects(() => saas.customerService.adjustPoints(scope, touched.id, { points: -100, idempotencyKey: "real-points-3", reason: "integration" }), error => error.code === "POINTS_INSUFFICIENT");
    assert.equal((await saas.customerService.adjustPoints(scope, touched.id, { points: 100, idempotencyKey: "real-points-2", reason: "integration" })).duplicate, true);
  } finally {
    if (account) {
      const tenantId = account.workspace.tenantId; const workspaceId = account.workspace.id; const userId = account.user.id;
      await db.transaction(async tx => {
        for (const table of ["customer_points_ledger", "customer_points_accounts", "customer_memberships", "membership_levels", "membership_programs", "customer_tag_links", "customer_notes", "customer_events", "appointments", "orders", "appointment_import_runs", "appointment_advisor_services", "appointment_business_hours", "appointment_services", "appointment_advisors", "appointment_settings", "customers"]) await tx.query(`delete from ${table} where workspace_id=$1`, [workspaceId]);
        await tx.query("delete from audit_events where workspace_id=$1", [workspaceId]);
        await tx.query("delete from merchant_sessions where workspace_id=$1", [workspaceId]);
        await tx.query("delete from subscriptions where workspace_id=$1", [workspaceId]);
        await tx.query("delete from workspace_configs where workspace_id=$1", [workspaceId]);
        await tx.query("delete from memberships where workspace_id=$1", [workspaceId]);
        await tx.query("delete from stores where workspace_id=$1", [workspaceId]);
        await tx.query("delete from workspaces where id=$1", [workspaceId]);
        await tx.query("delete from users where id=$1", [userId]);
        await tx.query("delete from tenants where id=$1", [tenantId]);
      });
    }
    if (previousHashKey === undefined) delete process.env.ATELIER_OPENID_HASH_KEY;
    else process.env.ATELIER_OPENID_HASH_KEY = previousHashKey;
    await db.close();
  }
});
