// 首页 - 角色卡中心
import type { ICharacterListItem, ICharacterCard } from '../../types/character';
import {
  fetchCharactersFromCloud,
  getCompletedCharacters,
  getIncompleteCharacters,
  deleteCharacter,
  PLACEHOLDER_IMAGE,
  getCurrentUserId,
} from '../../services/storage';
import { toListItem } from '../../types/character';

Page({
  data: {
    scrollLeft: 0,
    completedCharacters: [] as ICharacterListItem[],
    incompleteCharacters: [] as ICharacterListItem[],
    loading: false,
  },

  onLoad() {
    // 首屏：先用本地缓存快速渲染
    this.renderFromLocal();
  },

  onShow() {
    // 每次进入都从云端拉取最新数据
    if (getCurrentUserId()) {
      this.loadFromCloud();
    } else {
      // 未登录清空列表
      this.setData({ completedCharacters: [], incompleteCharacters: [] });
    }

    // 更新自定义 tabbar 选中状态
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ selected: 0 });
    }
  },

  /** 从本地缓存快速渲染（首屏用） */
  renderFromLocal() {
    const completed = getCompletedCharacters().map(toListItem);
    const incomplete = getIncompleteCharacters()
      .filter(c => c.characterInfo?.name || c.conversationId)
      .map(toListItem);
    this.setCharacters(completed, incomplete);
  },

  /** 从云端拉取角色卡并渲染 */
  async loadFromCloud() {
    this.setData({ loading: true });
    try {
      const cards = await fetchCharactersFromCloud();
      const completed = cards
        .filter(c => c.status === 'completed')
        .map(toListItem);
      const incomplete = cards
        .filter(c => c.status === 'incomplete')
        .filter(c => c.characterInfo?.name || c.conversationId)
        .map(toListItem);
      this.setCharacters(completed, incomplete);
    } catch (err) {
      console.error('云端加载失败，使用本地缓存:', err);
      this.renderFromLocal();
    } finally {
      this.setData({ loading: false });
    }
  },

  /** 设置角色卡数据到视图 */
  setCharacters(completed: ICharacterListItem[], incomplete: ICharacterListItem[]) {
    const ensureAvatar = (item: ICharacterListItem) => ({
      ...item,
      avatar: item.avatar || PLACEHOLDER_IMAGE,
    });
    this.setData({
      completedCharacters: completed.map(ensureAvatar),
      incompleteCharacters: incomplete.map(ensureAvatar),
    });
  },

  // 点击新建角色 - 弹窗确认（需先登录）
  onCreateCharacter() {
    if (!getCurrentUserId()) {
      wx.showModal({
        title: '请先登录',
        content: '创建角色卡需要先登录账号',
        confirmText: '去登录',
        cancelText: '取消',
        success: (res) => {
          if (res.confirm) {
            wx.switchTab({ url: '/pages/profile/profile' });
          }
        },
      });
      return;
    }

    wx.showModal({
      title: '创建角色',
      content: '即将开始创建一个新的角色卡，是否继续？',
      confirmText: '开始创建',
      cancelText: '取消',
      success: (res) => {
        if (res.confirm) {
          wx.navigateTo({ url: '/pages/chat/chat' });
        }
      },
    });
  },

  // 点击角色卡片
  onCardTap(e: WechatMiniprogram.TouchEvent) {
    const { id, status } = e.currentTarget.dataset;

    if (status === 'incomplete') {
      // 未完成的角色，继续编辑
      wx.navigateTo({ url: `/pages/chat/chat?characterId=${id}` });
    } else {
      // 已完成的角色，查看详情
      wx.navigateTo({ url: `/pages/preview/preview?characterId=${id}&readonly=true` });
    }
  },
});
