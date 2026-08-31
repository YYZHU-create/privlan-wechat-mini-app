const { SupabaseAdapterError } = require("./meoo-supabase-adapter");

function scopeParams(scope) {
  if (!scope?.tenantId || !scope?.workspaceId || !scope?.storeId) throw new SupabaseAdapterError("SCOPE_REQUIRED", "tenant/workspace/store scope is required", 400);
  return { p_tenant_id: scope.tenantId, p_workspace_id: scope.workspaceId, p_store_id: scope.storeId, p_actor_id: scope.userId || null, p_request_id: scope.requestId || null };
}

const messages = {
  CUSTOMER_NOT_FOUND: ["客户不存在", 404], CUSTOMER_SCOPE_INVALID: ["客户不存在", 404],
  APPOINTMENT_NOT_FOUND: ["预约不存在", 404], APPOINTMENT_SCOPE_INVALID: ["预约不存在", 404],
  APPOINTMENT_STATUS_INVALID: ["当前预约状态不能执行该操作", 409],
  MEMBERSHIP_PROGRAM_NOT_FOUND: ["会员计划不存在", 404], MEMBERSHIP_LEVEL_NOT_FOUND: ["会员等级不存在", 404],
  MEMBERSHIP_LEVEL_INVALID: ["会员等级设置无效", 400], NOTE_INVALID: ["备注不能为空", 400],
  POINTS_INVALID: ["积分数量无效", 400], POINTS_INSUFFICIENT: ["积分余额不足", 409],
  IDEMPOTENCY_REQUIRED: ["缺少幂等键", 400], STAFF_NOT_FOUND: ["员工不存在", 404],
  APPOINTMENT_SETTINGS_INVALID: ["预约规则设置无效", 400], STAFF_SCHEDULE_INVALID: ["员工工作时间无效", 400],
  APPOINTMENT_SERVICE_INVALID: ["服务设置无效", 400], APPOINTMENT_SERVICE_NOT_FOUND: ["服务不存在", 404],
  APPOINTMENT_ADVISOR_INVALID: ["服务人员设置无效", 400], APPOINTMENT_ADVISOR_NOT_FOUND: ["服务人员不存在", 404],
  STAFF_INVALID: ["员工设置无效", 400], STAFF_ASSIGNMENT_INVALID: ["员工归属设置无效", 400],
  STAFF_LEAVE_INVALID: ["请假时间无效", 400], STAFF_LEAVE_NOT_FOUND: ["请假记录不存在", 404],
  APPOINTMENT_RESOURCE_IN_USE: ["预约资源正在使用", 409]
};

function normalize(result) {
  if (result?.code && result.code !== "OK") {
    const [message, status] = messages[result.code] || ["操作失败", 400];
    throw new SupabaseAdapterError(result.code, message, status);
  }
  if (!result || result.ok === false) throw new SupabaseAdapterError("DATABASE_UNAVAILABLE", "服务暂时不可用", 503);
  return result.data ?? result;
}

function createMeooCustomerWriteRepository({ adapter } = {}) {
  if (!adapter || typeof adapter.callRpc !== "function") throw new TypeError("Meoo customer write repository requires an adapter RPC client");
  const invoke = async (name, scope, body) => normalize(await adapter.callRpc(name, { ...scopeParams(scope), ...body }));
  return {
    addNote: (scope, customerId, input) => invoke("atelier_customer_add_note", scope, { p_customer_id: customerId, p_content: String(input?.content || "").trim().slice(0, 5000) }),
    adjustPoints: (scope, customerId, input) => invoke("atelier_customer_adjust_points", scope, { p_customer_id: customerId, p_points: Number(input?.points), p_reason: String(input?.reason || "人工调整").slice(0, 200), p_idempotency_key: String(input?.idempotencyKey || "").slice(0, 180) }),
    updateProgram: (scope, input) => invoke("atelier_membership_program_update", scope, { p_enabled: input?.enabled === true, p_points_enabled: input?.pointsEnabled === true }),
    saveLevel: (scope, input, levelId = null) => invoke("atelier_membership_level_save", scope, { p_level_id: levelId, p_name: String(input?.name || "").trim().slice(0, 80), p_level_order: Number(input?.levelOrder), p_growth_threshold: Number(input?.growthThreshold || 0), p_enabled: input?.enabled !== false, p_benefits: input?.benefits || {} })
  };
}

function createMeooAppointmentWriteRepository({ adapter } = {}) {
  if (!adapter || typeof adapter.callRpc !== "function") throw new TypeError("Meoo appointment write repository requires an adapter RPC client");
  const invoke = async (name, scope, body) => normalize(await adapter.callRpc(name, { ...scopeParams(scope), ...body }));
  return {
    updateStatus: (scope, id, status) => invoke("atelier_appointment_status_update", scope, { p_appointment_id: id, p_status: status }),
    createFollowUp: (scope, id, input) => invoke("atelier_appointment_follow_up", scope, { p_appointment_id: id, p_note: String(input?.note || input?.content || "").trim().slice(0, 1000), p_idempotency_key: String(input?.idempotencyKey || "").slice(0, 180) }),
    updateSettings: (scope, input) => invoke("atelier_appointment_settings_update", scope, { p_timezone: input?.timezone, p_slot_interval_minutes: Number(input?.slotIntervalMinutes), p_default_buffer_minutes: Number(input?.defaultBufferMinutes), p_max_advance_days: Number(input?.maxAdvanceDays), p_booking_enabled: input?.bookingEnabled !== false }),
    replaceHours: (scope, hours) => invoke("atelier_appointment_hours_replace", scope, { p_hours: hours || [] }),
    saveService: (scope, input, id = null) => invoke("atelier_appointment_service_save", scope, { p_service_id: id, p_name: String(input?.name || "").trim(), p_description: String(input?.description || ""), p_duration_minutes: Number(input?.durationMinutes), p_buffer_minutes_override: input?.bufferMinutesOverride == null ? null : Number(input.bufferMinutesOverride), p_enabled: input?.enabled !== false, p_sort_order: Number(input?.sortOrder || 0) }),
    saveAdvisor: (scope, input, id = null) => invoke("atelier_appointment_advisor_save", scope, { p_advisor_id: id, p_staff_id: input?.staffId || null, p_name: String(input?.name || "").trim(), p_enabled: input?.enabled !== false, p_sort_order: Number(input?.sortOrder || 0) }),
    saveStaff: (scope, input, id = null) => invoke("atelier_staff_save", scope, { p_staff_id: id, p_display_name: String(input?.displayName || "").trim(), p_title: String(input?.title || "").trim(), p_status: input?.status === "inactive" ? "inactive" : "active", p_public_visible: input?.publicVisible !== false }),
    setStaffCapabilities: (scope, id, serviceIds) => invoke("atelier_staff_capabilities_replace", scope, { p_staff_id: id, p_service_ids: Array.isArray(serviceIds) ? serviceIds : [] }),
    replaceStaffSchedules: (scope, id, schedules) => invoke("atelier_staff_schedules_replace", scope, { p_staff_id: id, p_schedules: schedules || [] }),
    saveStaffLeave: (scope, id, input) => invoke("atelier_staff_leave_create", scope, { p_staff_id: id, p_start_at: input?.startAt, p_end_at: input?.endAt, p_reason: String(input?.reason || "").slice(0, 500) }),
    removeStaffLeave: (scope, id, leaveId) => invoke("atelier_staff_leave_delete", scope, { p_staff_id: id, p_leave_id: leaveId })
  };
}

module.exports = { createMeooCustomerWriteRepository, createMeooAppointmentWriteRepository };
