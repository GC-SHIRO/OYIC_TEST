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
    isDeleteMode: false,
    isExitAnimating: false,
  },

  onLoad() {
    // 首屏：先用本地缓存快速渲染
    this.renderFromLocal();
  },

  onShow() {
    this.setData({ isDeleteMode: false });
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
    this.setCharactersByCards(getCompletedCharacters(), getIncompleteCharacters());
  },

  /** 从云端拉取角色卡并渲染 */
  async loadFromCloud() {
    this.setData({ loading: true });
    try {
      const cards = await fetchCharactersFromCloud();
      const completed = cards.filter(c => c.status === 'completed');
      const incomplete = cards.filter(c => c.status === 'incomplete');
      this.setCharactersByCards(completed, incomplete);
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

  setCharactersByCards(completedCards: ICharacterCard[], incompleteCards: ICharacterCard[]) {
    const visibleIncomplete = incompleteCards.filter(card => card.characterInfo?.name || card.conversationId);
    this.setCharacters(completedCards.map(toListItem), visibleIncomplete.map(toListItem));
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
    if (this.data.isDeleteMode) return;
    const { id, status } = e.currentTarget.dataset;

    if (status === 'incomplete') {
      // 未完成的角色，继续编辑
      wx.navigateTo({ url: `/pages/chat/chat?characterId=${id}` });
    } else {
      // 已完成的角色，查看详情
      wx.navigateTo({ url: `/pages/preview/preview?characterId=${id}&readonly=true` });
    }
  },

  // 长按进入删除编辑模式
  onCardLongPress() {
    if (!this.data.isDeleteMode) {
      this.setData({ isDeleteMode: true });
    }
  },

  // 退出删除编辑模式
  onExitDeleteMode() {
    this.setData({ isExitAnimating: true, isDeleteMode: false });
    setTimeout(() => {
      this.setData({ isExitAnimating: false });
    }, 200);
  },

  // 点击删除按钮
  onDeleteTap(e: WechatMiniprogram.TouchEvent) {
    const { id } = e.currentTarget.dataset;
    if (!id) return;

    wx.showModal({
      title: '删除角色卡',
      content: '确定要删除该角色卡吗？此操作不可恢复。',
      confirmText: '删除',
      confirmColor: '#dc2626',
      success: (res) => {
        if (res.confirm) {
          // 删除角色卡（云端 + 本地）
          deleteCharacter(id);
          this.removeCharacterFromList(id);
        }
      },
    });
  },

  removeCharacterFromList(id: string) {
    const completed = this.data.completedCharacters.filter(item => item.id !== id);
    const incomplete = this.data.incompleteCharacters.filter(item => item.id !== id);
    this.setData({ completedCharacters: completed, incompleteCharacters: incomplete });
  },
});
