// 自定义 TabBar
Component({
  data: {
    selected: 0,
    color: '#999999',
    selectedColor: '#0052d9',
    list: [
      {
        pagePath: '/pages/home/home',
        text: '首页',
        icon: 'home'
      },
      {
        pagePath: '/pages/profile/profile',
        text: '我的',
        icon: 'user'
      }
    ]
  },

  methods: {
    switchTab(e: WechatMiniprogram.TouchEvent) {
      const data = e.currentTarget.dataset;
      const url = data.path;
      
      wx.switchTab({ url });
    }
  }
});
