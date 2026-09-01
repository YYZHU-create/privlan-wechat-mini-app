const { createAiTemplateService, TemplateError } = require("./ai-template-studio");

function registerAiTemplateRoutes(app) {
  const services = new WeakMap();
  const studio = req => { if (!services.has(req.saasService)) services.set(req.saasService, createAiTemplateService({ db: req.saasService.db, audit: req.saasService.recordAudit })); return services.get(req.saasService); };
  const fail = (res, error, id) => res.status(Number(error.status || 500)).json({ ok: false, code: error.code || "AI_TEMPLATE_ERROR", message: error.message || "模板服务暂时不可用", error: error.message || "模板服务暂时不可用", data: null, requestId: id });
  const call = fn => async (req, res) => { try { return res.json({ ok: true, code: "OK", data: await fn(studio(req), req.merchantScope, req), requestId: req.requestId }); } catch (error) { return fail(res, error, req.requestId); } };
  app.post("/v1/ai/templates/generate", call((s, scope, req) => s.generate(scope, req.body || {})));
  app.get("/v1/ai/templates/drafts", call((s, scope) => s.listDrafts(scope)));
  app.get("/v1/ai/templates/drafts/:id", call((s, scope, req) => s.getDraft(scope, req.params.id)));
  app.post("/v1/ai/templates/drafts/:id/refine", call((s, scope, req) => s.refine(scope, req.params.id, req.body || {})));
  app.post("/v1/ai/templates/drafts/:id/apply", call((s, scope, req) => s.apply(scope, req.params.id, req.body || {})));
  app.post("/v1/ai/templates/drafts/:id/discard", call((s, scope, req) => s.discard(scope, req.params.id)));
  app.post("/v1/ai/skills", call((s, scope, req) => s.createSkill(scope, req.body || {})));
  app.post("/v1/ai/skills/:id/enable", call((s, scope, req) => s.setSkill(scope, req.params.id, true)));
  app.post("/v1/ai/skills/:id/disable", call((s, scope, req) => s.setSkill(scope, req.params.id, false)));
  app.get("/v1/ai/capabilities", call(s => s.getCapabilities()));
  app.get("/v1/ai/components", call(s => s.getComponents()));
  app.get("/v1/ai/credits", call((s, scope) => s.getCredits(scope)));
}

module.exports = { registerAiTemplateRoutes, TemplateError };
