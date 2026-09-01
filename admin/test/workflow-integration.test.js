const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { createPortableTestDatabase } = require("../database");
const { createSaasService } = require("../saas-service");
const { createDomainEventMetadata } = require("../domain-event");

process.env.NODE_ENV = "test";

async function fixture({ useDefaultMappings = true } = {}) {
  const db = await createPortableTestDatabase();
  const options = { db, licensePepper: "workflow-integration-license-pepper" };
  if (!useDefaultMappings) options.workflowMappings = { "appointment.completed": { workflowKey: "appointment-completion", consumerKey: "runtime" } };
  const saas = createSaasService(options);
  const registration = await saas.register({ login: `${crypto.randomUUID()}@example.test`, password: "workflow-pass-1", storeName: "Integration Store", template: "blank" });
  await db.query("update subscriptions set status='active',expires_at=$1 where workspace_id=$2", [new Date("2031-01-01T00:00:00Z"), registration.workspace.id]);
  const scope = { tenantId: registration.workspace.tenantId, workspaceId: registration.workspace.id, storeId: registration.workspace.storeId, userId: registration.user.id, subscription: { status: "active" } };
  const definition = await saas.workflowService.registerDefinition(scope, {
    workflowKey: "appointment-completion",
    name: "Appointment completion",
    definition: { tasks: [{ key: "follow-up", type: "manual", title: "Follow up" }] }
  });
  const customerId = crypto.randomUUID();
  await db.query("insert into customers(id,tenant_id,workspace_id,store_id,source,name,phone) values($1,$2,$3,$4,'appointment',$5,$6)", [customerId, scope.tenantId, scope.workspaceId, scope.storeId, "Integration customer", "13800138000"]);
  const service = (await db.query("select id from appointment_services where tenant_id=$1 and workspace_id=$2 and store_id=$3 order by sort_order,id limit 1", [scope.tenantId, scope.workspaceId, scope.storeId])).rows[0];
  const advisor = (await db.query("select id from appointment_advisors where tenant_id=$1 and workspace_id=$2 and store_id=$3 order by sort_order,id limit 1", [scope.tenantId, scope.workspaceId, scope.storeId])).rows[0];
  const appointmentId = crypto.randomUUID();
  const startAt = new Date("2030-01-02T09:00:00Z");
  const endAt = new Date("2030-01-02T10:00:00Z");
  await db.query(`insert into appointments(id,tenant_id,workspace_id,store_id,customer_id,service_id,advisor_id,appointment_number,status,start_at,service_end_at,occupied_until,duration_minutes_snapshot,buffer_minutes_snapshot,timezone_snapshot,customer_name_snapshot,customer_phone_snapshot,service_name_snapshot,advisor_name_snapshot,source,idempotency_key)
    values($1,$2,$3,$4,$5,$6,$7,$8,'completed',$9,$10,$10,60,0,'Asia/Shanghai','Integration customer','13800138000','Integration service','Integration advisor','merchant_manual',$11)`, [appointmentId, scope.tenantId, scope.workspaceId, scope.storeId, customerId, service.id, advisor.id, `AT${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`, startAt, endAt, `fixture:${appointmentId}`]);
  return { db, saas, scope, definition, customerId, appointmentId };
}

async function insertAppointmentEvent(base, overrides = {}) {
  const eventId = overrides.eventId || crypto.randomUUID();
  const metadata = overrides.metadata || createDomainEventMetadata({
    eventType: "appointment.completed",
    aggregateType: "appointment",
    aggregateId: overrides.appointmentId || base.appointmentId,
    references: { appointmentId: overrides.appointmentId || base.appointmentId, customerId: base.customerId, storeId: base.scope.storeId },
    data: { fromStatus: "confirmed", toStatus: "completed" },
    idempotencyKey: `appointment.completed:${eventId}`,
    actorType: "merchant",
    actorId: base.scope.userId
  });
  await base.db.query(`insert into customer_events(id,tenant_id,workspace_id,store_id,customer_id,event_type,source,resource_type,resource_id,metadata)
    values($1,$2,$3,$4,$5,'appointment_completed','merchant','appointment',$6,$7::jsonb)`, [eventId, base.scope.tenantId, base.scope.workspaceId, base.scope.storeId, base.customerId, overrides.appointmentId || base.appointmentId, JSON.stringify(metadata)]);
  return eventId;
}

