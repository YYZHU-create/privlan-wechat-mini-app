const core = require("./common");

exports.main = async event => {
  const id = core.requestId();
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
  let slotReserved = false;
  try {
    await core.enforceRateLimit(openId || core.hash(form.phone), "appointmentCreate", 5, 60 * 60 * 1000);
    if (!form.name || !/^1\d{10}$/.test(form.phone) || !form.serviceId || !form.storeId || !form.date || !form.slotId || !form.advisorId) throw core.createError("INVALID_INPUT", "请完整填写预约信息");
    const slotRecords = await core.searchRecords("FEISHU_SLOTS_TABLE_ID", [{ field: core.fieldName("FEISHU_FIELD_SLOT_ID", "时段ID"), value: form.slotId }], 2);
    const slot = slotRecords[0] || await core.getRecord("FEISHU_SLOTS_TABLE_ID", form.slotId);
    if (!slot) throw core.createError("SLOT_UNAVAILABLE", "所选时段已不存在，请重新选择", 409);
    const capacity = Math.max(1, Number(core.fieldValue(slot, "FEISHU_FIELD_SLOT_CAPACITY", "容量") || 1));
    const booked = Number(core.fieldValue(slot, "FEISHU_FIELD_SLOT_BOOKED", "已预约") || 0);
    if (booked >= capacity) throw core.createError("SLOT_UNAVAILABLE", "该时段已约满，请选择其他时间", 409);
    const duplicates = await core.searchRecords("FEISHU_APPOINTMENTS_TABLE_ID", [
      { field: core.fieldName("FEISHU_FIELD_APPOINTMENT_PHONE", "手机号"), value: form.phone },
      { field: core.fieldName("FEISHU_FIELD_APPOINTMENT_SLOT_ID", "时段ID"), value: form.slotId }
    ], 2);
    if (duplicates.length) throw core.createError("DUPLICATE_APPOINTMENT", "你已经预约过这个时段，请勿重复提交", 409);
    await core.reserveSlot(form.slotId, capacity);
    slotReserved = true;
    const number = `PV${new Date().toISOString().slice(2, 10).replace(/-/g, "")}${Math.random().toString().slice(2, 6)}`;
    const fields = {
      [core.fieldName("FEISHU_FIELD_APPOINTMENT_NUMBER", "预约编号")]: number,
      [core.fieldName("FEISHU_FIELD_APPOINTMENT_NAME", "姓名")]: form.name,
      [core.fieldName("FEISHU_FIELD_APPOINTMENT_PHONE", "手机号")]: form.phone,
      [core.fieldName("FEISHU_FIELD_APPOINTMENT_SERVICE", "服务")]: form.serviceId,
      [core.fieldName("FEISHU_FIELD_APPOINTMENT_STORE_ID", "门店ID")]: form.storeId,
      [core.fieldName("FEISHU_FIELD_APPOINTMENT_DATE", "日期")]: form.date,
      [core.fieldName("FEISHU_FIELD_APPOINTMENT_SLOT_ID", "时段ID")]: form.slotId,
      [core.fieldName("FEISHU_FIELD_APPOINTMENT_ADVISOR_ID", "顾问ID")]: form.advisorId,
      [core.fieldName("FEISHU_FIELD_APPOINTMENT_NOTES", "备注")]: form.notes,
      [core.fieldName("FEISHU_FIELD_APPOINTMENT_STATUS", "状态")]: "待确认",
      [core.fieldName("FEISHU_FIELD_APPOINTMENT_SOURCE", "来源")]: "微信小程序"
    };
    const appointment = await core.createRecord("FEISHU_APPOINTMENTS_TABLE_ID", fields);
    await core.updateRecord("FEISHU_SLOTS_TABLE_ID", slot.record_id, { [core.fieldName("FEISHU_FIELD_SLOT_BOOKED", "已预约")]: booked + 1 });
    let storeName = form.storeId;
    let advisorName = form.advisorId;
    try {
      const stores = await core.searchRecords("FEISHU_STORES_TABLE_ID", [{ field: core.fieldName("FEISHU_FIELD_STORE_ID", "门店ID"), value: form.storeId }], 1);
      const advisors = await core.searchRecords("FEISHU_ADVISORS_TABLE_ID", [{ field: core.fieldName("FEISHU_FIELD_ADVISOR_ID", "顾问ID"), value: form.advisorId }], 1);
      storeName = stores[0] ? core.fieldValue(stores[0], "FEISHU_FIELD_STORE_NAME", "门店名称") : storeName;
      advisorName = advisors[0] ? core.fieldValue(advisors[0], "FEISHU_FIELD_ADVISOR_NAME", "姓名") : advisorName;
    } catch (error) {}
    await core.audit("appointment_created", openId, { appointmentId: appointment && appointment.record_id, phone: form.phone, slotId: form.slotId });
    return core.ok({ number, storeName, advisorName, date: form.date, slotLabel: core.fieldValue(slot, "FEISHU_FIELD_SLOT_LABEL", "时间") || core.fieldValue(slot, "FEISHU_FIELD_SLOT_START", "开始时间") }, "预约已提交", id);
  } catch (error) {
    if (slotReserved) await core.releaseSlot(form.slotId);
    await core.audit("appointment_failed", openId, { code: error.code || "UNKNOWN", phone: form.phone, slotId: form.slotId });
    return core.handleError(error, id);
  }
};
