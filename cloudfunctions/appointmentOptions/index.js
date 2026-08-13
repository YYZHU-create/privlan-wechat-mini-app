const core = require("./common");

function dateParts(value) {
  const date = /^\d{4}-\d{2}-\d{2}$/.test(String(value)) ? new Date(`${value}T00:00:00+08:00`) : new Date(Number(value) || value);
  if (Number.isNaN(date.getTime())) return null;
  const formatter = new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" });
  const parts = Object.fromEntries(formatter.formatToParts(date).map(item => [item.type, item.value]));
  const iso = `${parts.year}-${parts.month}-${parts.day}`;
  return { value: iso, day: parts.day, month: `${Number(parts.month)}月`, weekday: new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", weekday: "short" }).format(date) };
}

function minutesFromLabel(value) {
  const match = String(value || "").match(/(\d{1,2}):(\d{2})/);
  return match ? Number(match[1]) * 60 + Number(match[2]) : -1;
}

exports.main = async event => {
  const id = core.requestId();
  try {
    const storeConditions = [{ field: core.fieldName("FEISHU_FIELD_ENABLED", "启用"), value: "是" }];
    let stores = await core.searchRecords("FEISHU_STORES_TABLE_ID", storeConditions, 100);
    if (!stores.length) stores = await core.searchRecords("FEISHU_STORES_TABLE_ID", [], 100);
    const storeItems = stores.map(record => ({
      id: core.fieldValue(record, "FEISHU_FIELD_STORE_ID", "门店ID") || record.record_id,
      name: core.fieldValue(record, "FEISHU_FIELD_STORE_NAME", "门店名称"),
      address: core.fieldValue(record, "FEISHU_FIELD_STORE_ADDRESS", "地址")
    })).filter(item => item.name);
    const storeId = String(event.storeId || storeItems[0]?.id || "");
    const slotConditions = storeId ? [{ field: core.fieldName("FEISHU_FIELD_SLOT_STORE_ID", "门店ID"), value: storeId }] : [];
    const slotRecords = await core.searchRecords("FEISHU_SLOTS_TABLE_ID", slotConditions, 500);
    const normalizedSlots = slotRecords.map(record => {
      const date = dateParts(core.fieldValue(record, "FEISHU_FIELD_SLOT_DATE", "日期"));
      const capacity = Number(core.fieldValue(record, "FEISHU_FIELD_SLOT_CAPACITY", "容量") || 1);
      const booked = Number(core.fieldValue(record, "FEISHU_FIELD_SLOT_BOOKED", "已预约") || 0);
      return {
        id: core.fieldValue(record, "FEISHU_FIELD_SLOT_ID", "时段ID") || record.record_id,
        recordId: record.record_id, date, capacity, booked,
        label: core.fieldValue(record, "FEISHU_FIELD_SLOT_LABEL", "时间") || core.fieldValue(record, "FEISHU_FIELD_SLOT_START", "开始时间"),
        advisorIds: String(core.fieldValue(record, "FEISHU_FIELD_SLOT_ADVISOR_IDS", "顾问ID") || "").split(/[，,、]/).map(value => value.trim()).filter(Boolean),
        available: booked < capacity && !["关闭", "停用"].includes(core.fieldValue(record, "FEISHU_FIELD_SLOT_STATUS", "状态"))
      };
    }).filter(item => item.date && item.label);
    const selectedDate = String(event.date || normalizedSlots.find(item => item.available)?.date.value || "");
    const dateMap = new Map();
    normalizedSlots.filter(item => item.available).forEach(item => dateMap.set(item.date.value, item.date));
    const durationMinutes = Math.max(30, Math.min(480, Number(core.env("APPOINTMENT_DURATION_MINUTES", "135")) || 135));
    const appointmentRecords = selectedDate ? await core.searchRecords("FEISHU_APPOINTMENTS_TABLE_ID", [
      { field: core.fieldName("FEISHU_FIELD_APPOINTMENT_STORE_ID", "门店ID"), value: storeId },
      { field: core.fieldName("FEISHU_FIELD_APPOINTMENT_DATE", "日期"), value: selectedDate }
    ], 500) : [];
    const intervals = appointmentRecords.filter(record => !["已取消", "取消"].includes(core.fieldValue(record, "FEISHU_FIELD_APPOINTMENT_STATUS", "状态"))).map(record => {
      const start = Number(core.fieldValue(record, "FEISHU_FIELD_APPOINTMENT_START_AT", "开始时间"));
      const end = Number(core.fieldValue(record, "FEISHU_FIELD_APPOINTMENT_END_AT", "结束时间"));
      return { start, end: end || start + durationMinutes * 60000 };
    }).filter(item => Number.isFinite(item.start));
    const visibleSlots = normalizedSlots.filter(item => item.date.value === selectedDate).map(item => {
      const startMinutes = minutesFromLabel(item.label);
      const start = startMinutes >= 0 ? new Date(`${selectedDate}T${String(Math.floor(startMinutes / 60)).padStart(2, "0")}:${String(startMinutes % 60).padStart(2, "0")}:00+08:00`).getTime() : NaN;
      const end = start + durationMinutes * 60000;
      const conflicts = intervals.some(interval => start < interval.end && end > interval.start);
      return { ...item, available: item.available && !conflicts, endLabel: Number.isFinite(end) ? new Date(end).toLocaleTimeString("zh-CN", { timeZone: "Asia/Shanghai", hour: "2-digit", minute: "2-digit", hour12: false }) : "" };
    });
    let advisorRecords = storeId ? await core.searchRecords("FEISHU_ADVISORS_TABLE_ID", [{ field: core.fieldName("FEISHU_FIELD_ADVISOR_STORE_ID", "门店ID"), value: storeId }], 100) : [];
    const allowedAdvisorIds = new Set(visibleSlots.flatMap(item => item.advisorIds));
    const advisors = advisorRecords.map(record => ({
      id: core.fieldValue(record, "FEISHU_FIELD_ADVISOR_ID", "顾问ID") || record.record_id,
      name: core.fieldValue(record, "FEISHU_FIELD_ADVISOR_NAME", "姓名"),
      title: core.fieldValue(record, "FEISHU_FIELD_ADVISOR_TITLE", "职位"),
      avatar: core.fieldValue(record, "FEISHU_FIELD_ADVISOR_AVATAR", "头像")
    })).filter(item => item.name && (!allowedAdvisorIds.size || allowedAdvisorIds.has(item.id)));
    const services = core.env("APPOINTMENT_SERVICES", "量体与定制咨询|量体、版型与面料建议;成衣选购咨询|系列与尺码建议").split(";").map((entry, index) => {
      const [name, description] = entry.split("|");
      return { id: `service-${index + 1}`, name, description: description || "" };
    }).filter(item => item.name);
    return core.ok({ services, stores: storeItems, dates: [...dateMap.values()].sort((a, b) => a.value.localeCompare(b.value)), slots: visibleSlots.map(({ recordId, advisorIds, capacity, booked, date, ...slot }) => ({ ...slot, label: slot.endLabel ? `${slot.label}–${slot.endLabel}` : slot.label })), advisors, durationMinutes }, "预约选项读取成功", id);
  } catch (error) {
    return core.handleError(error, id);
  }
};
