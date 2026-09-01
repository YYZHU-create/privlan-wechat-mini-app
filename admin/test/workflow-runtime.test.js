const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const http = require("node:http");
const express = require("express");
const { createPortableTestDatabase } = require("../database");
const { createSaasService } = require("../saas-service");
const { registerWorkflowRoutes } = require("../workflow-routes");

process.env.NODE_ENV = "test";

async function fixture(name = "Workflow 店") {
  const db = await createPortableTestDatabase();
  const saas = createSaasService({ db, licensePepper: "workflow-runtime-license-pepper" });
  const registration = await saas.register({ login: `${crypto.randomUUID()}@example.test`, password: "workflow-pass-1", storeName: name, template: "blank" });
  await db.query("update subscriptions set status='active',expires_at=$1 where workspace_id=$2", [new Date("2031-01-01T00:00:00Z"), registration.workspace.id]);
  const scope = { tenantId: registration.workspace.tenantId, workspaceId: registration.workspace.id, storeId: registration.workspace.storeId, userId: registration.user.id, subscription: { status: "active" } };
  const definition = await saas.workflowService.registerDefinition(scope, {
    workflowKey: "customer-onboarding",
    name: "Customer onboarding",
    definition: { tasks: [{ key: "collect", type: "manual", title: "Collect details" }, { key: "review", type: "approval", title: "Review details" }] }
  }, { requestId: "workflow-definition-test" });
  return { db, saas, workflow: saas.workflowService, scope, definition };
}

test("Workflow Runtime starts, advances tasks in definition order, completes and audits", async () => {
  const base = await fixture();
  try {
    const started = await base.workflow.startInstance(base.scope, { workflowKey: "customer-onboarding", context: { source: "test" }, idempotencyKey: "lifecycle-1" }, { requestId: "workflow-start-test" });
    assert.equal(started.created, true);
    assert.equal(started.instance.status, "running");
    assert.deepEqual(started.instance.tasks.map(task => task.taskKey), ["collect"]);
    assert.deepEqual(started.instance.events.map(event => event.eventType), ["instance.started", "task.ready"]);

    const advanced = await base.workflow.completeTask(base.scope, started.instance.id, "collect", { output: { ok: true } }, { requestId: "workflow-complete-1" });
    assert.equal(advanced.status, "running");
    assert.equal(advanced.tasks.find(task => task.taskKey === "collect").status, "completed");
    assert.equal(advanced.tasks.find(task => task.taskKey === "review").status, "pending");

    const completed = await base.workflow.completeTask(base.scope, started.instance.id, "review", { output: { approved: true } }, { requestId: "workflow-complete-2" });
    assert.equal(completed.status, "completed");
    assert.ok(completed.completedAt);
    assert.deepEqual(completed.events.map(event => event.eventType), ["instance.started", "task.ready", "task.completed", "task.ready", "task.completed", "instance.completed"]);
    const audit = (await base.db.query("select action,resource_type,resource_id,tenant_id,workspace_id from audit_events where resource_id=$1 order by created_at", [started.instance.id])).rows;
    assert.deepEqual(audit.map(row => row.action), ["workflow.instance.started", "workflow.task.ready", "workflow.task.completed", "workflow.task.ready", "workflow.task.completed", "workflow.instance.completed"]);
    assert.ok(audit.every(row => row.resource_type === "workflow_instance" && row.tenant_id === base.scope.tenantId && row.workspace_id === base.scope.workspaceId));
  } finally { await base.db.close(); }
});

test("Workflow Runtime is idempotent, rejects duplicate definitions, and isolates scopes", async () => {
  const base = await fixture("Workflow A");
  const foreign = await fixture("Workflow B");
  try {
    await assert.rejects(() => base.workflow.registerDefinition(base.scope, { workflowKey: "customer-onboarding", name: "Duplicate", definition: { tasks: [{ key: "x" }] } }), error => error.code === "WORKFLOW_DEFINITION_EXISTS");
    const first = await base.workflow.startInstance(base.scope, { workflowKey: "customer-onboarding", idempotencyKey: "same-key" });
    const second = await base.workflow.startInstance(base.scope, { workflowKey: "customer-onboarding", idempotencyKey: "same-key" });
    assert.equal(second.created, false);
    assert.equal(second.instance.id, first.instance.id);
    await assert.rejects(() => foreign.workflow.getInstance(foreign.scope, first.instance.id), error => error.code === "WORKFLOW_INSTANCE_NOT_FOUND");
    await assert.rejects(() => base.workflow.completeTask({ ...base.scope, workspaceId: foreign.scope.workspaceId }, first.instance.id, "collect"), error => error.code === "WORKFLOW_INSTANCE_NOT_FOUND");
  } finally { await base.db.close(); await foreign.db.close(); }
});

