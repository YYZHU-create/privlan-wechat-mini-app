const { respondUnexpectedError } = require("./error-response");
function success(res, data, message, status, requestId) {
  return res.status(status).json({ ok: true, code: "OK", message, data, requestId });
}

function failure(res, error, requestId) {
  return respondUnexpectedError(res, error, { requestId, code: error?.code || "INTERNAL_ERROR", message: "服务暂时不可用" });
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
  app.get("/v1/workflow-capabilities", async (req,res)=>{ try { const workflow=requiredService(req,res); if(!workflow)return; return success(res,await workflow.listCapabilities(req.merchantScope),"Workflow 能力已获取",200,req.requestId);} catch(e){return failure(res,e,req.requestId);} });
  app.get("/v1/workflow-runs", async (req,res)=>{ try { const workflow=requiredService(req,res); if(!workflow)return; return success(res,await workflow.listRuns(req.merchantScope,{limit:req.query.limit}),"Workflow 运行记录已获取",200,req.requestId);} catch(e){return failure(res,e,req.requestId);} });  app.get("/v1/workflow-definitions", async (req, res) => {
    try { const workflow = requiredService(req, res); if (!workflow) return; return success(res, await workflow.listDefinitions(req.merchantScope), "Workflow 定义已获取", 200, req.requestId); }
    catch (error) { return failure(res, error, req.requestId); }
  });

  app.post("/v1/workflow-definitions", async (req, res) => {
    try { const workflow = requiredService(req, res); if (!workflow) return; const result = await workflow.registerDefinition(req.merchantScope, req.body || {}, { requestId: req.requestId }); return success(res, result, "Workflow 定义已创建", 201, req.requestId); }
    catch (error) { return failure(res, error, req.requestId); }
  });

  app.patch("/v1/workflow-definitions/:workflowKey", async (req, res) => {
    try { const workflow = requiredService(req, res); if (!workflow) return; const result = await workflow.setDefinitionStatus(req.merchantScope, req.params.workflowKey, req.body?.status, { requestId: req.requestId }); return success(res, result, "Workflow 状态已更新", 200, req.requestId); }
    catch (error) { return failure(res, error, req.requestId); }
  });
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

  app.post("/v1/workflow-instances/:id/tasks/:taskKey/fail", async (req,res)=>{ try { const workflow=requiredService(req,res); if(!workflow)return; return success(res,await workflow.failTask(req.merchantScope,req.params.id,req.params.taskKey,req.body?.reason,{requestId:req.requestId}),"Workflow 任务已标记失败",200,req.requestId);} catch(e){return failure(res,e,req.requestId);} });
  app.post("/v1/workflow-instances/:id/tasks/:taskKey/retry", async (req,res)=>{ try { const workflow=requiredService(req,res); if(!workflow)return; return success(res,await workflow.retryTask(req.merchantScope,req.params.id,req.params.taskKey,{requestId:req.requestId}),"Workflow 任务已重试",200,req.requestId);} catch(e){return failure(res,e,req.requestId);} });  app.post("/v1/workflow-instances/:id/cancel", async (req, res) => {
    try { const workflow = requiredService(req, res); if (!workflow) return; return success(res, await workflow.cancelInstance(req.merchantScope, req.params.id, { requestId: req.requestId }), "Workflow 实例已取消", 200, req.requestId); }
    catch (error) { return failure(res, error, req.requestId); }
  });
}

module.exports = { registerWorkflowRoutes };