async function createSiblingWorkspaceAppointment(base) {
  const workspaceId = crypto.randomUUID();
  const storeId = crypto.randomUUID();
  const customerId = crypto.randomUUID();
  const appointmentId = crypto.randomUUID();
  await base.db.transaction(async tx => {
    await tx.query("insert into workspaces(id,tenant_id,name,plan_id) values($1,$2,$3,'TRIAL')", [workspaceId, base.scope.tenantId, "Sibling workspace"]);
    await tx.query("insert into stores(id,tenant_id,workspace_id,name,channel_mode,status,public_store_id) values($1,$2,$3,$4,'shared','draft',$5)", [storeId, base.scope.tenantId, workspaceId, "Sibling store", `store_public_${crypto.randomBytes(16).toString("hex")}`]);
    await base.saas.appointmentService.ensureDefaults(tx, { tenantId: base.scope.tenantId, workspaceId, storeId });
    const service = (await tx.query("select id from appointment_services where tenant_id=$1 and workspace_id=$2 and store_id=$3 order by sort_order,id limit 1", [base.scope.tenantId, workspaceId, storeId])).rows[0];
    const advisor = (await tx.query("select id from appointment_advisors where tenant_id=$1 and workspace_id=$2 and store_id=$3 order by sort_order,id limit 1", [base.scope.tenantId, workspaceId, storeId])).rows[0];
    await tx.query("insert into customers(id,tenant_id,workspace_id,store_id,source,name,phone) values($1,$2,$3,$4,'appointment',$5,$6)", [customerId, base.scope.tenantId, workspaceId, storeId, "Sibling customer", "13800138001"]);
    await tx.query(`insert into appointments(id,tenant_id,workspace_id,store_id,customer_id,service_id,advisor_id,appointment_number,status,start_at,service_end_at,occupied_until,duration_minutes_snapshot,buffer_minutes_snapshot,timezone_snapshot,customer_name_snapshot,customer_phone_snapshot,service_name_snapshot,advisor_name_snapshot,source,idempotency_key)
      values($1,$2,$3,$4,$5,$6,$7,$8,'completed',$9,$10,$10,60,0,'Asia/Shanghai','Sibling customer','13800138001','Sibling service','Sibling advisor','merchant_manual',$11)`, [appointmentId, base.scope.tenantId, workspaceId, storeId, customerId, service.id, advisor.id, `AT${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`, new Date("2030-01-03T09:00:00Z"), new Date("2030-01-03T10:00:00Z"), `sibling:${appointmentId}`]);
  });
  return { workspaceId, storeId, customerId, appointmentId };
}

test("default production mapping consumes appointment domain facts through the event boundary", async () => {
  const base = await fixture();
  try {
    const eventId = await insertAppointmentEvent(base);
    const first = await base.saas.workflowIntegrationService.consumeEvent(base.scope, eventId);
    assert.equal(first.status, "succeeded");
    const second = await base.saas.workflowIntegrationService.consumeEvent(base.scope, eventId);
    assert.equal(second.status, "succeeded");
    assert.equal(second.workflowInstanceId, first.workflowInstanceId);
    assert.equal((await base.db.query("select count(*)::int count from workflow_instances where tenant_id=$1 and workspace_id=$2", [base.scope.tenantId, base.scope.workspaceId])).rows[0].count, 1);
    assert.equal((await base.db.query("select count(*)::int count from workflow_event_consumptions where tenant_id=$1 and workspace_id=$2 and event_id=$3 and consumer_key='runtime'", [base.scope.tenantId, base.scope.workspaceId, eventId])).rows[0].count, 1);
    const audit = (await base.db.query("select action from audit_events where tenant_id=$1 and workspace_id=$2 and resource_id=$3 order by created_at", [base.scope.tenantId, base.scope.workspaceId, eventId])).rows;
    assert.deepEqual(audit.map(row => row.action), ["workflow.integration.consumed"]);
    assert.equal(fs.readFileSync(path.resolve(__dirname, "../appointment-service.js"), "utf8").includes("workflow-service"), false);
  } finally { await base.db.close(); }
});

