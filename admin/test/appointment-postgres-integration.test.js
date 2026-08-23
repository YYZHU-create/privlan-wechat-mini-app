const test = require("node:test");
const assert = require("node:assert/strict");
const { DateTime } = require("luxon");
const { createPostgresDatabase } = require("../database");
const { createSaasService } = require("../saas-service");
const { createAppointmentService } = require("../appointment-service");

const connectionString = process.env.ATELIER_REAL_POSTGRES_URL || "";

test("real PostgreSQL serializes staff and resource bookings while preserving Sprint 1 behavior", { skip: !connectionString }, async () => {
  const db = await createPostgresDatabase(connectionString, { max: 8 });
  let account = null;
  let foreignAccount = null;
  const hashKey = "real-postgres-openid-test-key-32-bytes";
  const previousHashKey = process.env.ATELIER_OPENID_HASH_KEY;
  process.env.ATELIER_OPENID_HASH_KEY = hashKey;
  try {
    const saas = createSaasService({ db, licensePepper: "real-postgres-license-test-key-32-bytes" });
    account = await saas.register({ login: `postgres-appointment-${Date.now()}@example.com`, password: `test-${require("node:crypto").randomUUID()}`, storeName: "PostgreSQL 并发隔离店", template: "blank" });
    await db.query("update subscriptions set status='active',expires_at=now()+interval '1 day' where workspace_id=$1", [account.workspace.id]);
    const scope = { tenantId: account.workspace.tenantId, workspaceId: account.workspace.id, storeId: account.workspace.storeId, userId: account.user.id, subscription: { status: "active" } };
    const service = createAppointmentService({ db, openIdHashKey: hashKey });
    await service.updateSettings(scope, { timezone: "Asia/Shanghai", slotIntervalMinutes: 15, defaultBufferMinutes: 1, maxAdvanceDays: 30, bookingEnabled: true });
    const services = await service.listServices(scope); const advisors = await service.listAdvisors(scope);
    assert.ok(advisors[0].staffId);
    const secondAdvisor = await service.saveAdvisor(scope, { name: "并发顾问 B", enabled: true });
    assert.ok(secondAdvisor.staffId);
    const resource = await service.saveResource(scope, { name: "真实 PostgreSQL 试衣间", kind: "fitting_room" });
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

    await service.createAppointment({ ...input("openid-resource-1", advisors[0].id, "real-resource-1", 240), staffId: advisors[0].staffId, resourceId: resource.id });
    await assert.rejects(() => service.createAppointment({ ...input("openid-resource-2", secondAdvisor.id, "real-resource-2", 240), staffId: secondAdvisor.staffId, resourceId: resource.id }), error => error.code === "APPOINTMENT_CONFLICT");
    const resourceAvailability = await service.merchantAvailability(scope, { storeId: scope.storeId, serviceId: services[0].id, resourceId: resource.id, date: DateTime.fromISO(start).setZone("Asia/Shanghai").toISODate() });
    assert.equal(resourceAvailability.slots.find(item => item.startAt === DateTime.fromISO(start).plus({ minutes: 240 }).toUTC().toISO()).available, false);

    const firstAppointment = (await db.query("select id,customer_id from appointments where idempotency_key=$1", ["real-same-1"])).rows[0];
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

    const date = DateTime.fromISO(start).setZone("Asia/Shanghai").toISODate();
    const availability = await service.merchantAvailability(scope, { storeId: scope.storeId, serviceId: services[0].id, advisorId: advisors[0].id, date });
    const occupiedSlot = availability.slots.find(item => item.startAt === start);
    assert.ok(occupiedSlot);
    assert.equal(occupiedSlot.available, false);

    const timelineBefore = await service.timeline(scope, firstAppointment.id);
    assert.ok(timelineBefore.some(item => item.resourceId === firstAppointment.id));
    const followUp = await service.createFollowUp(scope, firstAppointment.id, { note: "真实 PostgreSQL 跟进验证", idempotencyKey: "real-follow-up-1" });
    assert.equal(followUp.duplicate, false);
    assert.equal((await service.createFollowUp(scope, firstAppointment.id, { note: "真实 PostgreSQL 跟进验证", idempotencyKey: "real-follow-up-1" })).duplicate, true);
    const timelineAfter = await service.timeline(scope, firstAppointment.id);
    assert.equal(timelineAfter.filter(item => item.type === "follow_up_created").length, 1);
    const customer360 = await saas.customerService.get360(scope, touched.id);
    assert.equal(customer360.customer.id, touched.id);
    assert.equal(customer360.summary.appointmentCount >= 1, true);
    assert.equal(customer360.timeline.some(item => item.type === "follow_up_created"), true);

    foreignAccount = await saas.register({ login: `postgres-foreign-${Date.now()}@example.com`, password: `test-${require("node:crypto").randomUUID()}`, storeName: "PostgreSQL 隔离店", template: "blank" });
    await db.query("update subscriptions set status='active',expires_at=now()+interval '1 day' where workspace_id=$1", [foreignAccount.workspace.id]);
    const foreignScope = { tenantId: foreignAccount.workspace.tenantId, workspaceId: foreignAccount.workspace.id, storeId: foreignAccount.workspace.storeId, userId: foreignAccount.user.id, subscription: { status: "active" } };
    await assert.rejects(() => service.getAppointment(foreignScope, firstAppointment.id), error => error.code === "APPOINTMENT_NOT_FOUND");
    await assert.rejects(() => service.timeline(foreignScope, firstAppointment.id), error => error.code === "APPOINTMENT_NOT_FOUND");
    await assert.rejects(() => service.createFollowUp(foreignScope, firstAppointment.id, { note: "越权", idempotencyKey: "foreign-follow-up" }), error => error.code === "APPOINTMENT_NOT_FOUND");
    await assert.rejects(() => service.merchantAvailability(foreignScope, { storeId: scope.storeId, date }), error => error.code === "APPOINTMENT_SCOPE_INVALID");
  } finally {
    for (const cleanupAccount of [foreignAccount, account].filter(Boolean)) {
      const tenantId = cleanupAccount.workspace.tenantId; const workspaceId = cleanupAccount.workspace.id; const userId = cleanupAccount.user.id;
      await db.transaction(async tx => {
        for (const table of ["customer_points_ledger", "customer_points_accounts", "customer_memberships", "membership_levels", "membership_programs", "customer_tag_links", "customer_notes", "customer_events", "appointments", "orders", "appointment_import_runs", "appointment_advisor_services", "appointment_business_hours", "staff_leaves", "staff_schedules", "resource_store_assignments", "staff_store_assignments", "appointment_services", "appointment_advisors", "resources", "staff_members", "appointment_settings", "customers"]) await tx.query(`delete from ${table} where workspace_id=$1`, [workspaceId]);
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
