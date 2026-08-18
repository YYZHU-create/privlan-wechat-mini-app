const api = require("./utils/service-api");
const appointmentRuntime = require("./utils/appointment-runtime");

App({
  globalData: {
    cart: [],
    cloudReady: false,
    customerSessionToken: "",
    appointmentReminderTemplateId: ""
  },

  onLaunch() {
    if (wx.cloud) {
      wx.cloud.init({ traceUser: true });
      this.globalData.cloudReady = true;
      if (appointmentRuntime.publicStoreId) api.touchCustomer({ publicStoreId: appointmentRuntime.publicStoreId }).catch(() => null);
    }
    const cart = wx.getStorageSync('cart');
    if (Array.isArray(cart)) {
      this.globalData.cart = cart;
    }
  },

  saveCart() {
    wx.setStorageSync('cart', this.globalData.cart);
  },

  addToCart(product) {
    const cart = this.globalData.cart;
    const found = cart.find(item => item.id === product.id);
    if (found) {
      found.count += 1;
    } else {
      cart.push({
        id: product.id,
        name: product.name,
        price: product.price,
        img: product.img,
        count: 1
      });
    }
    this.saveCart();
  },

  removeFromCart(id) {
    this.globalData.cart = this.globalData.cart.filter(item => item.id !== id);
    this.saveCart();
  },

  updateCount(id, count) {
    const item = this.globalData.cart.find(i => i.id === id);
    if (!item) return;
    item.count = count;
    if (item.count <= 0) {
      this.removeFromCart(id);
      return;
    }
    this.saveCart();
  },

  cartTotalCount() {
    return this.globalData.cart.reduce((sum, i) => sum + i.count, 0);
  }
});
