const crypto = require("node:crypto");
const { AppointmentError } = require("./appointment-service");

function requestId(prefix = "appointment") { return `${prefix}_${Date.now().toString(36)}_${crypto.randomBytes(4).toString("hex")}`; }
function ok(res, data, message = "操作成功", status = 200, id = requestId()) { return res.status(status).json({ ok: true, code: "OK", message, data, requestId: id }); }
function fail(res, error, id = requestId()) { const status = Number(error?.status || 500); const message = status >= 500 && !(error instanceof AppointmentError) ? "服务暂时不可用" : String(error?.message || "请求失败"); return res.status(status).json({ ok: false, code: error?.code || "INTERNAL_ERROR", message, data: null, requestId: id }); }

function verifyGateway(req) {
  const expected = String(process.env.ATELIER_APPOINTMENT_GATEWAY_TOKEN || "");
  if (Buffer.byteLength(expected) < 32) throw new AppointmentError(503, "APPOINTMENT_GATEWAY_NOT_CONFIGURED", "预约网关尚未配置");
  const supplied = String(req.get("authorization") || "").replace(/^Bearer\s+/i, "");
  const left = crypto.createHash("sha256").update(supplied).digest(); const right = crypto.createHash("sha256").update(expected).digest();
  if (!supplied || !crypto.timingSafeEqual(left, right)) throw new AppointmentError(401, "GATEWAY_AUTH_INVALID", "预约网关认证失败");
}

function registerAppointmentGatewayRoutes(app, getService) {
  async function run(req, res, action, message) {
    const id = requestId("mp");
    try { verifyGateway(req); const service = await getService(); if (!service) throw new AppointmentError(503, "DATABASE_REQUIRED", "预约数据库尚未配置"); return ok(res, await action(service.appointmentService, id), message, 200, id); }
    catch (error) { return fail(res, error, id); }
  }
  app.post("/v1/miniprogram/appointment-options", (req, res) => run(req, res, service => service.availableOptions(req.body || {}), "预约选项读取成功"));
  app.post("/v1/miniprogram/appointments", (req, res) => run(req, res, (service, id) => service.createAppointment(req.body || {}, { requestId: id }), "预约已提交"));
  app.post("/v1/miniprogram/appointments/list", (req, res) => run(req, res, service => service.listPublicAppointments(req.body || {}), "预约记录读取成功"));
}

function registerMerchantAppointmentRoutes(app) {
  const service = req => req.saasService.appointmentService;
  app.get("/v1/appointments/stats", async (req,res) => { try { return ok(res,await service(req).stats(req.merchantScope),"预约统计已获取",200,req.requestId); } catch(error){ return fail(res,error,req.requestId); } });
  app.get("/v1/appointments", async (req,res) => { try { return ok(res,await service(req).listAppointments(req.merchantScope,req.query),"预约已获取",200,req.requestId); } catch(error){ return fail(res,error,req.requestId); } });
  app.get("/v1/appointments/:id", async (req,res) => { try { return ok(res,await service(req).getAppointment(req.merchantScope,req.params.id),"预约详情已获取",200,req.requestId); } catch(error){ return fail(res,error,req.requestId); } });
  app.patch("/v1/appointments/:id/status", async (req,res) => { try { return ok(res,await service(req).updateStatus(req.merchantScope,req.params.id,req.body?.status),"预约状态已更新",200,req.requestId); } catch(error){ return fail(res,error,req.requestId); } });
  app.get("/v1/customers", async (req,res) => { try { return ok(res,await service(req).listCustomers(req.merchantScope,req.query.q),"客户已获取",200,req.requestId); } catch(error){ return fail(res,error,req.requestId); } });
  app.get("/v1/customers/:id", async (req,res) => { try { return ok(res,await service(req).getCustomer(req.merchantScope,req.params.id),"客户详情已获取",200,req.requestId); } catch(error){ return fail(res,error,req.requestId); } });
  app.get("/v1/appointment-settings", async (req,res) => { try { return ok(res,await service(req).getSettings(req.merchantScope),"预约规则已获取",200,req.requestId); } catch(error){ return fail(res,error,req.requestId); } });
  app.put("/v1/appointment-settings", async (req,res) => { try { return ok(res,await service(req).updateSettings(req.merchantScope,req.body||{}),"预约规则已保存",200,req.requestId); } catch(error){ return fail(res,error,req.requestId); } });
  app.get("/v1/appointment-services", async (req,res) => { try { return ok(res,await service(req).listServices(req.merchantScope),"服务已获取",200,req.requestId); } catch(error){ return fail(res,error,req.requestId); } });
  app.post("/v1/appointment-services", async (req,res) => { try { return ok(res,await service(req).saveService(req.merchantScope,req.body||{}),"服务已创建",201,req.requestId); } catch(error){ return fail(res,error,req.requestId); } });
  app.patch("/v1/appointment-services/:id", async (req,res) => { try { return ok(res,await service(req).saveService(req.merchantScope,req.body||{},req.params.id),"服务已更新",200,req.requestId); } catch(error){ return fail(res,error,req.requestId); } });
  app.delete("/v1/appointment-services/:id", async (req,res) => { try { return ok(res,await service(req).removeService(req.merchantScope,req.params.id),"服务已删除",200,req.requestId); } catch(error){ return fail(res,error,req.requestId); } });
  app.get("/v1/appointment-advisors", async (req,res) => { try { return ok(res,await service(req).listAdvisors(req.merchantScope),"服务人员已获取",200,req.requestId); } catch(error){ return fail(res,error,req.requestId); } });
  app.post("/v1/appointment-advisors", async (req,res) => { try { return ok(res,await service(req).saveAdvisor(req.merchantScope,req.body||{}),"服务人员已创建",201,req.requestId); } catch(error){ return fail(res,error,req.requestId); } });
  app.patch("/v1/appointment-advisors/:id", async (req,res) => { try { return ok(res,await service(req).saveAdvisor(req.merchantScope,req.body||{},req.params.id),"服务人员已更新",200,req.requestId); } catch(error){ return fail(res,error,req.requestId); } });
  app.delete("/v1/appointment-advisors/:id", async (req,res) => { try { return ok(res,await service(req).removeAdvisor(req.merchantScope,req.params.id),"服务人员已删除",200,req.requestId); } catch(error){ return fail(res,error,req.requestId); } });
  app.get("/v1/appointment-business-hours", async (req,res) => { try { return ok(res,await service(req).listHours(req.merchantScope),"营业时间已获取",200,req.requestId); } catch(error){ return fail(res,error,req.requestId); } });
  app.put("/v1/appointment-business-hours", async (req,res) => { try { return ok(res,await service(req).replaceHours(req.merchantScope,req.body||{}),"营业时间已保存",200,req.requestId); } catch(error){ return fail(res,error,req.requestId); } });
}

module.exports = { registerAppointmentGatewayRoutes, registerMerchantAppointmentRoutes, verifyGateway };
