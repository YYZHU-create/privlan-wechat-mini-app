Page({
  data: { url: "", error: "", loading: true },
  onLoad(options = {}) {
    let decoded = "";
    try { decoded = decodeURIComponent(String(options.url || "")); } catch (error) {
      return this.setData({ loading: false, error: "链接格式无效" });
    }
    if (!/^https:\/\//i.test(decoded)) return this.setData({ loading: false, error: "仅支持安全的 HTTPS 链接" });
    this.setData({ url: decoded, error: "", loading: true });
  },
  onWebviewLoad() { this.setData({ loading: false }); },
  onWebviewError() { this.setData({ loading: false, error: "页面加载失败，请检查网络或微信业务域名配置" }); },
  goBack() { wx.navigateBack({ fail: () => wx.switchTab({ url: "/pages/home/home" }) }); }
});
