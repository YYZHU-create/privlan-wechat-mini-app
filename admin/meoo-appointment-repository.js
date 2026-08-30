const { SupabaseAdapterError } = require("./meoo-supabase-adapter");

function createMeooAppointmentRepository({ adapter, rpcName = "atelier_create_appointment" } = {}) {
  if (!adapter || typeof adapter.callRpc !== "function") throw new TypeError("Meoo appointment repository requires an adapter RPC client");
  return {
    async createAppointment(input, context = {}) {
      const scope = input.scope;
      if (!scope?.tenantId || !scope?.workspaceId || !scope?.storeId) throw new SupabaseAdapterError("SCOPE_REQUIRED", "appointment scope is required", 400);
      const result = await adapter.callRpc(rpcName, {
        p_tenant_id: scope.tenantId,
        p_workspace_id: scope.workspaceId,
        p_store_id: scope.storeId,
        p_public_store_id: scope.publicStoreId,
        p_customer_name: String(input.customerName || "").trim().slice(0, 64),
        p_customer_phone: String(input.customerPhone || "").trim(),
        p_openid: String(input.openid || ""),
        p_service_id: input.serviceId || null,
        p_advisor_id: input.advisorId || null,
        p_resource_id: input.resourceId || null,
        p_start_at: input.startAt || null,
        p_slot_key: input.slotId || null,
        p_notes: String(input.notes || "").trim().slice(0, 1000),
        p_idempotency_key: String(input.idempotencyKey || "").trim().slice(0, 128),
        p_request_id: context.requestId || null
      });
      if (result?.code === "APPOINTMENT_CONFLICT") throw new SupabaseAdapterError("APPOINTMENT_CONFLICT", "该时间刚刚被预约，请选择其他时间", 409);
      if (result?.code === "APPOINTMENT_SCOPE_INVALID") throw new SupabaseAdapterError("APPOINTMENT_SCOPE_INVALID", "预约资源无效或不属于当前门店", 400);
      if (!result || result.ok === false) throw new SupabaseAdapterError("DATABASE_UNAVAILABLE", "预约服务暂时不可用", 503);
      return result.data || result;
    }
  };
}

module.exports = { createMeooAppointmentRepository };
