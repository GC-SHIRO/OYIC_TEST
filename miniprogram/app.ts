// app.ts
App<IAppOption>({
  globalData: {
    isLoggedIn: false,
    openId: '',
    userInfo: undefined,
  },

  onLaunch() {
    // 预加载 TDesign 图标字体（加快 icon 显示速度）
    wx.loadFontFace({
      global: true,
      family: 't',
      source: 'url("https://tdesign.gtimg.com/icon/0.4.1/fonts/t.woff")',
      success: () => console.log('TDesign icon font loaded'),
      fail: (err) => console.warn('Font load failed:', err),
    });

    // 初始化云开发
    if (!wx.cloud) {
      console.error('请使用 2.2.3 或以上的基础库以使用云能力');
    } else {
      wx.cloud.init({
        env: 'cloud1-0g88vkjh890eca50',
        traceUser: true,
      });
    }

    // 展示本地存储能力
    const logs = wx.getStorageSync('logs') || [];
    logs.unshift(Date.now());
    wx.setStorageSync('logs', logs);

    // 尝试静默登录（检查本地是否有登录状态）
    this.checkLoginStatus();
  },

  // 检查登录状态
  async checkLoginStatus() {
    try {
      const userInfo = wx.getStorageSync('cloudUserInfo');
      if (userInfo && userInfo.openId) {
        this.globalData.isLoggedIn = true;
        this.globalData.openId = userInfo.openId;
        this.globalData.userInfo = userInfo;

        // 后台刷新用户数据
        this.refreshUserInfo(userInfo.openId);
      }
    } catch (e) {
      console.error('检查登录状态失败', e);
    }
  },

  // 后台刷新用户信息
  async refreshUserInfo(openId: string) {
    try {
      const db = wx.cloud.database();
      const res = await db.collection('users').where({ _openid: openId }).get();
      if (res.data && res.data.length > 0) {
        const cloudUser = res.data[0];
        const userInfo = {
          openId: cloudUser._openid,
          nickname: cloudUser.nickname || '创作者',
          avatar: cloudUser.avatar || '',
          balance: cloudUser.balance || 0,
          createdAt: cloudUser.createdAt,
        };
        this.globalData.userInfo = userInfo;
        wx.setStorageSync('cloudUserInfo', userInfo);
      }
    } catch (e) {
      console.error('刷新用户信息失败', e);
    }
  },
})