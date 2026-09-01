const crypto = require("node:crypto");

class WorkflowError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}

function id() { return crypto.randomUUID(); }
function json(value) { return JSON.stringify(value ?? {}); }

function createWorkflowService({ db, audit }) {
  if (!db) throw new Error("database is required");
  if (typeof audit !== "function") throw new Error("audit writer is required");

  function scopeOf(scope) {
    if (!scope?.tenantId || !scope.workspaceId || !scope.userId) throw new WorkflowError(401, "AUTH_REQUIRED", "请先登录");
    return { tenantId: scope.tenantId, workspaceId: scope.workspaceId, userId: scope.userId };
  }

  function taskDefinitions(value) {
    const tasks = Array.isArray(value?.tasks) ? value.tasks : [];
    if (!tasks.length || tasks.length > 100) throw new WorkflowError(400, "WORKFLOW_TASKS_INVALID", "Workflow 至少需要一个任务且不能超过 100 个任务");
    const seen = new Set();
    return tasks.map((task, index) => {
      const key = String(task?.key || "").trim();
      const type = String(task?.type || "manual").trim();
      if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,79}$/.test(key) || seen.has(key)) throw new WorkflowError(400, "WORKFLOW_TASK_INVALID", `Workflow 任务 ${index + 1} 标识无效`);
      if (!type || type.length > 80) throw new WorkflowError(400, "WORKFLOW_TASK_INVALID", `Workflow 任务 ${key} 类型无效`);
      seen.add(key);
      return { key, type, title: String(task?.title || key).trim().slice(0, 160) };
    });
  }

  async function nextSequence(tx, scope, instanceId) {
    const row = (await tx.query(`update workflow_instances
      set next_event_sequence=next_event_sequence+1,updated_at=now()
      where id=$1 and tenant_id=$2 and workspace_id=$3
      returning next_event_sequence-1 sequence`, [instanceId, scope.tenantId, scope.workspaceId])).rows[0];
    if (!row) throw new WorkflowError(404, "WORKFLOW_INSTANCE_NOT_FOUND", "Workflow 实例不存在");
    return Number(row.sequence);
  }

  async function event(tx, scope, instanceId, taskId, eventType, payload, actorId = scope.userId) {
    const sequence = await nextSequence(tx, scope, instanceId);
    const eventId = id();
    await tx.query(`insert into workflow_events(id,instance_id,task_id,tenant_id,workspace_id,sequence,event_type,actor_id,payload)
      values($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)`, [eventId, instanceId, taskId || null, scope.tenantId, scope.workspaceId, sequence, eventType, actorId || "system", json(payload)]);
    await audit(tx, { tenantId: scope.tenantId, workspaceId: scope.workspaceId, actorType: "merchant", actorId: actorId || "system", requestId: scope.requestId }, `workflow.${eventType}`, "workflow_instance", instanceId, { ...payload, sequence });
    return { id: eventId, sequence, eventType };
  }

  async function loadInstance(scope, instanceId, client = db) {
    const row = (await client.query(`select i.id,i.definition_id,i.version_id,i.status,i.context,i.idempotency_key,i.started_by,i.started_at,i.completed_at,i.updated_at,d.workflow_key,d.name,v.version
      from workflow_instances i join workflow_definitions d on d.id=i.definition_id and d.tenant_id=i.tenant_id and d.workspace_id=i.workspace_id
      join workflow_versions v on v.id=i.version_id and v.tenant_id=i.tenant_id and v.workspace_id=i.workspace_id
      where i.id=$1 and i.tenant_id=$2 and i.workspace_id=$3`, [instanceId, scope.tenantId, scope.workspaceId])).rows[0];
    if (!row) throw new WorkflowError(404, "WORKFLOW_INSTANCE_NOT_FOUND", "Workflow 实例不存在");
    const taskRows = (await client.query(`select id,task_key,task_type,status,input,output,assigned_user_id,created_at,completed_at
      from workflow_tasks where instance_id=$1 and tenant_id=$2 and workspace_id=$3 order by created_at,id`, [instanceId, scope.tenantId, scope.workspaceId])).rows;
    const tasks = taskRows.map(row => ({ id: row.id, taskKey: row.task_key, taskType: row.task_type, status: row.status, input: row.input, output: row.output, assignedUserId: row.assigned_user_id, createdAt: row.created_at, completedAt: row.completed_at }));
    const eventRows = (await client.query(`select id,sequence,event_type,task_id,actor_id,payload,created_at
      from workflow_events where instance_id=$1 and tenant_id=$2 and workspace_id=$3 order by sequence`, [instanceId, scope.tenantId, scope.workspaceId])).rows;
    const events = eventRows.map(row => ({ id: row.id, sequence: row.sequence, eventType: row.event_type, taskId: row.task_id, actorId: row.actor_id, payload: row.payload, createdAt: row.created_at }));
    return { id: row.id, workflowKey: row.workflow_key, name: row.name, definitionId: row.definition_id, versionId: row.version_id, version: row.version, status: row.status, context: row.context, idempotencyKey: row.idempotency_key, startedBy: row.started_by, startedAt: row.started_at, completedAt: row.completed_at, updatedAt: row.updated_at, tasks, events };
  }

  async function registerDefinition(scope, input = {}, context = {}) {
    const scoped = { ...scopeOf(scope), requestId: context.requestId };
    const workflowKey = String(input.workflowKey || "").trim();
    const name = String(input.name || workflowKey).trim().slice(0, 160);
    if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,79}$/.test(workflowKey) || !name) throw new WorkflowError(400, "WORKFLOW_DEFINITION_INVALID", "Workflow 定义标识无效");
    const tasks = taskDefinitions(input.definition || input);
    return db.transaction(async tx => {
      const existing = (await tx.query("select id from workflow_definitions where tenant_id=$1 and workspace_id=$2 and workflow_key=$3", [scoped.tenantId, scoped.workspaceId, workflowKey])).rows[0];
      if (existing) throw new WorkflowError(409, "WORKFLOW_DEFINITION_EXISTS", "Workflow 定义已存在");
      const definitionId = id(); const versionId = id();
      await tx.query(`insert into workflow_definitions(id,tenant_id,workspace_id,workflow_key,name,created_by)
        values($1,$2,$3,$4,$5,$6)`, [definitionId, scoped.tenantId, scoped.workspaceId, workflowKey, name, scoped.userId]);
      await tx.query(`insert into workflow_versions(id,definition_id,tenant_id,workspace_id,version,definition_json,created_by)
        values($1,$2,$3,$4,1,$5::jsonb,$6)`, [versionId, definitionId, scoped.tenantId, scoped.workspaceId, json({ tasks }), scoped.userId]);
      await audit(tx, scoped, "workflow.definition.register", "workflow_definition", definitionId, { workflowKey, version: 1 });
      return { definitionId, versionId, workflowKey, name, version: 1, tasks };
    });
  }

  async function startInstance(scope, input = {}, context = {}) {
    const scoped = { ...scopeOf(scope), requestId: context.requestId };
    const workflowKey = String(input.workflowKey || "").trim();
    const idempotencyKey = input.idempotencyKey ? String(input.idempotencyKey).trim().slice(0, 160) : null;
    if (!workflowKey) throw new WorkflowError(400, "WORKFLOW_KEY_REQUIRED", "缺少 Workflow 标识");
    return db.transaction(async tx => {
      const definition = (await tx.query(`select d.id definition_id,d.workflow_key,d.name,v.id version_id,v.version,v.definition_json
        from workflow_definitions d join workflow_versions v on v.definition_id=d.id and v.tenant_id=d.tenant_id and v.workspace_id=d.workspace_id
        where d.tenant_id=$1 and d.workspace_id=$2 and d.workflow_key=$3 and d.status='active' and v.status='published'
        order by v.version desc limit 1`, [scoped.tenantId, scoped.workspaceId, workflowKey])).rows[0];
      if (!definition) throw new WorkflowError(404, "WORKFLOW_DEFINITION_NOT_FOUND", "Workflow 定义不存在");
      const tasks = taskDefinitions(definition.definition_json);
      const instanceId = id();
      const inserted = await tx.query(`insert into workflow_instances(id,definition_id,version_id,tenant_id,workspace_id,status,context,idempotency_key,started_by)
        values($1,$2,$3,$4,$5,'running',$6::jsonb,$7,$8)
        on conflict (tenant_id,workspace_id,idempotency_key) where idempotency_key is not null do nothing
        returning id`, [instanceId, definition.definition_id, definition.version_id, scoped.tenantId, scoped.workspaceId, json(input.context || {}), idempotencyKey, scoped.userId]);
      if (!inserted.rows[0]) {
        const existing = (await tx.query("select id from workflow_instances where tenant_id=$1 and workspace_id=$2 and idempotency_key=$3", [scoped.tenantId, scoped.workspaceId, idempotencyKey])).rows[0];
        if (!existing) throw new WorkflowError(409, "WORKFLOW_IDEMPOTENCY_PENDING", "Workflow 实例正在创建");
        return { created: false, instance: await loadInstance(scoped, existing.id, tx) };
      }
      await event(tx, scoped, instanceId, null, "instance.started", { workflowKey, version: definition.version });
      const first = tasks[0];
      const taskId = id();
      await tx.query(`insert into workflow_tasks(id,instance_id,definition_id,tenant_id,workspace_id,task_key,task_type,status,input)
        values($1,$2,$3,$4,$5,$6,$7,'pending',$8::jsonb)`, [taskId, instanceId, definition.definition_id, scoped.tenantId, scoped.workspaceId, first.key, first.type, json({ title: first.title })]);
      await event(tx, scoped, instanceId, taskId, "task.ready", { taskKey: first.key, taskType: first.type });
      return { created: true, instance: await loadInstance(scoped, instanceId, tx) };
    });
  }

  async function completeTask(scope, instanceId, taskKey, input = {}, context = {}) {
    const scoped = { ...scopeOf(scope), requestId: context.requestId };
    const key = String(taskKey || "").trim();
    if (!key) throw new WorkflowError(400, "WORKFLOW_TASK_REQUIRED", "缺少 Workflow 任务标识");
    return db.transaction(async tx => {
      const instance = (await tx.query(`select i.id,i.definition_id,i.status,v.definition_json from workflow_instances i join workflow_versions v on v.id=i.version_id
        where i.id=$1 and i.tenant_id=$2 and i.workspace_id=$3 for update`, [instanceId, scoped.tenantId, scoped.workspaceId])).rows[0];
      if (!instance) throw new WorkflowError(404, "WORKFLOW_INSTANCE_NOT_FOUND", "Workflow 实例不存在");
      if (instance.status !== "running") throw new WorkflowError(409, "WORKFLOW_INSTANCE_NOT_RUNNING", "Workflow 实例当前不可推进");
      const task = (await tx.query(`select id,task_key,task_type,status from workflow_tasks where instance_id=$1 and tenant_id=$2 and workspace_id=$3 and task_key=$4 for update`, [instanceId, scoped.tenantId, scoped.workspaceId, key])).rows[0];
      if (!task) throw new WorkflowError(404, "WORKFLOW_TASK_NOT_FOUND", "Workflow 任务不存在");
      if (task.status !== "pending") throw new WorkflowError(409, "WORKFLOW_TASK_NOT_PENDING", "Workflow 任务当前不可完成");
      await tx.query("update workflow_tasks set status='completed',output=$1::jsonb,completed_at=now() where id=$2", [json(input.output || {}), task.id]);
      await event(tx, scoped, instanceId, task.id, "task.completed", { taskKey: key });
      const definitions = taskDefinitions(instance.definition_json);
      const next = definitions[definitions.findIndex(item => item.key === key) + 1];
      if (next) {
        const nextId = id();
        await tx.query(`insert into workflow_tasks(id,instance_id,definition_id,tenant_id,workspace_id,task_key,task_type,status,input)
          values($1,$2,$3,$4,$5,$6,$7,'pending',$8::jsonb)`, [nextId, instanceId, instance.definition_id, scoped.tenantId, scoped.workspaceId, next.key, next.type, json({ title: next.title })]);
        await event(tx, scoped, instanceId, nextId, "task.ready", { taskKey: next.key, taskType: next.type });
      } else {
        await tx.query("update workflow_instances set status='completed',completed_at=now(),updated_at=now() where id=$1", [instanceId]);
        await event(tx, scoped, instanceId, null, "instance.completed", {});
      }
      return loadInstance(scoped, instanceId, tx);
    });
  }

  async function cancelInstance(scope, instanceId, context = {}) {
    const scoped = { ...scopeOf(scope), requestId: context.requestId };
    return db.transaction(async tx => {
      const row = (await tx.query("select id,status from workflow_instances where id=$1 and tenant_id=$2 and workspace_id=$3 for update", [instanceId, scoped.tenantId, scoped.workspaceId])).rows[0];
      if (!row) throw new WorkflowError(404, "WORKFLOW_INSTANCE_NOT_FOUND", "Workflow 实例不存在");
      if (row.status !== "running") throw new WorkflowError(409, "WORKFLOW_INSTANCE_NOT_RUNNING", "Workflow 实例当前不可取消");
      await tx.query("update workflow_tasks set status='cancelled' where instance_id=$1 and tenant_id=$2 and workspace_id=$3 and status='pending'", [instanceId, scoped.tenantId, scoped.workspaceId]);
      await tx.query("update workflow_instances set status='cancelled',completed_at=now(),updated_at=now() where id=$1", [instanceId]);
      await event(tx, scoped, instanceId, null, "instance.cancelled", {});
      return loadInstance(scoped, instanceId, tx);
    });
  }

  async function getInstance(scope, instanceId) { return loadInstance(scopeOf(scope), String(instanceId || "")); }
  async function listEvents(scope, instanceId) { return (await getInstance(scope, instanceId)).events; }

  return { registerDefinition, startInstance, completeTask, cancelInstance, getInstance, listEvents, WorkflowError };
}

module.exports = { createWorkflowService, WorkflowError };
