Component({
  properties: {
    enabled: { type: Boolean, value: true },
    icon: { type: String, value: "/images/icon-headset.png" },
    size: { type: Number, value: 88 },
    right: { type: Number, value: 24 },
    bottom: { type: Number, value: 150 }
  },

  data: {
    positionRight: 24,
    positionBottom: 150,
    dragging: false
  },

  lifetimes: {
    ready() {
      this.restorePosition();
    }
  },

  methods: {
    viewport() {
      const win = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
      const width = win.windowWidth || win.screenWidth || 375;
      const height = win.windowHeight || win.screenHeight || 667;
      const ratio = 750 / width;
      return {
        ratio,
        maxRight: Math.max(8, Math.round(750 - this.properties.size - 8)),
        maxBottom: Math.max(112, Math.round(height * ratio - this.properties.size - 8))
      };
    },

    restorePosition() {
      const saved = wx.getStorageSync("privlan-service-bot-position") || {};
      const viewport = this.viewport();
      const clamp = (value, min, max, fallback) => Math.max(min, Math.min(max, Number(value ?? fallback) || fallback));
      this.setData({
        positionRight: clamp(saved.right, 8, viewport.maxRight, this.properties.right),
        positionBottom: clamp(saved.bottom, 112, viewport.maxBottom, this.properties.bottom)
      });
    },

    onTouchStart(event) {
      const point = event.touches && event.touches[0];
      if (!point) return;
      this.dragState = {
        startX: point.clientX,
        startY: point.clientY,
        right: this.data.positionRight,
        bottom: this.data.positionBottom,
        moved: false
      };
    },

    onTouchMove(event) {
      const point = event.touches && event.touches[0];
      const drag = this.dragState;
      if (!point || !drag) return;
      const viewport = this.viewport();
      const dxPx = point.clientX - drag.startX;
      const dyPx = point.clientY - drag.startY;
      if (Math.hypot(dxPx, dyPx) >= 8) drag.moved = true;
      if (!drag.moved) return;
      const right = Math.max(8, Math.min(viewport.maxRight, Math.round(drag.right - dxPx * viewport.ratio)));
      const bottom = Math.max(112, Math.min(viewport.maxBottom, Math.round(drag.bottom - dyPx * viewport.ratio)));
      this.setData({ positionRight: right, positionBottom: bottom, dragging: true });
    },

    onTouchEnd() {
      const drag = this.dragState;
      this.dragState = null;
      this.setData({ dragging: false });
      if (!drag) return;
      if (drag.moved) {
        wx.setStorageSync("privlan-service-bot-position", {
          right: this.data.positionRight,
          bottom: this.data.positionBottom
        });
        return;
      }
      wx.navigateTo({ url: "/pages/service-chat/index" });
    },

    onTouchCancel() {
      this.dragState = null;
      this.setData({ dragging: false });
    }
  }
});
