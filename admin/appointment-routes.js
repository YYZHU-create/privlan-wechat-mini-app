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
  app.post("/v1/miniprogram/customers/touch", async (req, res) => {
    const id = requestId("mp-touch");
    try {
    verifyGateway(req);
    const saas = await getService();
    if (!saas) throw new AppointmentError(503, "DATABASE_REQUIRED", "预约数据库尚未配置");
    const publicStoreId = String(req.body?.publicStoreId || "");
    const row = (await saas.db.query("select tenant_id,workspace_id,id store_id from stores where public_store_id=$1 limit 1", [publicStoreId])).rows[0];
    if (!row) throw new AppointmentError(404, "STORE_NOT_FOUND", "未找到预约门店");
    const openid = String(req.body?.openid || "");
    if (!openid) throw new AppointmentError(401, "AUTH_REQUIRED", "请先在微信中登录");
    const customer = await saas.customerService.touchMiniProgramCustomer({ tenantId: row.tenant_id, workspaceId: row.workspace_id, storeId: row.store_id, requestId: id }, { openid, displayName: req.body?.displayName, avatarUrl: req.body?.avatarUrl });
    return ok(res, { id: customer.id, name: customer.display_name || `微信用户 ${customer.id.replace(/-/g, "").slice(0, 4).toUpperCase()}` }, "客户身份已同步", 200, id);
    } catch (error) { return fail(res, error, id); }
  });
}

