// 我的 - 用户中心页面
interface IUserInfo {
  userId: string;
  nickname: string;
  avatar: string;
}

interface IWork {
  id: string;
  name: string;
  image: string;
  date: string;
}

Page({
  data: {
    userInfo: {
      userId: 'OC2026001',
      nickname: '创作者',
      avatar: ''
    } as IUserInfo,
    works: [] as IWork[],
    balance: 10,
    version: '1.0.0'
  },

  onLoad() {
    this.loadUserInfo();
    this.loadWorks();
  },

  onShow() {
    // 每次显示时刷新作品列表
    this.loadWorks();
    
    // 更新自定义 tabbar 选中状态
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({
        selected: 1
      });
    }
  },

  // 加载用户信息
  loadUserInfo() {
    const userInfo = wx.getStorageSync('userInfo');
    
    if (userInfo) {
      this.setData({ userInfo });
    } else {
      // 获取微信用户信息
      this.setData({
        userInfo: {
          userId: 'OC' + Date.now().toString().slice(-7),
          nickname: '创作者',
          avatar: ''
        }
      });
    }
  },

  // 加载作品列表
  loadWorks() {
    const characterList = wx.getStorageSync('characterList') || [];
    const works: IWork[] = [];
    
    characterList.forEach((id: string) => {
      const character = wx.getStorageSync(`character_${id}`);
      if (character && character.status === 'completed') {
        works.push({
          id: id,
          name: character.name,
          image: character.image || '/assets/images/character_placeholder.png',
          date: this.formatDate(character.createdAt || Date.now())
        });
      }
    });

    // 如果没有作品，显示示例数据
    if (works.length === 0) {
      works.push(
        {
          id: '1',
          name: '丰川祥子',
          image: '/assets/images/character1.png',
          date: '2026-01-28'
        },
        {
          id: '2',
          name: '三角初华',
          image: '/assets/images/character2.png',
          date: '2026-01-25'
        },
        {
          id: '3',
          name: '若叶睦',
          image: '/assets/images/character3.png',
          date: '2026-01-20'
        }
      );
    }

    this.setData({ works });
  },

  // 格式化日期
  formatDate(timestamp: number): string {
    const date = new Date(timestamp);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  },

  // 编辑个人资料
  onEditProfile() {
    wx.showActionSheet({
      itemList: ['修改昵称', '更换头像'],
      success: (res) => {
        if (res.tapIndex === 0) {
          this.editNickname();
        } else if (res.tapIndex === 1) {
          this.changeAvatar();
        }
      }
    });
  },

  // 修改昵称
  editNickname() {
    wx.showModal({
      title: '修改昵称',
      editable: true,
      placeholderText: '请输入新昵称',
      success: (res) => {
        if (res.confirm && res.content) {
          const userInfo = { ...this.data.userInfo, nickname: res.content };
          this.setData({ userInfo });
          wx.setStorageSync('userInfo', userInfo);
          
          wx.showToast({
            title: '修改成功',
            icon: 'success'
          });
        }
      }
    });
  },

  // 更换头像
  changeAvatar() {
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sourceType: ['album', 'camera'],
      success: (res) => {
        const tempFilePath = res.tempFiles[0].tempFilePath;
        const userInfo = { ...this.data.userInfo, avatar: tempFilePath };
        this.setData({ userInfo });
        wx.setStorageSync('userInfo', userInfo);
        
        wx.showToast({
          title: '更换成功',
          icon: 'success'
        });
      }
    });
  },

  // 查看全部作品
  onViewAllWorks() {
    wx.showToast({
      title: '功能开发中',
      icon: 'none'
    });
  },

  // 点击作品
  onWorkTap(e: WechatMiniprogram.TouchEvent) {
    const { id } = e.currentTarget.dataset;
    wx.navigateTo({
      url: `/pages/preview/preview?characterId=${id}&readonly=true`
    });
  },

  // 菜单点击
  onMenuTap(e: WechatMiniprogram.TouchEvent) {
    const { type } = e.currentTarget.dataset;
    
    switch (type) {
      case 'guide':
        this.showGuide();
        break;
      case 'feedback':
        this.showFeedback();
        break;
      case 'recharge':
        this.showRecharge();
        break;
      case 'about':
        this.showAbout();
        break;
    }
  },

  // 使用指南
  showGuide() {
    wx.showModal({
      title: '使用指南',
      content: '1. 点击首页的"+"按钮创建新角色\n2. 与AI对话描述你的角色想法\n3. 确认生成后得到完整的角色信息卡\n4. 所有作品都会保存在"我的"页面',
      showCancel: false
    });
  },

  // 意见反馈
  showFeedback() {
    wx.showModal({
      title: '意见反馈',
      content: '感谢您的反馈！请发送邮件至：feedback@oyic.com',
      showCancel: false
    });
  },

  // 余额充值
  showRecharge() {
    wx.showToast({
      title: '功能开发中',
      icon: 'none'
    });
  },

  // 关于我们
  showAbout() {
    wx.showModal({
      title: '关于O亿C',
      content: 'O亿C是基于AI Agent的原创角色创作灵感助手，帮助ACGN爱好者快速构建专业的角色信息卡。\n\n版本：1.0.0',
      showCancel: false
    });
  }
});