test("Workflow Runtime enforces published version immutability and tenant workspace integrity", async () => {
  const base = await fixture("Workflow integrity");
  try {
    await assert.rejects(
      () => base.db.query("update workflow_versions set definition_json=$1::jsonb where id=$2", [JSON.stringify({ tasks: [] }), base.definition.versionId]),
      error => /WORKFLOW_PUBLISHED_VERSION_IMMUTABLE/.test(String(error.message))
    );
    await assert.rejects(
      () => base.db.query("delete from workflow_versions where id=$1", [base.definition.versionId]),
      error => /WORKFLOW_PUBLISHED_VERSION_IMMUTABLE/.test(String(error.message))
    );
    const foreign = await base.saas.register({ login: `${crypto.randomUUID()}@example.test`, password: "workflow-pass-1", storeName: "Foreign workspace", template: "blank" });
    await assert.rejects(
      () => base.db.query(`insert into workflow_definitions(id,tenant_id,workspace_id,workflow_key,name,created_by)
        values($1,$2,$3,$4,$5,$6)`, [crypto.randomUUID(), base.scope.tenantId, foreign.workspace.id, "invalid-scope", "Invalid scope", base.scope.userId]),
      error => /foreign key|violates/i.test(String(error.message))
    );
    const alternateDefinitionId = crypto.randomUUID();
    const alternateVersionId = crypto.randomUUID();
    await base.db.query(`insert into workflow_definitions(id,tenant_id,workspace_id,workflow_key,name,created_by)
      values($1,$2,$3,$4,$5,$6)`, [alternateDefinitionId, base.scope.tenantId, base.scope.workspaceId, "alternate", "Alternate", base.scope.userId]);
    await base.db.query(`insert into workflow_versions(id,definition_id,tenant_id,workspace_id,version,definition_json,created_by)
      values($1,$2,$3, $4,1,$5::jsonb,$6)`, [alternateVersionId, alternateDefinitionId, base.scope.tenantId, base.scope.workspaceId, JSON.stringify({ tasks: [{ key: "alternate" }] }), base.scope.userId]);
    await assert.rejects(
      () => base.db.query(`insert into workflow_instances(id,definition_id,version_id,tenant_id,workspace_id,status,context,started_by)
        values($1,$2,$3,$4,$5,'running','{}'::jsonb,$6)`, [crypto.randomUUID(), base.definition.definitionId, alternateVersionId, base.scope.tenantId, base.scope.workspaceId, base.scope.userId]),
      error => /foreign key|violates/i.test(String(error.message))
    );
  } finally { await base.db.close(); }
});

test("Workflow Runtime converges concurrent idempotency requests and allocates event sequences atomically", async () => {
  const base = await fixture("Workflow concurrency");
  try {
    const starts = await Promise.all(Array.from({ length: 12 }, () => base.workflow.startInstance(base.scope, { workflowKey: "customer-onboarding", idempotencyKey: "concurrent-start" })));
    const instanceIds = new Set(starts.map(result => result.instance.id));
    assert.equal(instanceIds.size, 1);
    assert.equal((await base.db.query("select count(*)::int count from workflow_instances where tenant_id=$1 and workspace_id=$2 and idempotency_key=$3", [base.scope.tenantId, base.scope.workspaceId, "concurrent-start"])).rows[0].count, 1);

    const instanceId = starts[0].instance.id;
    const appended = await Promise.all(Array.from({ length: 16 }, () => base.db.transaction(async tx => {
      const sequence = (await tx.query(`update workflow_instances
      set next_event_sequence=next_event_sequence+1
      where id=$1 and tenant_id=$2 and workspace_id=$3
      returning next_event_sequence-1 sequence`, [instanceId, base.scope.tenantId, base.scope.workspaceId])).rows[0].sequence;
      await tx.query(`insert into workflow_events(id,instance_id,task_id,tenant_id,workspace_id,sequence,event_type,actor_id,payload)
        values($1,$2,null,$3,$4,$5,'test.concurrent_append',$6,'{}'::jsonb)`, [crypto.randomUUID(), instanceId, base.scope.tenantId, base.scope.workspaceId, sequence, base.scope.userId]);
      return Number(sequence);
    })));
    const allocated = appended.sort((a, b) => a - b);
    assert.deepEqual(allocated, Array.from({ length: 16 }, (_, index) => index + 3));
    assert.equal((await base.db.query("select count(*)::int count from workflow_events where instance_id=$1 and event_type='test.concurrent_append'", [instanceId])).rows[0].count, 16);
  } finally { await base.db.close(); }
});

