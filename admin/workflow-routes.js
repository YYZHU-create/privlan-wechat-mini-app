function success(res, data, message, status, requestId) {
  return res.status(status).json({ ok: true, code: "OK", message, data, requestId });
}

function failure(res, error, requestId) {
  const status = Number(error?.status || 500);
  return res.status(status).json({ ok: false, code: error?.code || "INTERNAL_ERROR", message: status >= 500 ? "服务暂时不可用" : String(error.message || "请求失败"), data: null, requestId });
}

function registerWorkflowRoutes(app) {
  const service = req => req.saasService?.workflowService;
  function requiredService(req, res) {
    const workflow = service(req);
    if (!workflow) {
      res.status(503).json({ ok: false, code: "DATABASE_REQUIRED", message: "Workflow 数据库尚未配置", data: null, requestId: req.requestId });
      return null;
    }
    return workflow;
  }
  app.post("/v1/workflow-instances", async (req, res) => {
    try {
      const workflow = requiredService(req, res); if (!workflow) return;
      const result = await workflow.startInstance(req.merchantScope, req.body || {}, { requestId: req.requestId });
      return success(res, result.instance, result.created ? "Workflow 实例已启动" : "Workflow 实例已返回", result.created ? 201 : 200, req.requestId);
    } catch (error) { return failure(res, error, req.requestId); }
  });

  app.get("/v1/workflow-instances/:id", async (req, res) => {
    try { const workflow = requiredService(req, res); if (!workflow) return; return success(res, await workflow.getInstance(req.merchantScope, req.params.id), "Workflow 实例已获取", 200, req.requestId); }
    catch (error) { return failure(res, error, req.requestId); }
  });

  app.get("/v1/workflow-instances/:id/events", async (req, res) => {
    try { const workflow = requiredService(req, res); if (!workflow) return; return success(res, await workflow.listEvents(req.merchantScope, req.params.id), "Workflow 事件已获取", 200, req.requestId); }
    catch (error) { return failure(res, error, req.requestId); }
  });

  app.post("/v1/workflow-instances/:id/tasks/:taskKey/complete", async (req, res) => {
    try { const workflow = requiredService(req, res); if (!workflow) return; return success(res, await workflow.completeTask(req.merchantScope, req.params.id, req.params.taskKey, req.body || {}, { requestId: req.requestId }), "Workflow 任务已完成", 200, req.requestId); }
    catch (error) { return failure(res, error, req.requestId); }
  });

  app.post("/v1/workflow-instances/:id/cancel", async (req, res) => {
    try { const workflow = requiredService(req, res); if (!workflow) return; return success(res, await workflow.cancelInstance(req.merchantScope, req.params.id, { requestId: req.requestId }), "Workflow 实例已取消", 200, req.requestId); }
    catch (error) { return failure(res, error, req.requestId); }
  });
}

module.exports = { registerWorkflowRoutes };
