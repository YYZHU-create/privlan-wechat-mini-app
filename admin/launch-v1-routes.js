function ok(res,data,message, status=200,id){return res.status(status).json({ok:true,code:"OK",message,data,requestId:id});}
function fail(res,e,id){return res.status(Number(e?.status||500)).json({ok:false,code:e?.code||"INTERNAL_ERROR",message:Number(e?.status||500)>=500?"服务暂时不可用":String(e?.message||"请求失败"),data:null,requestId:id});}
function registerLaunchV1Routes(app){
  const run=(fn)=>(req,res)=>Promise.resolve().then(()=>fn(req)).then(v=>ok(res,v,"操作成功",200,req.requestId)).catch(e=>fail(res,e,req.requestId));
  app.get("/v1/membership/activity",run(req=>req.saasService.membershipLaunchService.activity(req.merchantScope)));
  app.post("/v1/membership-rules",run(req=>req.saasService.membershipLaunchService.upsertRule(req.merchantScope,req.body||{},{requestId:req.requestId})));
  app.post("/v1/customers/:id/membership/evaluate",run(req=>req.saasService.membershipLaunchService.evaluate(req.merchantScope,req.params.id,{requestId:req.requestId})));
  app.post("/v1/customers/:id/membership/override",run(req=>req.saasService.membershipLaunchService.setOverride(req.merchantScope,req.params.id,req.body||{},{requestId:req.requestId})));
  app.post("/v1/customers/:id/membership/redeem",run(req=>req.saasService.membershipLaunchService.redeem(req.merchantScope,req.params.id,req.body?.benefitKey,req.body||{},{requestId:req.requestId})));
  const m=req=>req.saasService.marketingService;
  app.get("/v1/marketing/audiences",run(req=>m(req).audienceList(req.merchantScope)));
  app.post("/v1/marketing/audiences",run(req=>m(req).audienceCreate(req.merchantScope,req.body||{})));
  app.get("/v1/marketing/audiences/:id/members",run(req=>m(req).audienceMembers(req.merchantScope,req.params.id)));
  app.get("/v1/marketing/offers",run(req=>m(req).offers(req.merchantScope)));
  app.post("/v1/marketing/offers",run(req=>m(req).createOffer(req.merchantScope,req.body||{})));
  app.post("/v1/marketing/offers/:offerId/issue",run(req=>m(req).issue(req.merchantScope,req.params.offerId,req.body?.customerId,req.body||{},{requestId:req.requestId})));
  app.post("/v1/marketing/issuances/:id/redeem",run(req=>m(req).redeem(req.merchantScope,req.params.id,req.body||{},{requestId:req.requestId})));
  app.get("/v1/marketing/campaigns",run(req=>m(req).campaigns(req.merchantScope)));
  app.post("/v1/marketing/campaigns",run(req=>m(req).createCampaign(req.merchantScope,req.body||{})));
  app.patch("/v1/marketing/campaigns/:id/status",run(req=>m(req).setCampaignStatus(req.merchantScope,req.params.id,req.body?.status,{requestId:req.requestId})));
  app.get("/v1/marketing/campaigns/:id/analytics",run(req=>m(req).analytics(req.merchantScope,req.params.id)));
}
function registerLaunchV1OpsRoutes(app,getService){
  const run=(fn)=>(req,res)=>Promise.resolve().then(async()=>{if(!req.operator) throw Object.assign(new Error("运营会话无效"),{status:401,code:"OPS_AUTH_REQUIRED"}); req.saasService=await getService(); return fn(req)}).then(v=>ok(res,v,"操作成功",200,req.requestId||Date.now().toString())).catch(e=>fail(res,e,req.requestId));
  app.patch("/ops/v1/tenants/:id/status",run(req=>req.saasService.operatorLaunchService.setTenantStatus(req.operator,req.params.id,req.body?.status,{requestId:req.requestId})));
  app.post("/ops/v1/feature-flags",run(req=>req.saasService.operatorLaunchService.upsertFlag(req.operator,req.body||{},{requestId:req.requestId})));
  app.patch("/ops/v1/feature-flags/:key/overrides",run(req=>req.saasService.operatorLaunchService.setOverride(req.operator,req.params.key,req.body?.tenantId,req.body?.workspaceId,req.body?.enabled,{requestId:req.requestId})));
  app.get("/ops/v1/tenants/:tenantId/workspaces/:workspaceId/diagnostics",run(req=>req.saasService.operatorLaunchService.diagnostics(req.params.tenantId,req.params.workspaceId)));
}
module.exports={registerLaunchV1Routes,registerLaunchV1OpsRoutes};