test("consumer uniqueness supports future consumers and concurrent duplicate delivery", async () => {
  const base = await fixture();
  try {
    base.saas.workflowIntegrationService.registerMapping("appointment.completed", { workflowKey: "appointment-completion", consumerKey: "audit-projection" });
    const eventId = await insertAppointmentEvent(base);
    const results = await Promise.all(Array.from({ length: 10 }, () => base.saas.workflowIntegrationService.consumeEvent(base.scope, eventId)));
    const consumers = results.flatMap(result => result.consumers || [result]);
    assert.equal(consumers.filter(item => item.consumerKey === "runtime" && item.status === "succeeded").length, 10);
    assert.equal(consumers.filter(item => item.consumerKey === "audit-projection" && item.status === "succeeded").length, 10);
    assert.equal(new Set(consumers.filter(item => item.consumerKey === "runtime").map(item => item.workflowInstanceId)).size, 1);
    assert.equal(new Set(consumers.filter(item => item.consumerKey === "audit-projection").map(item => item.workflowInstanceId)).size, 1);
    assert.equal((await base.db.query("select count(*)::int count from workflow_event_consumptions where tenant_id=$1 and workspace_id=$2 and event_id=$3", [base.scope.tenantId, base.scope.workspaceId, eventId])).rows[0].count, 2);
    assert.equal((await base.db.query("select count(*)::int count from workflow_instances where tenant_id=$1 and workspace_id=$2", [base.scope.tenantId, base.scope.workspaceId])).rows[0].count, 2);
    assert.equal((await base.db.query("select count(*)::int count from workflow_tasks where tenant_id=$1 and workspace_id=$2", [base.scope.tenantId, base.scope.workspaceId])).rows[0].count, 2);
  } finally { await base.db.close(); }
});

test("appointment integration rejects nonexistent and cross-scope aggregate references with terminal audit evidence", async () => {
  const base = await fixture();
  const foreign = await fixture();
  try {
    const sibling = await createSiblingWorkspaceAppointment(base);
    const cases = [
      { name: "nonexistent", appointmentId: crypto.randomUUID() },
      { name: "cross-tenant", appointmentId: foreign.appointmentId },
      { name: "cross-workspace", appointmentId: sibling.appointmentId }
    ];
    for (const item of cases) {
      const eventId = await insertAppointmentEvent(base, { appointmentId: item.appointmentId });
      const result = await base.saas.workflowIntegrationService.consumeEvent(base.scope, eventId);
      assert.equal(result.status, "failed", item.name);
      assert.equal(result.error, "AGGREGATE_REFERENCE_INVALID", item.name);
      assert.equal((await base.db.query("select count(*)::int count from workflow_instances where tenant_id=$1 and workspace_id=$2", [base.scope.tenantId, base.scope.workspaceId])).rows[0].count, 0, item.name);
      assert.equal((await base.db.query("select count(*)::int count from workflow_tasks where tenant_id=$1 and workspace_id=$2", [base.scope.tenantId, base.scope.workspaceId])).rows[0].count, 0, item.name);
      const delivery = (await base.db.query("select status,result from workflow_event_consumptions where tenant_id=$1 and workspace_id=$2 and event_id=$3", [base.scope.tenantId, base.scope.workspaceId, eventId])).rows[0];
      assert.equal(delivery.status, "failed", item.name);
      assert.equal(delivery.result.code, "AGGREGATE_REFERENCE_INVALID", item.name);
      assert.equal((await base.db.query("select count(*)::int count from audit_events where tenant_id=$1 and workspace_id=$2 and action='workflow.integration.failed' and resource_id=$3", [base.scope.tenantId, base.scope.workspaceId, eventId])).rows[0].count, 1, item.name);
    }
  } finally { await base.db.close(); await foreign.db.close(); }
});

