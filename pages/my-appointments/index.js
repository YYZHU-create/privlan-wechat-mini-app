const api = require("../../utils/service-api");
const appointmentRuntime = require("../../utils/appointment-runtime");

Page({
  data: { upcoming: [], history: [], loading: false, cacheOnly: false, loadError: "" },

  renderAppointments(items) {
    const now = Date.now();
    const normalized = (Array.isArray(items) ? items : []).map(item => ({ ...item, timestamp: new Date(item.startAt || `${item.date}T${String(item.slotLabel || "00:00").slice(0, 5)}:00+08:00`).getTime() || 0 }));
    this.setData({
      upcoming: normalized.filter(item => item.status !== "已取消" && item.timestamp >= now).sort((a, b) => a.timestamp - b.timestamp),
      history: normalized.filter(item => item.status === "已取消" || item.timestamp < now).sort((a, b) => b.timestamp - a.timestamp)
    });
  },

  async onShow() {
    const cached = wx.getStorageSync("privlanAppointments");
    this.renderAppointments(cached);
    this.setData({ loading: true, cacheOnly: false, loadError: "" });
    const result = await api.listAppointments({ publicStoreId: appointmentRuntime.publicStoreId });
    if (!result.ok) {
      this.setData({ loading: false, cacheOnly: true, loadError: result.message || "云端预约读取失败" });
      return;
    }
    const items = Array.isArray(result.data) ? result.data : [];
    wx.setStorageSync("privlanAppointments", items);
    this.renderAppointments(items);
    this.setData({ loading: false, cacheOnly: false, loadError: "" });
  },

  createAppointment() { wx.navigateTo({ url: "/pages/appointment/index" }); },
  openService() { wx.navigateTo({ url: "/pages/service-chat/index" }); },

  async enableReminder(event) {
    const templateId = getApp().globalData.appointmentReminderTemplateId || "";
    if (!templateId) {
      wx.showModal({ title: "提醒模板待配置", content: "请先在微信公众平台配置预约提醒订阅消息模板，并在小程序全局配置模板 ID。", showCancel: false });
      return;
    }
    const number = event.currentTarget.dataset.number;
    try {
      const result = await wx.requestSubscribeMessage({ tmplIds: [templateId] });
      if (result[templateId] !== "accept") return;
      const registration = await api.enableAppointmentReminder({ appointmentNumber: number, templateId });
      if (!registration.ok) {
        wx.showModal({ title: "提醒未开启", content: `${registration.message || "云端登记失败，请稍后重试"}\n请求编号：${registration.requestId || "-"}`, showCancel: false });
        return;
      }
      const items = wx.getStorageSync("privlanAppointments") || [];
      const next = items.map(item => item.number === number ? { ...item, reminderEnabled: true } : item);
      wx.setStorageSync("privlanAppointments", next);
      this.renderAppointments(next);
      wx.showToast({ title: "提醒已开启", icon: "success" });
    } catch (error) {
      wx.showToast({ title: "提醒授权未完成", icon: "none" });
    }
  }
});
