const cloud = require("wx-server-sdk");

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const command = db.command;

function requestId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function result(ok, code, message, data, id) {
  return { ok, code, message, data: data || null, requestId: id };
}

function env(name, fallback = "") {
  return String(process.env[name] || fallback).trim();
}

function formatDateTime(timestamp) {
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(new Date(timestamp));
}

function reminderData(item) {
  const subjectKey = env("REMINDER_FIELD_SUBJECT", "thing1");
  const timeKey = env("REMINDER_FIELD_TIME", "time2");
  const storeKey = env("REMINDER_FIELD_STORE", "thing3");
  return {
    [subjectKey]: { value: env("REMINDER_SUBJECT", "PRIVLAN 到店预约").slice(0, 20) },
    [timeKey]: { value: formatDateTime(item.startAt) },
    [storeKey]: { value: String(item.storeName || "PRIVLAN").slice(0, 20) }
  };
}

async function register(event, openId, id) {
  const appointmentNumber = String(event.appointmentNumber || "").trim();
  const templateId = String(event.templateId || env("APPOINTMENT_REMINDER_TEMPLATE_ID")).trim();
  if (!openId || !appointmentNumber || !templateId) return result(false, "INVALID_INPUT", "缺少预约或提醒模板信息", null, id);
  const recordId = require("crypto").createHash("sha256").update(appointmentNumber).digest("hex").slice(0, 32);
  let appointment;
  try { appointment = (await db.collection("privlan_appointment_records").doc(recordId).get()).data; } catch (error) {}
  if (!appointment || appointment.openId !== openId) return result(false, "APPOINTMENT_NOT_FOUND", "未找到当前账号的预约记录", null, id);
  const leadMinutes = Math.max(30, Math.min(10080, Number(env("APPOINTMENT_REMINDER_LEAD_MINUTES", "1440")) || 1440));
  const remindAt = Number(appointment.startAt) - leadMinutes * 60000;
  await db.collection("privlan_appointment_reminders").doc(recordId).set({ data: {
    appointmentNumber,
    openId,
    templateId,
    storeName: appointment.storeName,
    startAt: Number(appointment.startAt),
    remindAt,
    status: "pending",
    page: "pages/my-appointments/index",
    updatedAt: db.serverDate()
  } });
  return result(true, "OK", "预约提醒已开启", { appointmentNumber, remindAt }, id);
}

async function sendDue(id) {
  const now = Date.now();
  const due = await db.collection("privlan_appointment_reminders").where({
    status: "pending",
    remindAt: command.lte(now),
    startAt: command.gt(now)
  }).limit(100).get();
  let sent = 0;
  let failed = 0;
  for (const item of due.data || []) {
    try {
      const claimed = await db.runTransaction(async transaction => {
        const reference = transaction.collection("privlan_appointment_reminders").doc(item._id);
        const latest = (await reference.get()).data;
        if (!latest || latest.status !== "pending") return false;
        await reference.update({ data: { status: "sending", attemptedAt: db.serverDate() } });
        return true;
      });
      if (!claimed) continue;
      await cloud.openapi.subscribeMessage.send({
        touser: item.openId,
        page: item.page,
        lang: "zh_CN",
        miniprogramState: env("MINIPROGRAM_STATE", "formal"),
        templateId: item.templateId,
        data: reminderData(item)
      });
      await db.collection("privlan_appointment_reminders").doc(item._id).update({ data: { status: "sent", sentAt: db.serverDate() } });
      sent += 1;
    } catch (error) {
      failed += 1;
      await db.collection("privlan_appointment_reminders").doc(item._id).update({ data: { status: "failed", error: String(error.errMsg || error.message || error).slice(0, 300), failedAt: db.serverDate() } }).catch(() => null);
    }
  }
  return result(true, "OK", "预约提醒任务已完成", { checked: (due.data || []).length, sent, failed }, id);
}

exports.main = async event => {
  const id = requestId();
  try {
    const context = cloud.getWXContext();
    if (event && event.action === "register") return register(event, context.OPENID, id);
    return sendDue(id);
  } catch (error) {
    console.error(id, error);
    return result(false, "SERVICE_UNAVAILABLE", "预约提醒服务暂时不可用", null, id);
  }
};