test("customer event integration contract fields are immutable while unrelated metadata remains mutable", async () => {
  const base = await fixture();
  try {
    const eventId = await insertAppointmentEvent(base);
    await assert.rejects(() => base.db.query("update customer_events set id=$1 where id=$2", [crypto.randomUUID(), eventId]), /WORKFLOW_EVENT_CONTRACT_IMMUTABLE/);
    await assert.rejects(() => base.db.query("update customer_events set metadata=jsonb_set(metadata,'{integration,eventType}','\"appointment.cancelled\"'::jsonb) where id=$1", [eventId]), /WORKFLOW_EVENT_CONTRACT_IMMUTABLE/);
    await assert.rejects(() => base.db.query("update customer_events set metadata=jsonb_set(metadata,'{integration,aggregate,id}','\"00000000-0000-0000-0000-000000000000\"'::jsonb) where id=$1", [eventId]), /WORKFLOW_EVENT_CONTRACT_IMMUTABLE/);
    await assert.rejects(() => base.db.query("update customer_events set metadata=jsonb_set(metadata,'{integration,idempotencyKey}','\"changed\"'::jsonb) where id=$1", [eventId]), /WORKFLOW_EVENT_CONTRACT_IMMUTABLE/);
    await base.db.query("update customer_events set metadata=metadata || $1::jsonb where id=$2", [JSON.stringify({ reviewNote: "mutable" }), eventId]);
    assert.equal((await base.db.query("select metadata->>'reviewNote' note from customer_events where id=$1", [eventId])).rows[0].note, "mutable");
    const plainEventId = crypto.randomUUID();
    await base.db.query("insert into customer_events(id,tenant_id,workspace_id,store_id,customer_id,event_type,source,resource_type,resource_id,metadata) values($1,$2,$3,$4,$5,'profile_updated','merchant','customer',$6,'{}'::jsonb)", [plainEventId, base.scope.tenantId, base.scope.workspaceId, base.scope.storeId, base.customerId, plainEventId]);
    await base.db.query("update customer_events set metadata=$1::jsonb where id=$2", [JSON.stringify({ reviewNote: "plain-event-mutable" }), plainEventId]);
    assert.equal((await base.db.query("select metadata->>'reviewNote' note from customer_events where id=$1", [plainEventId])).rows[0].note, "plain-event-mutable");
  } finally { await base.db.close(); }
});

test("unsupported event schema versions are rejected before runtime effects", async () => {
  const base = await fixture();
  try {
    const eventId = await insertAppointmentEvent(base, { metadata: { integration: { eventType: "appointment.completed", schemaVersion: 2, aggregate: { type: "appointment", id: crypto.randomUUID() }, idempotencyKey: "breaking-version" } } });
    await assert.rejects(() => base.saas.workflowIntegrationService.consumeEvent(base.scope, eventId), error => error.code === "EVENT_SCHEMA_UNSUPPORTED");
    assert.equal((await base.db.query("select count(*)::int count from workflow_instances where tenant_id=$1 and workspace_id=$2", [base.scope.tenantId, base.scope.workspaceId])).rows[0].count, 0);
  } finally { await base.db.close(); }
});

test("event consumption enforces tenant and workspace scope", async () => {
  const base = await fixture();
  const foreign = await fixture();
  try {
    const eventId = await insertAppointmentEvent(base);
    await assert.rejects(() => foreign.saas.workflowIntegrationService.consumeEvent(foreign.scope, eventId), error => error.code === "DOMAIN_EVENT_NOT_FOUND");
  } finally { await base.db.close(); await foreign.db.close(); }
});
