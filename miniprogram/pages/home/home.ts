// 首页 - 角色卡中心
interface ICharacter {
  id: string;
  name: string;
  description: string;
  image: string;
  status: 'completed' | 'incomplete';
}

Page({
  data: {
    scrollLeft: 0,
    // 已完成的角色
    completedCharacters: [
      {
        id: '1',
        name: '丰川祥子',
        description: '丰川家的大小姐，Ave Mujica的键盘手，要成为神人的存在，是否是人类未知',
        image: '/assets/images/character1.png',
        status: 'completed'
      },
      {
        id: '2',
        name: '三角初华',
        description: 'Ave Mujica的主唱，金毛大狗狗，梦想是丰川祥子。',
        image: '/assets/images/character2.png',
        status: 'completed'
      },
      {
        id: '3',
        name: '若叶睦',
        description: 'AveMujica的吉他手，多重人格，喜欢吃黄瓜',
        image: '/assets/images/character3.png',
        status: 'completed'
      }
    ] as ICharacter[],
    // 未完成的角色
    incompleteCharacters: [
      {
        id: '4',
        name: '神秘角色',
        description: '创作中的角色...',
        image: '/assets/images/character_placeholder.png',
        status: 'incomplete'
      }
    ] as ICharacter[]
  },

  onLoad() {
    // 页面加载时可以从本地存储或服务器获取角色数据
    this.loadCharacters();
  },

  onShow() {
    // 每次显示页面时刷新数据
    this.loadCharacters();
    
    // 更新自定义 tabbar 选中状态
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({
        selected: 0
      });
    }
  },

  // 加载角色数据
  loadCharacters() {
    // TODO: 从本地存储或服务器获取角色列表
    // const characters = wx.getStorageSync('characters') || [];
  },

  // 点击新建角色
  onCreateCharacter() {
    wx.navigateTo({
      url: '/pages/chat/chat'
    });
  },

  // 点击角色卡片
  onCardTap(e: WechatMiniprogram.TouchEvent) {
    const { id, status } = e.currentTarget.dataset;
    
    if (status === 'incomplete') {
      // 未完成的角色，继续编辑
      wx.navigateTo({
        url: `/pages/chat/chat?characterId=${id}`
      });
    } else {
      // 已完成的角色，查看详情
      wx.navigateTo({
        url: `/pages/preview/preview?characterId=${id}&readonly=true`
      });
    }
  }
});