test("Workflow Runtime cancels only running instances and records cancellation", async () => {
  const base = await fixture();
  try {
    const started = await base.workflow.startInstance(base.scope, { workflowKey: "customer-onboarding", idempotencyKey: "cancel-1" });
    const cancelled = await base.workflow.cancelInstance(base.scope, started.instance.id, { requestId: "workflow-cancel-test" });
    assert.equal(cancelled.status, "cancelled");
    assert.equal(cancelled.tasks.every(task => task.status === "cancelled"), true);
    assert.equal(cancelled.events.at(-1).eventType, "instance.cancelled");
    await assert.rejects(() => base.workflow.cancelInstance(base.scope, started.instance.id), error => error.code === "WORKFLOW_INSTANCE_NOT_RUNNING");
  } finally { await base.db.close(); }
});

test("Workflow definitions are listable and can be archived within the authenticated scope", async () => {
  const base = await fixture("Workflow controls");
  try {
    const listed = await base.workflow.listDefinitions(base.scope);
    assert.equal(listed.length, 1);
    assert.equal(listed[0].workflowKey, "customer-onboarding");
    assert.equal(listed[0].latestVersion, 1);
    assert.equal(listed[0].taskCount, 2);
    const archived = await base.workflow.setDefinitionStatus(base.scope, "customer-onboarding", "archived", { requestId: "workflow-archive-test" });
    assert.equal(archived.status, "archived");
    await assert.rejects(() => base.workflow.startInstance(base.scope, { workflowKey: "customer-onboarding", idempotencyKey: "archived-start" }), error => error.code === "WORKFLOW_DEFINITION_NOT_FOUND");
    const restored = await base.workflow.setDefinitionStatus(base.scope, "customer-onboarding", "active", { requestId: "workflow-restore-test" });
    assert.equal(restored.status, "active");
    const audit = (await base.db.query("select action from audit_events where resource_id=$1 order by created_at", [base.definition.definitionId])).rows.map(row => row.action);
    assert.ok(audit.includes("workflow.definition.archived"));
    assert.ok(audit.includes("workflow.definition.active"));
  } finally { await base.db.close(); }
});
test("Workflow definition control routes expose scoped list and status mutation", async () => {
  const base = await fixture("Workflow control routes");
  const app = express(); app.use(express.json());
  app.use((req, res, next) => { req.saasService = base.saas; req.merchantScope = base.scope; req.requestId = "workflow-control-http"; next(); });
  registerWorkflowRoutes(app);
  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  try {
    const list = await fetch(`http://127.0.0.1:${address.port}/v1/workflow-definitions`);
    assert.equal(list.status, 200);
    assert.equal((await list.json()).data[0].workflowKey, "customer-onboarding");
    const patch = await fetch(`http://127.0.0.1:${address.port}/v1/workflow-definitions/customer-onboarding`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ status: "archived" }) });
    assert.equal(patch.status, 200);
    assert.equal((await patch.json()).data.status, "archived");
  } finally { await new Promise(resolve => server.close(resolve)); await base.db.close(); }
});
test("Workflow Runtime routes execute through the authenticated merchant scope", async () => {
  const base = await fixture();
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => { req.saasService = base.saas; req.merchantScope = base.scope; req.requestId = "workflow-http-test"; next(); });
  registerWorkflowRoutes(app);
  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  try {
    const response = await fetch(`http://127.0.0.1:${address.port}/v1/workflow-instances`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ workflowKey: "customer-onboarding", idempotencyKey: "http-1" }) });
    const payload = await response.json();
    assert.equal(response.status, 201);
    assert.equal(payload.ok, true);
    assert.equal(payload.data.status, "running");
    const read = await fetch(`http://127.0.0.1:${address.port}/v1/workflow-instances/${payload.data.id}`);
    assert.equal(read.status, 200);
    assert.equal((await read.json()).data.id, payload.data.id);
    const concurrent = await Promise.all(Array.from({ length: 12 }, () => fetch(`http://127.0.0.1:${address.port}/v1/workflow-instances`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ workflowKey: "customer-onboarding", idempotencyKey: "http-concurrent" }) })));
    const concurrentPayloads = await Promise.all(concurrent.map(response => response.json()));
    assert.ok(concurrent.every(response => response.status === 200 || response.status === 201));
    assert.equal(new Set(concurrentPayloads.map(item => item.data.id)).size, 1);
  } finally { await new Promise(resolve => server.close(resolve)); await base.db.close(); }
});
