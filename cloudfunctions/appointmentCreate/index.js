function normalizeDate(value) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(value || ""))) return String(value);
  const date = new Date(Number(value) || value);
  if (Number.isNaN(date.getTime())) return "";
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit"
  }).formatToParts(date).map(item => [item.type, item.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function appointmentServices(core) {
  return core.env("APPOINTMENT_SERVICES", "量体与定制咨询|量体、版型与面料建议;成衣选购咨询|系列与尺码建议")
    .split(";")
    .map((entry, index) => ({ id: `service-${index + 1}`, name: entry.split("|")[0].trim() }))
    .filter(item => item.name);
}

function advisorIds(value) {
  if (Array.isArray(value)) return value.map(String).filter(Boolean);
  return String(value || "").split(/[，,、;；|]/).map(item => item.trim()).filter(Boolean);
}

function createHandler(core) {
  return async event => {
    const requestId = core.requestId();
    const openId = core.currentOpenId();
    const form = {
      name: String(event.name || "").trim().slice(0, 24),
      phone: String(event.phone || "").trim(),
      serviceId: String(event.serviceId || "").trim(),
      storeId: String(event.storeId || "").trim(),
      date: String(event.date || "").trim(),
      slotId: String(event.slotId || "").trim(),
      advisorId: String(event.advisorId || "").trim(),
      notes: String(event.notes || "").trim().slice(0, 300)
    };
    const number = `PV${new Date().toISOString().slice(2, 10).replace(/-/g, "")}${Math.random().toString().slice(2, 6)}`;
    let phase = "validate";
    let slotReserved = false;
    let intervalLocks = [];
    let requestLock = "";
    let appointmentCreated = false;
    try {
      await core.enforceRateLimit(openId || core.hash(form.phone), "appointmentCreate", 5, 60 * 60 * 1000);
      if (!form.name || !/^1\d{10}$/.test(form.phone) || !form.serviceId || !form.storeId || !form.date || !form.slotId || !form.advisorId) {
        throw core.createError("INVALID_INPUT", "请完整填写预约信息");
      }
      if (!appointmentServices(core).some(item => item.id === form.serviceId)) throw core.createError("INVALID_INPUT", "预约服务无效");

      const slotRecords = await core.searchRecords("FEISHU_SLOTS_TABLE_ID", [{ field: core.fieldName("FEISHU_FIELD_SLOT_ID", "时段ID"), value: form.slotId }], 2);
      const slot = slotRecords[0] || await core.getRecord("FEISHU_SLOTS_TABLE_ID", form.slotId);
      if (!slot) throw core.createError("SLOT_UNAVAILABLE", "所选时段已不存在，请重新选择", 409);
      const actualStoreId = String(core.fieldValue(slot, "FEISHU_FIELD_SLOT_STORE_ID", "门店ID") || "");
      const actualDate = normalizeDate(core.fieldValue(slot, "FEISHU_FIELD_SLOT_DATE", "日期"));
      if (!actualStoreId || actualStoreId !== form.storeId || !actualDate || actualDate !== form.date) throw core.createError("INVALID_INPUT", "预约时段与门店或日期不匹配");

      const allowedAdvisors = advisorIds(core.fieldValue(slot, "FEISHU_FIELD_SLOT_ADVISOR_IDS", "顾问ID"));
      if (allowedAdvisors.length && !allowedAdvisors.includes(form.advisorId)) throw core.createError("INVALID_INPUT", "所选顾问不属于该时段");
      const advisorRecords = await core.searchRecords("FEISHU_ADVISORS_TABLE_ID", [{ field: core.fieldName("FEISHU_FIELD_ADVISOR_ID", "顾问ID"), value: form.advisorId }], 2);
      const advisor = advisorRecords[0];
      if (!advisor || String(core.fieldValue(advisor, "FEISHU_FIELD_ADVISOR_STORE_ID", "门店ID") || "") !== actualStoreId) {
        throw core.createError("INVALID_INPUT", "所选顾问不属于当前门店");
      }

      const capacity = Math.max(1, Number(core.fieldValue(slot, "FEISHU_FIELD_SLOT_CAPACITY", "容量") || 1));
      const booked = Math.max(0, Number(core.fieldValue(slot, "FEISHU_FIELD_SLOT_BOOKED", "已预约") || 0));
      if (booked >= capacity) throw core.createError("SLOT_UNAVAILABLE", "该时段已约满，请选择其他时间", 409);
      const slotStart = String(core.fieldValue(slot, "FEISHU_FIELD_SLOT_START", "开始时间") || core.fieldValue(slot, "FEISHU_FIELD_SLOT_LABEL", "时间") || "");
      const startMatch = slotStart.match(/(\d{1,2}):(\d{2})/);
      if (!startMatch) throw core.createError("INVALID_INPUT", "时段缺少有效开始时间，请联系门店", 409);
      const startTime = `${startMatch[1].padStart(2, "0")}:${startMatch[2]}`;
      const startAt = new Date(`${actualDate}T${startTime}:00+08:00`);
      if (Number.isNaN(startAt.getTime()) || startAt.getTime() <= Date.now()) throw core.createError("INVALID_INPUT", "预约日期或时间无效");
      const durationMinutes = Math.max(30, Math.min(480, Number(core.env("APPOINTMENT_DURATION_MINUTES", "135")) || 135));
      const endAt = new Date(startAt.getTime() + durationMinutes * 60000);

      phase = "idempotency";
      requestLock = await core.reserveAppointmentRequest({ appointmentNumber: number, openId, phone: form.phone, slotId: form.slotId });
      const duplicates = await core.searchRecords("FEISHU_APPOINTMENTS_TABLE_ID", [
        { field: core.fieldName("FEISHU_FIELD_APPOINTMENT_PHONE", "手机号"), value: form.phone },
        { field: core.fieldName("FEISHU_FIELD_APPOINTMENT_SLOT_ID", "时段ID"), value: form.slotId }
      ], 2);
      if (duplicates.length) throw core.createError("DUPLICATE_APPOINTMENT", "你已经预约过这个时段，请勿重复提交", 409);

      phase = "reserve_interval";
      intervalLocks = await core.reserveAppointmentInterval({ appointmentNumber: number, storeId: actualStoreId, advisorId: form.advisorId, startAt: startAt.toISOString(), endAt: endAt.toISOString() });
      phase = "reserve_capacity";
      await core.reserveSlot(form.slotId, capacity);
      slotReserved = true;

      phase = "create_feishu_appointment";
      const fields = {
        [core.fieldName("FEISHU_FIELD_APPOINTMENT_NUMBER", "预约编号")]: number,
        [core.fieldName("FEISHU_FIELD_APPOINTMENT_NAME", "姓名")]: form.name,
        [core.fieldName("FEISHU_FIELD_APPOINTMENT_PHONE", "手机号")]: form.phone,
        [core.fieldName("FEISHU_FIELD_APPOINTMENT_SERVICE", "服务")]: form.serviceId,
        [core.fieldName("FEISHU_FIELD_APPOINTMENT_STORE_ID", "门店ID")]: actualStoreId,
        [core.fieldName("FEISHU_FIELD_APPOINTMENT_DATE", "日期")]: actualDate,
        [core.fieldName("FEISHU_FIELD_APPOINTMENT_SLOT_ID", "时段ID")]: form.slotId,
        [core.fieldName("FEISHU_FIELD_APPOINTMENT_START_AT", "开始时间")]: startAt.getTime(),
        [core.fieldName("FEISHU_FIELD_APPOINTMENT_END_AT", "结束时间")]: endAt.getTime(),
        [core.fieldName("FEISHU_FIELD_APPOINTMENT_DURATION", "服务时长")]: durationMinutes,
        [core.fieldName("FEISHU_FIELD_APPOINTMENT_ADVISOR_ID", "顾问ID")]: form.advisorId,
        [core.fieldName("FEISHU_FIELD_APPOINTMENT_NOTES", "备注")]: form.notes,
        [core.fieldName("FEISHU_FIELD_APPOINTMENT_STATUS", "状态")]: "待确认",
        [core.fieldName("FEISHU_FIELD_APPOINTMENT_SOURCE", "来源")]: "微信小程序"
      };
      const appointment = await core.createRecord("FEISHU_APPOINTMENTS_TABLE_ID", fields);
      appointmentCreated = true;
      let syncPending = false;
      phase = "update_slot_booked";
      try {
        await core.updateRecord("FEISHU_SLOTS_TABLE_ID", slot.record_id, { [core.fieldName("FEISHU_FIELD_SLOT_BOOKED", "已预约")]: booked + 1 });
      } catch (error) {
        syncPending = true;
        await core.audit("appointment_reconciliation_required", openId, { requestId, appointmentNumber: number, appointmentId: appointment && appointment.record_id, phase, code: error.code || "UPDATE_FAILED" });
      }

      let storeName = actualStoreId;
      let advisorName = core.fieldValue(advisor, "FEISHU_FIELD_ADVISOR_NAME", "姓名") || form.advisorId;
      try {
        const stores = await core.searchRecords("FEISHU_STORES_TABLE_ID", [{ field: core.fieldName("FEISHU_FIELD_STORE_ID", "门店ID"), value: actualStoreId }], 1);
        storeName = stores[0] ? core.fieldValue(stores[0], "FEISHU_FIELD_STORE_NAME", "门店名称") : storeName;
      } catch (error) {}
      const endLabel = endAt.toLocaleTimeString("zh-CN", { timeZone: "Asia/Shanghai", hour: "2-digit", minute: "2-digit", hour12: false });
      const result = { number, storeName, advisorName, date: actualDate, slotLabel: `${startTime}–${endLabel}`, startAt: startAt.toISOString(), endAt: endAt.toISOString(), durationMinutes, syncPending };
      await core.audit("appointment_created", openId, { requestId, appointmentNumber: number, appointmentId: appointment && appointment.record_id, slotId: form.slotId, syncPending });
      try {
        await core.db.collection("privlan_appointment_records").doc(core.hash(number).slice(0, 32)).set({ data: { ...result, openId, status: "待确认", createdAt: core.db.serverDate() } });
      } catch (mirrorError) {
        await core.audit("appointment_record_mirror_failed", openId, { requestId, appointmentNumber: number, code: mirrorError.code || "MIRROR_FAILED" });
      }
      return core.ok(result, syncPending ? "预约已提交，门店数据正在同步" : "预约已提交", requestId);
    } catch (error) {
      if (!appointmentCreated) {
        if (slotReserved) await core.releaseSlot(form.slotId);
        if (intervalLocks.length) await core.releaseAppointmentInterval(intervalLocks, number);
        if (requestLock) await core.releaseAppointmentRequest(requestLock, number);
      } else {
        await core.audit("appointment_reconciliation_required", openId, { requestId, appointmentNumber: number, phase, code: error.code || "UNKNOWN" });
      }
      await core.audit("appointment_failed", openId, { requestId, appointmentNumber: number, phase, code: error.code || "UNKNOWN", slotId: form.slotId });
      return core.handleError(error, requestId);
    }
  };
}

exports.createHandler = createHandler;
exports.main = event => createHandler(require("./common"))(event);
