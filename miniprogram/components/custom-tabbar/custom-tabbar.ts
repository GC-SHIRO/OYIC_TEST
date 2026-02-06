// 自定义 TabBar 组件
Component({
  properties: {
    // 当前激活的 tab
    activeTab: {
      type: String,
      value: 'home'
    }
  },

  methods: {
    onTabTap(e: WechatMiniprogram.TouchEvent) {
      const tab = e.currentTarget.dataset.tab;
      
      if (tab === this.data.activeTab) return;
      
      // 触发事件通知父组件
      this.triggerEvent('change', { tab });
      
      // 切换页面
      const urls: Record<string, string> = {
        home: '/pages/home/home',
        profile: '/pages/profile/profile'
      };
      
      wx.switchTab({
        url: urls[tab]
      });
    }
  }
});