function registerMerchantAppointmentRoutes(app) {
  const service = req => req.saasService.appointmentService;
  const customers = req => req.saasService.customerService;
  const assertCustomerWrite = req => req.saasService.assertWritable(req.merchantScope);
  app.get("/v1/appointments/stats", async (req,res) => { try { return ok(res,await service(req).stats(req.merchantScope),"预约统计已获取",200,req.requestId); } catch(error){ return fail(res,error,req.requestId); } });
  app.get("/v1/appointments/availability", async (req,res) => { try { return ok(res,await service(req).merchantAvailability(req.merchantScope,req.query||{}),"可预约时间已获取",200,req.requestId); } catch(error){ return fail(res,error,req.requestId); } });
  app.get("/v1/appointments", async (req,res) => { try { return ok(res,await service(req).listAppointments(req.merchantScope,req.query),"预约已获取",200,req.requestId); } catch(error){ return fail(res,error,req.requestId); } });
  app.get("/v1/appointments/:id/timeline", async (req,res) => { try { return ok(res,await service(req).timeline(req.merchantScope,req.params.id),"预约动态已获取",200,req.requestId); } catch(error){ return fail(res,error,req.requestId); } });
  app.post("/v1/appointments/:id/follow-up", async (req,res) => { try { return ok(res,await service(req).createFollowUp(req.merchantScope,req.params.id,req.body||{}),"跟进记录已添加",201,req.requestId); } catch(error){ return fail(res,error,req.requestId); } });
  app.get("/v1/appointments/:id", async (req,res) => { try { return ok(res,await service(req).getAppointment(req.merchantScope,req.params.id),"预约详情已获取",200,req.requestId); } catch(error){ return fail(res,error,req.requestId); } });
  app.patch("/v1/appointments/:id/status", async (req,res) => { try { return ok(res,await service(req).updateStatus(req.merchantScope,req.params.id,req.body?.status),"预约状态已更新",200,req.requestId); } catch(error){ return fail(res,error,req.requestId); } });
  app.get("/v1/customers", async (req,res) => { try { return ok(res,await customers(req).list(req.merchantScope,req.query),"客户已获取",200,req.requestId); } catch(error){ return fail(res,error,req.requestId); } });
  app.get("/v1/customers/stats", async (req,res) => { try { return ok(res,await customers(req).stats(req.merchantScope),"客户统计已获取",200,req.requestId); } catch(error){ return fail(res,error,req.requestId); } });
  app.get("/v1/customers/:id/360", async (req,res) => { try { return ok(res,await customers(req).get360(req.merchantScope,req.params.id),"客户 360 已获取",200,req.requestId); } catch(error){ return fail(res,error,req.requestId); } });
  app.get("/v1/customers/:id", async (req,res) => { try { return ok(res,await customers(req).get(req.merchantScope,req.params.id),"客户详情已获取",200,req.requestId); } catch(error){ return fail(res,error,req.requestId); } });
  app.get("/v1/customers/:id/orders", async (req,res) => { try { return ok(res,await customers(req).related(req.merchantScope,req.params.id,"orders"),"客户订单已获取",200,req.requestId); } catch(error){ return fail(res,error,req.requestId); } });
  app.get("/v1/customers/:id/appointments", async (req,res) => { try { return ok(res,await customers(req).related(req.merchantScope,req.params.id,"appointments"),"客户预约已获取",200,req.requestId); } catch(error){ return fail(res,error,req.requestId); } });
  app.get("/v1/customers/:id/events", async (req,res) => { try { return ok(res,await customers(req).related(req.merchantScope,req.params.id,"events"),"客户动态已获取",200,req.requestId); } catch(error){ return fail(res,error,req.requestId); } });
  app.post("/v1/customers/:id/notes", async (req,res) => { try { assertCustomerWrite(req); return ok(res,await customers(req).addNote(req.merchantScope,req.params.id,req.body||{}),"客户备注已添加",201,req.requestId); } catch(error){ return fail(res,error,req.requestId); } });
  app.post("/v1/customers/:id/points/adjust", async (req,res) => { try { assertCustomerWrite(req); return ok(res,await customers(req).adjustPoints(req.merchantScope,req.params.id,req.body||{}),"积分已调整",200,req.requestId); } catch(error){ return fail(res,error,req.requestId); } });
  app.get("/v1/customer-tags", async (req,res) => { try { return ok(res,await customers(req).listTags(req.merchantScope),"客户标签已获取",200,req.requestId); } catch(error){ return fail(res,error,req.requestId); } });
  app.post("/v1/customer-tags", async (req,res) => { try { assertCustomerWrite(req); return ok(res,await customers(req).createTag(req.merchantScope,req.body||{}),"客户标签已创建",201,req.requestId); } catch(error){ return fail(res,error,req.requestId); } });
  app.post("/v1/customers/:id/tags", async (req,res) => { try { assertCustomerWrite(req); return ok(res,await customers(req).linkTag(req.merchantScope,req.params.id,String(req.body?.tagId||"")),"客户标签已绑定",200,req.requestId); } catch(error){ return fail(res,error,req.requestId); } });
  app.delete("/v1/customers/:id/tags/:tagId", async (req,res) => { try { assertCustomerWrite(req); return ok(res,await customers(req).unlinkTag(req.merchantScope,req.params.id,req.params.tagId),"客户标签已移除",200,req.requestId); } catch(error){ return fail(res,error,req.requestId); } });
  app.get("/v1/customers/:id/membership", async (req,res) => { try { return ok(res,await customers(req).membership(req.merchantScope,req.params.id),"客户会员信息已获取",200,req.requestId); } catch(error){ return fail(res,error,req.requestId); } });
  app.post("/v1/customers/:id/membership", async (req,res) => { try { assertCustomerWrite(req); return ok(res,await customers(req).joinMembership(req.merchantScope,req.params.id,req.body?.levelId||null),"客户已加入会员",201,req.requestId); } catch(error){ return fail(res,error,req.requestId); } });
  app.patch("/v1/customers/:id/membership", async (req,res) => { try { assertCustomerWrite(req); return ok(res,await customers(req).adjustMembership(req.merchantScope,req.params.id,String(req.body?.levelId||"")),"会员等级已更新",200,req.requestId); } catch(error){ return fail(res,error,req.requestId); } });
  app.get("/v1/membership-levels", async (req,res) => { try { return ok(res,await customers(req).levels(req.merchantScope),"会员等级已获取",200,req.requestId); } catch(error){ return fail(res,error,req.requestId); } });
  app.post("/v1/membership-levels", async (req,res) => { try { assertCustomerWrite(req); return ok(res,await customers(req).saveLevel(req.merchantScope,req.body||{}),"会员等级已创建",201,req.requestId); } catch(error){ return fail(res,error,req.requestId); } });
  app.patch("/v1/membership-levels/:id", async (req,res) => { try { assertCustomerWrite(req); return ok(res,await customers(req).saveLevel(req.merchantScope,req.body||{},req.params.id),"会员等级已更新",200,req.requestId); } catch(error){ return fail(res,error,req.requestId); } });
  app.get("/v1/membership-program", async (req,res) => { try { return ok(res,await customers(req).program(req.merchantScope),"会员计划已获取",200,req.requestId); } catch(error){ return fail(res,error,req.requestId); } });
  app.patch("/v1/membership-program", async (req,res) => { try { assertCustomerWrite(req); return ok(res,await customers(req).updateProgram(req.merchantScope,req.body||{}),"会员计划已更新",200,req.requestId); } catch(error){ return fail(res,error,req.requestId); } });
  app.get("/v1/customers/:id/points", async (req,res) => { try { return ok(res,await customers(req).points(req.merchantScope,req.params.id),"积分信息已获取",200,req.requestId); } catch(error){ return fail(res,error,req.requestId); } });
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
