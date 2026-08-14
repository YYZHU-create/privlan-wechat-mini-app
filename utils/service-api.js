const fallbackConfig = require("./service-config");

function requestId() {
  return `client-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeResult(result, fallbackMessage) {
  const payload = result && result.result ? result.result : result;
  if (!payload || typeof payload !== "object") {
    return { ok: false, code: "EMPTY_RESPONSE", message: fallbackMessage, data: null, requestId: requestId() };
  }
  return payload;
}

function callFunction(name, data = {}) {
  if (!wx.cloud || !getApp().globalData.cloudReady) {
    return Promise.resolve({ ok: false, code: "CLOUD_UNAVAILABLE", message: "云服务尚未配置", data: null, requestId: requestId() });
  }
  return wx.cloud.callFunction({ name, data })
    .then(result => normalizeResult(result, "云服务返回了无效数据"))
    .catch(error => ({
      ok: false,
      code: "NETWORK_ERROR",
      message: error && error.errMsg ? error.errMsg : "网络连接失败，请稍后重试",
      data: null,
      requestId: requestId()
    }));
}

function serviceBootstrap() {
  return callFunction("serviceBootstrap").then(result => {
    if (result.ok) return result;
    return {
      ok: true,
      code: "LOCAL_FALLBACK",
      message: "正在使用本地客服配置",
      requestId: result.requestId,
      data: { ...fallbackConfig, faqVersion: "local" }
    };
  });
}

module.exports = {
  callFunction,
  serviceBootstrap,
  serviceQuery: data => callFunction("serviceQuery", data),
  verifyTestCustomer: data => callFunction("customerAuth", { action: "verifyTest", ...data }),
  verifyWechatPhone: phoneCode => callFunction("customerAuth", { action: "verifyWechatPhone", phoneCode }),
  loadMeasurements: sessionToken => callFunction("customerMeasurements", { sessionToken }),
  loadAppointmentOptions: data => callFunction("appointmentOptions", data),
  createAppointment: data => callFunction("appointmentCreate", data),
  listAppointments: () => callFunction("appointmentList"),
  enableAppointmentReminder: data => callFunction("appointmentReminder", { action: "register", ...data })
};
