// 首页 - 角色卡中心
import type { ICharacterListItem } from '../../types/character';
import { getCompletedCharacters, getIncompleteCharacters } from '../../services/storage';
import { toListItem } from '../../types/character';

Page({
  data: {
    scrollLeft: 0,
    // 已完成的角色
    completedCharacters: [
      {
        id: '1',
        name: '丰川祥子',
        introduction: '丰川家的大小姐，Ave Mujica的键盘手，要成为神人的存在，是否是人类未知',
        avatar: '/assets/images/character1.png',
        status: 'completed'
      },
      {
        id: '2',
        name: '三角初华',
        introduction: 'Ave Mujica的主唱，金毛大狗狗，梦想是丰川祥子。',
        avatar: '/assets/images/character2.png',
        status: 'completed'
      },
      {
        id: '3',
        name: '若叶睦',
        introduction: 'AveMujica的吉他手，多重人格，喜欢吃黄瓜',
        avatar: '/assets/images/character3.png',
        status: 'completed'
      }
    ] as ICharacterListItem[],
    // 未完成的角色
    incompleteCharacters: [
      {
        id: '4',
        name: '神秘角色',
        introduction: '创作中的角色...',
        avatar: '/assets/images/character_placeholder.png',
        status: 'incomplete'
      }
    ] as ICharacterListItem[]
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
    const completed = getCompletedCharacters().map(toListItem);
    const incomplete = getIncompleteCharacters().map(toListItem);

    if (completed.length > 0 || incomplete.length > 0) {
      this.setData({
        completedCharacters: completed,
        incompleteCharacters: incomplete,
      });
    }
    // 若无存储数据，保留页面默认的示例数据
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
