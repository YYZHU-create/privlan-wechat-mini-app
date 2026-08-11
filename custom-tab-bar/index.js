Component({
  data: {
    selected: 0,
    list: [
    {
        "path": "/pages/home/home",
        "text": "??",
        "icon": "/images/tab-home.png",
        "iconOn": "/images/tab-home-on.png"
    },
    {
        "path": "/pages/category/category",
        "text": "??",
        "icon": "/images/tab-grid.png",
        "iconOn": "/images/tab-grid-on.png"
    },
    {
        "path": "/pages/campaign/campaign",
        "text": "????",
        "center": true,
        "centerIcon": "/images/tab-3-centerIcon-pinterest.gif"
    },
    {
        "path": "/pages/cart/cart",
        "text": "???",
        "icon": "/images/tab-bag.png",
        "iconOn": "/images/tab-bag-on.png"
    },
    {
        "path": "/pages/mine/mine",
        "text": "??",
        "icon": "/images/tab-user.png",
        "iconOn": "/images/tab-user-on.png"
    }
]
  },

  methods: {
    switchTab(e) {
      const { path, index } = e.currentTarget.dataset;
      this.setData({ selected: index });
      wx.switchTab({ url: path });
    }
  }
});
