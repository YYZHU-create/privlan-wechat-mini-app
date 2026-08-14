function normalizeCreatedAt(value) {
  if (!value) return "";
  const normalized = typeof value.toDate === "function" ? value.toDate() : typeof value.getTime === "function" ? value.getTime() : value.$date || value;
  const date = normalized instanceof Date ? normalized : new Date(normalized);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
}

function createHandler(core) {
  return async () => {
    const requestId = core.requestId();
    try {
      const openId = core.currentOpenId();
      if (!openId) return core.fail("AUTH_REQUIRED", "请先在微信中登录", requestId);
      const result = await core.db.collection("privlan_appointment_records").where({ openId }).limit(100).get();
      const items = (result.data || []).map(item => ({
        number: String(item.number || ""),
        storeName: String(item.storeName || ""),
        advisorName: String(item.advisorName || ""),
        date: String(item.date || ""),
        slotLabel: String(item.slotLabel || ""),
        startAt: item.startAt || "",
        endAt: item.endAt || "",
        status: String(item.status || "待确认"),
        reminderEnabled: Boolean(item.reminderEnabled),
        createdAt: normalizeCreatedAt(item.createdAt)
      })).filter(item => item.number).sort((a, b) => new Date(b.startAt || b.createdAt || 0) - new Date(a.startAt || a.createdAt || 0));
      return core.ok(items, "预约记录读取成功", requestId);
    } catch (error) {
      return core.handleError(error, requestId);
    }
  };
}

exports.createHandler = createHandler;
exports.main = () => createHandler(require("./common"))();
