const api = require("../../utils/service-api");
const appointmentConfig = require("../../utils/appointment-config");
const serviceConfig = require("../../utils/service-config");

Page({
  data: {
    appointmentConfig,
    serviceBot: serviceConfig,
    loading: true,
    submitting: false,
    loadError: "",
    services: [], stores: [], dates: [], slots: [], advisors: [],
    form: { name: "", phone: "", serviceId: "", storeId: "", date: "", slotId: "", advisorId: "", notes: "" },
    errors: {},
    success: null
  },

  onLoad() { this.loadOptions(); },

  async loadOptions(extra = {}) {
    this.setData({ loading: true, loadError: "" });
    const form = this.data.form;
    const result = await api.loadAppointmentOptions({ storeId: form.storeId, date: form.date, serviceId: form.serviceId, advisorId: form.advisorId, ...extra });
    if (!result.ok) {
      this.setData({ loading: false, loadError: result.message || "可预约信息读取失败，请稍后重试" });
      return;
    }
    const data = result.data || {};
    const nextForm = { ...form };
    if (!nextForm.serviceId && data.services?.[0]) nextForm.serviceId = data.services[0].id;
    if (!nextForm.storeId && data.stores?.[0]) nextForm.storeId = data.stores[0].id;
    if (!nextForm.date && data.dates?.[0]) nextForm.date = data.dates[0].value;
    if (!nextForm.advisorId && !appointmentConfig.fields.advisor) nextForm.advisorId = data.advisors?.[0]?.id || "unassigned";
    if (nextForm.slotId && !data.slots?.some(item => item.id === nextForm.slotId && item.available !== false)) nextForm.slotId = "";
    this.setData({
      loading: false,
      services: data.services || [], stores: data.stores || [], dates: data.dates || [],
      slots: data.slots || [], advisors: data.advisors || [], form: nextForm
    });
    if ((!form.storeId && nextForm.storeId) || (!form.date && nextForm.date)) this.loadOptions({ storeId: nextForm.storeId, date: nextForm.date, serviceId: nextForm.serviceId });
  },

  onInput(event) {
    const field = event.currentTarget.dataset.field;
    this.setData({ [`form.${field}`]: event.detail.value, [`errors.${field}`]: "" });
  },
  selectService(event) {
    this.setData({ "form.serviceId": event.currentTarget.dataset.value, "form.slotId": "", "form.advisorId": "", "errors.serviceId": "" });
    this.loadOptions({ serviceId: event.currentTarget.dataset.value });
  },
  selectStore(event) {
    this.setData({ "form.storeId": event.currentTarget.dataset.value, "form.date": "", "form.slotId": "", "form.advisorId": "" });
    this.loadOptions({ storeId: event.currentTarget.dataset.value, date: "" });
  },
  selectDate(event) {
    this.setData({ "form.date": event.currentTarget.dataset.value, "form.slotId": "", "form.advisorId": "" });
    this.loadOptions({ date: event.currentTarget.dataset.value });
  },
  selectSlot(event) { this.setData({ "form.slotId": event.currentTarget.dataset.value, "errors.slotId": "" }); },
  selectAdvisor(event) {
    const advisorId = event.currentTarget.dataset.value;
    this.setData({ "form.advisorId": advisorId, "errors.advisorId": "" });
    this.loadOptions({ advisorId });
  },

  validate() {
    const form = this.data.form;
    const errors = {};
    if (appointmentConfig.fields.name && !form.name.trim()) errors.name = "请输入预约人姓名";
    if (appointmentConfig.fields.phone && !/^1\d{10}$/.test(form.phone)) errors.phone = "请输入正确的 11 位手机号";
    if (appointmentConfig.fields.service && !form.serviceId) errors.serviceId = "请选择预约服务";
    if (appointmentConfig.fields.store && !form.storeId) errors.storeId = "请选择到店门店";
    if ((appointmentConfig.fields.date && !form.date) || (appointmentConfig.fields.time && !form.slotId)) errors.slotId = "请选择预约日期和时间";
    if (appointmentConfig.fields.advisor && !form.advisorId) errors.advisorId = "请选择专属顾问";
    this.setData({ errors });
    return Object.keys(errors).length === 0;
  },

  async submitAppointment() {
    if (!this.validate() || this.data.submitting) return;
    this.setData({ submitting: true });
    const result = await api.createAppointment({ ...this.data.form, sessionToken: getApp().globalData.customerSessionToken || "" });
    this.setData({ submitting: false });
    if (!result.ok) {
      wx.showModal({ title: "预约未提交", content: `${result.message || "请稍后重试"}\n请求编号：${result.requestId || "-"}`, showCancel: false });
      if (result.code === "SLOT_UNAVAILABLE") this.loadOptions();
      return;
    }
    this.setData({ success: result.data });
    const appointments = wx.getStorageSync("privlanAppointments");
    wx.setStorageSync("privlanAppointments", [{ ...result.data, status: "待确认", savedAt: new Date().toISOString() }, ...(Array.isArray(appointments) ? appointments.filter(item => item.number !== result.data.number) : [])].slice(0, 50));
    wx.vibrateShort?.({ type: "light" });
  },
  hotspotAction(event) {
    const value = event.currentTarget.dataset.linkValue || "";
    const clean = value.split("?")[0];
    const tabs = ["/pages/home/home", "/pages/category/category", "/pages/campaign/campaign", "/pages/cart/cart", "/pages/mine/mine"];
    if (tabs.includes(clean)) wx.switchTab({ url: clean });
    else if (event.currentTarget.dataset.linkType === "external") wx.navigateTo({ url: "/pages/webview/webview?url=" + encodeURIComponent(value) });
    else if (value) wx.navigateTo({ url: value });
  },
  finish() { wx.redirectTo({ url: "/pages/my-appointments/index", fail: () => wx.switchTab({ url: "/pages/mine/mine" }) }); }
});
