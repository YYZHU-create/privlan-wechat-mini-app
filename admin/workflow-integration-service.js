const crypto = require("node:crypto");
const { EVENT_SCHEMA_VERSIONS } = require("./domain-event");

const LEGACY_EVENT_TYPES = Object.freeze({
  appointment_created: "appointment.created",
  appointment_confirmed: "appointment.confirmed",
  appointment_completed: "appointment.completed",
  appointment_cancelled: "appointment.cancelled",
  appointment_no_show: "appointment.no_show",
  follow_up_created: "customer.follow_up.created"
});

class WorkflowIntegrationError extends Error {
  constructor(status, code, message, { retryable = false } = {}) { super(message); this.status = status; this.code = code; this.retryable = retryable; }
}

function uuid() { return crypto.randomUUID(); }
function json(value) { return JSON.stringify(value ?? {}); }
function wait(milliseconds) { return new Promise(resolve => setTimeout(resolve, milliseconds)); }

function createWorkflowIntegrationService({ db, workflowService, audit, mappings = {}, autoStart = false, pollIntervalMs = 25, deliveryWaitMs = 30000 }) {
  if (!db) throw new Error("database is required");
  if (!workflowService) throw new Error("workflow service is required");
  if (typeof audit !== "function") throw new Error("audit writer is required");

  const mappingRegistry = new Map();
  for (const [eventType, mapping] of Object.entries(mappings || {})) registerMapping(eventType, mapping);

  function scopeOf(scope = {}) {
    if (!scope.tenantId || !scope.workspaceId) throw new WorkflowIntegrationError(401, "AUTH_REQUIRED", "缺少租户或工作区范围");
    return { tenantId: scope.tenantId, workspaceId: scope.workspaceId, userId: scope.userId || "system", requestId: scope.requestId };
  }

  function registerMapping(eventType, mapping = {}) {
    const key = String(eventType || "").trim();
    const workflowKey = String(mapping.workflowKey || "").trim();
    if (!key || !workflowKey) throw new WorkflowIntegrationError(400, "WORKFLOW_MAPPING_INVALID", "Workflow 集成映射无效");
    const consumerKey = String(mapping.consumerKey || `workflow-runtime:${key}`).trim();
    const entries = mappingRegistry.get(key) || new Map();
    entries.set(consumerKey, { workflowKey, consumerKey });
    mappingRegistry.set(key, entries);
    return entries.get(consumerKey);
  }

  function mappingsFor(eventType) {
    const entries = mappingRegistry.get(eventType) || mappingRegistry.get("*") || new Map();
    return Array.from(entries.values());
  }

  function normalizeEvent(row) {
    const metadata = row.metadata && typeof row.metadata === "object" ? row.metadata : {};
    const integration = metadata.integration && typeof metadata.integration === "object" ? metadata.integration : {};
    const eventType = String(integration.eventType || LEGACY_EVENT_TYPES[row.event_type] || "");
    const schemaVersion = Number(integration.schemaVersion || 1);
    if (!eventType || !EVENT_SCHEMA_VERSIONS[eventType] || EVENT_SCHEMA_VERSIONS[eventType] !== schemaVersion) {
      throw new WorkflowIntegrationError(422, "EVENT_SCHEMA_UNSUPPORTED", "领域事件 schemaVersion 不受支持");
    }
    const aggregate = integration.aggregate || { type: row.resource_type === "appointment_follow_up" ? "customer" : "appointment", id: row.resource_id };
    if (!aggregate.type || !aggregate.id) throw new WorkflowIntegrationError(422, "EVENT_AGGREGATE_INVALID", "领域事件聚合引用无效");
    return {
      eventId: row.id,
      eventType,
      schemaVersion,
      occurredAt: row.occurred_at || row.created_at,
      tenantId: row.tenant_id,
      workspaceId: row.workspace_id,
      storeId: row.store_id,
      customerId: row.customer_id,
      actor: integration.actor || { type: row.source || "system", id: row.source || "system" },
      aggregate: { type: String(aggregate.type), id: String(aggregate.id) },
      references: integration.references || {},
      data: integration.data || {},
      idempotencyKey: String(integration.idempotencyKey || `${eventType}:${row.id}`)
    };
  }

  async function loadEvent(scope, eventId, client = db) {
    const row = (await client.query(`select id,tenant_id,workspace_id,store_id,customer_id,event_type,source,resource_type,resource_id,metadata,occurred_at,created_at
      from customer_events where id=$1 and tenant_id=$2 and workspace_id=$3`, [eventId, scope.tenantId, scope.workspaceId])).rows[0];
    if (!row) throw new WorkflowIntegrationError(404, "DOMAIN_EVENT_NOT_FOUND", "领域事件不存在");
    return row;
  }

  async function validateAggregateReference(scope, event) {
    if (event.aggregate.type !== "appointment") return;
    const referenceId = String(event.references?.appointmentId || event.aggregate.id);
    if (referenceId !== event.aggregate.id) {
      throw new WorkflowIntegrationError(422, "AGGREGATE_REFERENCE_INVALID", "预约聚合引用不一致");
    }
    const appointment = (await db.query(`select id,customer_id from appointments
      where id=$1 and tenant_id=$2 and workspace_id=$3 and store_id=$4`, [event.aggregate.id, scope.tenantId, scope.workspaceId, event.storeId])).rows[0];
    if (!appointment || String(appointment.customer_id) !== String(event.customerId)) {
      throw new WorkflowIntegrationError(422, "AGGREGATE_REFERENCE_INVALID", "预约聚合不存在或不属于事件范围");
    }
  }

  async function loadDelivery(scope, eventId, consumerKey, client = db) {
    return (await client.query(`select id,status,attempt_count,updated_at,workflow_instance_id,result,last_error
      from workflow_event_consumptions where tenant_id=$1 and workspace_id=$2 and event_id=$3 and consumer_key=$4`, [scope.tenantId, scope.workspaceId, eventId, consumerKey])).rows[0] || null;
  }

  function resultForDelivery(event, mapping, row) {
    const result = row.result && typeof row.result === "object" ? row.result : {};
    if (row.status === "succeeded") return { status: "succeeded", eventId: event.eventId, consumerKey: mapping.consumerKey, workflowInstanceId: row.workflow_instance_id || result.instanceId || null, created: Boolean(result.created) };
    return { status: "failed", eventId: event.eventId, consumerKey: mapping.consumerKey, error: result.code || row.last_error || "WORKFLOW_INTEGRATION_FAILED" };
  }

  async function claimDelivery(scope, event, mapping) {
    return db.transaction(async tx => {
      const inserted = await tx.query(`insert into workflow_event_consumptions(id,tenant_id,workspace_id,event_id,consumer_key,status,attempt_count)
        values($1,$2,$3,$4,$5,'pending',0)
        on conflict(tenant_id,workspace_id,event_id,consumer_key) do nothing returning id,status,attempt_count,updated_at,workflow_instance_id,result,last_error`, [uuid(), scope.tenantId, scope.workspaceId, event.eventId, mapping.consumerKey]);
      let row = inserted.rows[0];
      if (!row) row = (await tx.query(`select id,status,attempt_count,updated_at,workflow_instance_id,result,last_error
        from workflow_event_consumptions where tenant_id=$1 and workspace_id=$2 and event_id=$3 and consumer_key=$4 for update`, [scope.tenantId, scope.workspaceId, event.eventId, mapping.consumerKey])).rows[0];
      if (!row) throw new WorkflowIntegrationError(409, "EVENT_CONSUMPTION_UNAVAILABLE", "领域事件消费记录不可用", { retryable: true });
      if (row.status === "succeeded") return { row, terminal: true };
      if (row.status === "failed" && !row.result?.retryable) return { row, terminal: true };
      if (row.status === "processing" && row.updated_at && new Date(row.updated_at).getTime() > Date.now() - 5 * 60 * 1000) return { row, inFlight: true };
      row = (await tx.query(`update workflow_event_consumptions set status='processing',attempt_count=attempt_count+1,last_error=null,updated_at=now()
        where id=$1 returning id,status,attempt_count,updated_at,workflow_instance_id,result,last_error`, [row.id])).rows[0];
      return { row, claimed: true };
    });
  }

  async function reconcileRuntimeInstance(scope, event, mapping) {
    const idempotencyKey = `${event.eventId}:${mapping.consumerKey}`;
    const instance = (await db.query(`select id from workflow_instances where tenant_id=$1 and workspace_id=$2 and idempotency_key=$3`, [scope.tenantId, scope.workspaceId, idempotencyKey])).rows[0];
    if (!instance) return null;
    return db.transaction(async tx => {
      const updated = await tx.query(`update workflow_event_consumptions set status='succeeded',workflow_instance_id=$1,result=$2::jsonb,processed_at=coalesce(processed_at,now()),updated_at=now(),last_error=null
        where tenant_id=$3 and workspace_id=$4 and event_id=$5 and consumer_key=$6 and status='processing' returning id`, [instance.id, json({ created: false, instanceId: instance.id, eventId: event.eventId }), scope.tenantId, scope.workspaceId, event.eventId, mapping.consumerKey]);
      if (updated.rows[0]) await audit(tx, { ...scope, actorType: "system", actorId: "workflow-integration" }, "workflow.integration.consumed", "domain_event", event.eventId, { eventType: event.eventType, consumerKey: mapping.consumerKey, workflowInstanceId: instance.id, reconciled: true });
      return loadDelivery(scope, event.eventId, mapping.consumerKey, tx);
    });
  }

  async function waitForTerminalDelivery(scope, event, mapping) {
    const deadline = Date.now() + Math.max(1000, Number(deliveryWaitMs) || 30000);
    while (Date.now() <= deadline) {
      const row = await loadDelivery(scope, event.eventId, mapping.consumerKey);
      if (!row) throw new WorkflowIntegrationError(409, "EVENT_CONSUMPTION_UNAVAILABLE", "领域事件消费记录不可用", { retryable: true });
      if (row.status === "succeeded" || (row.status === "failed" && !row.result?.retryable)) return resultForDelivery(event, mapping, row);
      if (row.status === "processing") {
        const reconciled = await reconcileRuntimeInstance(scope, event, mapping);
        if (reconciled?.status === "succeeded") return resultForDelivery(event, mapping, reconciled);
      }
      await wait(Math.max(5, Math.min(1000, Number(pollIntervalMs) || 25)));
    }
    const row = await loadDelivery(scope, event.eventId, mapping.consumerKey);
    if (row?.status === "succeeded" || (row?.status === "failed" && !row.result?.retryable)) return resultForDelivery(event, mapping, row);
    throw new WorkflowIntegrationError(409, "EVENT_CONSUMPTION_PENDING", "领域事件消费仍在处理中", { retryable: true });
  }

  async function finishDelivery(scope, deliveryId, event, result) {
    return db.transaction(async tx => {
      const updated = await tx.query(`update workflow_event_consumptions set status='succeeded',workflow_instance_id=$1,result=$2::jsonb,processed_at=now(),updated_at=now(),last_error=null
        where id=$3 and tenant_id=$4 and workspace_id=$5 and status='processing' returning id`, [result.instance.id, json({ created: result.created, instanceId: result.instance.id, eventId: event.eventId }), deliveryId, scope.tenantId, scope.workspaceId]);
      if (updated.rows[0]) await audit(tx, { ...scope, actorType: "system", actorId: "workflow-integration" }, "workflow.integration.consumed", "domain_event", event.eventId, { eventType: event.eventType, consumerKey: result.consumerKey, workflowInstanceId: result.instance.id });
      return loadDelivery(scope, event.eventId, result.consumerKey, tx);
    });
  }

  async function failDelivery(scope, deliveryId, event, mapping, error) {
    return db.transaction(async tx => {
      const failure = { code: String(error?.code || "WORKFLOW_INTEGRATION_FAILED"), retryable: Boolean(error?.retryable) };
      const updated = await tx.query(`update workflow_event_consumptions set status='failed',last_error=$1,result=$2::jsonb,updated_at=now()
        where id=$3 and tenant_id=$4 and workspace_id=$5 and status='processing' returning id`, [String(error?.message || error).slice(0, 1000), json(failure), deliveryId, scope.tenantId, scope.workspaceId]);
      if (updated.rows[0]) await audit(tx, { ...scope, actorType: "system", actorId: "workflow-integration" }, "workflow.integration.failed", "domain_event", event.eventId, { eventType: event.eventType, consumerKey: mapping.consumerKey, error: failure.code, retryable: failure.retryable });
      return loadDelivery(scope, event.eventId, mapping.consumerKey, tx);
    });
  }

  async function consumeMappedEvent(scope, event, mapping) {
    const claim = await claimDelivery(scope, event, mapping);
    if (claim.terminal) return resultForDelivery(event, mapping, claim.row);
    if (claim.inFlight) return waitForTerminalDelivery(scope, event, mapping);
    try {
      await validateAggregateReference(scope, event);
      const runtime = await workflowService.startInstance(scope, {
        workflowKey: mapping.workflowKey,
        idempotencyKey: `${event.eventId}:${mapping.consumerKey}`,
        context: { source: "domain_event", event }
      }, { requestId: scope.requestId || `workflow-event-${event.eventId}` });
      const delivery = await finishDelivery(scope, claim.row.id, event, { ...runtime, consumerKey: mapping.consumerKey });
      return resultForDelivery(event, mapping, delivery);
    } catch (error) {
      const delivery = await failDelivery(scope, claim.row.id, event, mapping, error);
      return resultForDelivery(event, mapping, delivery);
    }
  }

  async function consumeEvent(scopeInput, eventId) {
    const scope = scopeOf(scopeInput);
    const row = await loadEvent(scope, String(eventId || ""));
    const event = normalizeEvent(row);
    const mappings = mappingsFor(event.eventType);
    if (!mappings.length) return { status: "ignored", eventId: event.eventId, eventType: event.eventType };
    const results = [];
    for (const mapping of mappings) results.push(await consumeMappedEvent(scope, event, mapping));
    return results.length === 1 ? results[0] : { status: "completed", eventId: event.eventId, consumers: results };
  }

  async function processPending(scopeInput = null, limit = 50) {
    const scope = scopeInput ? scopeOf(scopeInput) : null;
    const values = [Object.keys(LEGACY_EVENT_TYPES)];
    const filters = ["event_type=any($1)"];
    if (scope) { const tenantParam = values.length + 1; const workspaceParam = values.length + 2; values.push(scope.tenantId, scope.workspaceId); filters.push(`tenant_id=$${tenantParam}`, `workspace_id=$${workspaceParam}`); }
    values.push(Math.max(1, Math.min(200, Number(limit) || 50)));
    const rows = (await db.query(`select id,tenant_id,workspace_id from customer_events where ${filters.join(" and ")} order by occurred_at,id limit $${values.length}`, values)).rows;
    const results = [];
    for (const row of rows) {
      try { results.push(await consumeEvent({ tenantId: row.tenant_id, workspaceId: row.workspace_id, userId: scope?.userId || "system", requestId: scope?.requestId }, row.id)); }
      catch (error) { results.push({ status: "failed", eventId: row.id, error: error.code || error.message }); }
    }
    return results;
  }

  let worker = null;
  function startWorker() {
    if (worker) return worker;
    worker = setInterval(() => { processPending().catch(() => {}); }, Math.max(250, Number(pollIntervalMs) || 1000));
    worker.unref?.();
    return worker;
  }
  function stopWorker() { if (worker) clearInterval(worker); worker = null; }
  if (autoStart) startWorker();

  return { registerMapping, consumeEvent, processPending, startWorker, stopWorker, WorkflowIntegrationError };
}

module.exports = { createWorkflowIntegrationService, WorkflowIntegrationError, LEGACY_EVENT_TYPES };
