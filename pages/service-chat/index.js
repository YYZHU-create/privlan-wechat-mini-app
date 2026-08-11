const api = require("../../utils/service-api");
const fallbackConfig = require("../../utils/service-config");

function message(role, text, extra = {}) {
  return { id: `message-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, role, text, type: "text", items: [], ...extra };
}

Page({
  data: {
    messages: [],
    quickPrompts: fallbackConfig.quickPrompts,
    draft: "",
    sending: false,
    scrollTarget: "message-end",
    humanServiceEnabled: false,
    authMode: "test",
    authOpen: false,
    authLoading: false,
    authError: "",
    authForm: { memberNo: "", phone: "", code: "" }
  },

  async onLoad() {
    const result = await api.serviceBootstrap();
    const config = result.data || fallbackConfig;
    this.setData({
      quickPrompts: Array.isArray(config.quickPrompts) ? config.quickPrompts : fallbackConfig.quickPrompts,
      humanServiceEnabled: config.humanServiceEnabled === true,
      authMode: config.authMode === "wechat" ? "wechat" : "test",
      messages: [message("assistant", config.welcomeMessage || fallbackConfig.welcomeMessage)]
    });
    this.scrollToEnd();
  },

  onUnload() {
    this.setData({ messages: [], draft: "", authForm: { memberNo: "", phone: "", code: "" } });
  },

  noop() {},
  onDraftInput(event) { this.setData({ draft: event.detail.value }); },
  selectPrompt(event) { this.handleQuestion(event.currentTarget.dataset.text); },
  retryMessage(event) { this.handleQuestion(event.currentTarget.dataset.text); },
  sendDraft() {
    const text = String(this.data.draft || "").trim();
    if (!text || this.data.sending) return;
    this.setData({ draft: "" });
    this.handleQuestion(text);
  },

  async handleQuestion(text) {
    const question = String(text || "").trim();
    if (!question || this.data.sending) return;
    this.append(message("user", question));

    if (/预约/.test(question)) {
      this.append(message("assistant", "可以。请进入预约页选择门店、日期、时间与顾问，提交后我们会为你保留预约。", { action: "appointment" }));
      return;
    }
    if (/量体|尺寸|身材数据|我的数据/.test(question)) {
      const token = getApp().globalData.customerSessionToken;
      if (token) await this.loadMeasurements(token);
      else this.append(message("assistant", "量体信息属于私人数据，请先完成身份验证。", { action: "measurements" }));
      return;
    }
    if (/人工|顾问/.test(question)) {
      this.append(message("assistant", this.data.humanServiceEnabled ? "点击下方按钮即可联系人工顾问。" : "微信原生客服尚未在公众平台开通，当前暂时无法转接人工。", { action: "human" }));
      return;
    }

    this.setData({ sending: true });
    this.scrollToEnd();
    const result = await api.serviceQuery({ text: question });
    this.setData({ sending: false });
    if (result.ok) {
      const response = result.data || {};
      this.append(message("assistant", response.text || result.message || "已收到你的问题。", { type: response.type || "faq", action: response.action || "" }));
    } else {
      this.append(message("assistant", result.message || "暂时无法获取回答，请稍后重试。", { type: "error", retryText: question }));
    }
  },

  append(item) {
    this.setData({ messages: [...this.data.messages, item] });
    this.scrollToEnd();
  },
  scrollToEnd() { setTimeout(() => this.setData({ scrollTarget: "message-end" }), 30); },
  openAppointment() { wx.navigateTo({ url: "/pages/appointment/index" }); },
  openAuthentication() { this.setData({ authOpen: true, authError: "" }); },
  closeAuthentication() { if (!this.data.authLoading) this.setData({ authOpen: false, authError: "" }); },
  onAuthInput(event) {
    const field = event.currentTarget.dataset.field;
    this.setData({ [`authForm.${field}`]: event.detail.value, authError: "" });
  },

  async verifyTestIdentity() {
    const form = this.data.authForm;
    if (!form.memberNo.trim()) return this.setData({ authError: "请输入会员号" });
    if (!/^1\d{10}$/.test(form.phone)) return this.setData({ authError: "请输入正确的 11 位手机号" });
    if (!form.code.trim()) return this.setData({ authError: "请输入测试验证码" });
    this.setData({ authLoading: true, authError: "" });
    const result = await api.verifyTestCustomer(form);
    this.setData({ authLoading: false });
    if (!result.ok) return this.setData({ authError: result.message || "身份验证失败" });
    getApp().globalData.customerSessionToken = result.data.sessionToken;
    this.setData({ authOpen: false, authForm: { memberNo: "", phone: "", code: "" } });
    await this.loadMeasurements(result.data.sessionToken);
  },

  async verifyWechatIdentity(event) {
    if (!event.detail.code) return this.setData({ authError: "未获得手机号授权" });
    this.setData({ authLoading: true, authError: "" });
    const result = await api.verifyWechatPhone(event.detail.code);
    this.setData({ authLoading: false });
    if (!result.ok) return this.setData({ authError: result.message || "手机号验证失败" });
    getApp().globalData.customerSessionToken = result.data.sessionToken;
    this.setData({ authOpen: false });
    await this.loadMeasurements(result.data.sessionToken);
  },

  async loadMeasurements(token) {
    this.setData({ sending: true });
    const result = await api.loadMeasurements(token);
    this.setData({ sending: false });
    if (!result.ok) {
      getApp().globalData.customerSessionToken = "";
      this.append(message("assistant", result.message || "量体信息读取失败，请重新验证。", { type: "error", action: "measurements" }));
      return;
    }
    this.append(message("assistant", "以下是与你当前身份绑定的完整量体信息：", { type: "measurement", items: result.data.items || [] }));
  },

  humanServiceOpened() {},
  showHumanUnavailable() { wx.showModal({ title: "人工客服暂未开通", content: "请先在微信公众平台开通小程序客服，再到后台“智能客服”中启用。", showCancel: false }); }
});
