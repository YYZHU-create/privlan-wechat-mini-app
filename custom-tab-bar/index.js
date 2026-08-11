Component({
  data: {
    selected: 0,
    list: [
    {
        "path": "/pages/home/home",
        "text": "首页",
        "icon": "/images/tab-home.png",
        "iconOn": "/images/tab-home-on.png"
    },
    {
        "path": "/pages/category/category",
        "text": "分类",
        "icon": "/images/tab-grid.png",
        "iconOn": "/images/tab-grid-on.png"
    },
    {
        "path": "/pages/campaign/campaign",
        "text": "夏季系列",
        "center": true,
        "centerIcon": "/images/tab-3-centerIcon-pinterest.gif"
    },
    {
        "path": "/pages/cart/cart",
        "text": "购物车",
        "icon": "/images/tab-bag.png",
        "iconOn": "/images/tab-bag-on.png"
    },
    {
        "path": "/pages/mine/mine",
        "text": "我的",
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
