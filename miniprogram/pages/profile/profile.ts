// 我的 - 用户中心页面（基于云开发登录）
import { cloudLogin, updateNickname, updateSignature, uploadAvatar, logout, isLoggedIn, getLocalUserInfo, getCloudUserInfo } from '../../services/user';
import { fetchCharactersFromCloud, getCompletedCharacters, getCurrentUserId, PLACEHOLDER_IMAGE } from '../../services/storage';
import type { ICharacterCard } from '../../types/character';

interface IWork {
  id: string;
  name: string;
  image: string;
  date: string;
}

const app = getApp<IAppOption>();

Page({
  data: {
    // 登录状态
    isLoggedIn: false,
    isLoading: false,

    // 用户信息
    userInfo: {
      openId: '',
      nickname: '微信用户',
      avatar: '',
      balance: 0,
      signature: '',
    },

    // 注册表单（头像+昵称收集）
    showRegisterPopup: false,
    registerAvatar: '',
    registerNickname: '',
    registerSignature: '',

    // 作品列表
    works: [] as IWork[],
    version: '1.0.0',

    // 兑换码弹窗
    redeemPopupVisible: false,
    redeemCode: '',
    redeemLoading: false,
  },

  onLoad() {
    this.checkLogin();
    // 首屏先用本地缓存
    this.renderWorksFromLocal();
  },

  onShow() {
    // 每次进入先显示本地缓存的头像（快速响应），再从云端拉取最新
    if (this.data.isLoggedIn && getCurrentUserId()) {
      // 先用本地缓存更新头像，确保快速显示
      const localUserInfo = getLocalUserInfo();
      if (localUserInfo && localUserInfo.avatar) {
        this.setData({
          userInfo: { ...this.data.userInfo, avatar: localUserInfo.avatar }
        });
      }
      // 后台异步拉取云端最新数据
      this.loadWorksFromCloud();
      this.loadBalanceOverview();
      this.loadProfileFromCloud();
    } else {
      this.setData({ works: [] });
    }

    // 更新自定义 tabbar 选中状态
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ selected: 1 });
    }
  },

  // 拉取用户信息（含个性签名）并同步到本地缓存
  async loadProfileFromCloud() {
    try {
      const cloudUser = await getCloudUserInfo();
      if (!cloudUser) return;

      const userInfo = {
        ...this.data.userInfo,
        nickname: cloudUser.nickname || this.data.userInfo.nickname,
        avatar: cloudUser.avatar || this.data.userInfo.avatar,
        signature: cloudUser.signature || '',
        balance: cloudUser.balance ?? this.data.userInfo.balance,
      };

      this.setData({ userInfo });
      wx.setStorageSync('cloudUserInfo', userInfo);
    } catch (err) {
      console.error('获取用户信息失败:', err);
    }
  },

  // 拉取最新余额，保证创作点实时更新
  async loadBalanceOverview() {
    try {
      const res = await wx.cloud.callFunction({
        name: 'billing',
        data: { action: 'overview' },
      });

      const result = res.result as any;
      if (result.code === 0 && result.data) {
        const balance = result.data.balance ?? 0;
        const userInfo = { ...this.data.userInfo, balance };
        this.setData({ userInfo });

        const cached = wx.getStorageSync('cloudUserInfo') || {};
        cached.balance = balance;
        wx.setStorageSync('cloudUserInfo', cached);
      }
    } catch (err) {
      console.error('获取余额失败:', err);
    }
  },

  // ========== 登录相关 ==========

  /**
   * 检查本地登录状态
   */
  checkLogin() {
    const loggedIn = isLoggedIn();
    if (loggedIn) {
      const userInfo = getLocalUserInfo();
      if (userInfo) {
        this.setData({
          isLoggedIn: true,
          userInfo: {
            openId: userInfo.openId,
            nickname: userInfo.nickname || '创作者',
            avatar: userInfo.avatar || '',
            balance: userInfo.balance || 0,
            signature: userInfo.signature || '',
          },
        });
      }
    } else {
      this.setData({ isLoggedIn: false });
    }
  },

  /**
   * 点击登录按钮 - 先调用云函数获取openId，再弹出注册弹窗收集信息
   */
  async onLoginTap() {
    if (this.data.isLoading) return;
    this.setData({ isLoading: true });

    try {
      // 先调用云函数登录获取 openId
      const userData = await cloudLogin();

      if (userData.isNewUser || !userData.nickname) {
        // 新用户或没有昵称的用户，弹出信息收集弹窗
        this.setData({
          isLoading: false,
          showRegisterPopup: true,
          registerAvatar: '',
          registerNickname: '',
          registerSignature: '',
          userInfo: {
            openId: userData.openId,
            nickname: userData.nickname || '微信用户',
            avatar: userData.avatar || '',
            balance: userData.balance || 0,
            signature: userData.signature || '',
          },
        });
      } else {
        // 已有完整信息的老用户
        this.setData({
          isLoggedIn: true,
          isLoading: false,
          userInfo: {
            openId: userData.openId,
            nickname: userData.nickname,
            avatar: userData.avatar,
            balance: userData.balance || 0,
            signature: userData.signature || '',
          },
        });
        app.globalData.isLoggedIn = true;
        app.globalData.openId = userData.openId;
        app.globalData.userInfo = userData;

        wx.showToast({ title: '登录成功', icon: 'success' });

        // 登录后从云端拉取作品
        this.loadWorksFromCloud();
      }
    } catch (err) {
      console.error('登录失败:', err);
      this.setData({ isLoading: false });
      wx.showToast({ title: '登录失败，请重试', icon: 'none' });
    }
  },

  /**
   * 用户选择头像（微信头像快填）
   */
  onChooseAvatar(e: any) {
    const { avatarUrl } = e.detail;
    if (avatarUrl) {
      this.setData({ registerAvatar: avatarUrl });
    }
  },

  /**
   * 用户输入昵称
   */
  onNicknameInput(e: any) {
    this.setData({ registerNickname: e.detail.value || '' });
  },

  /**
   * 用户输入个性签名
   */
  onSignatureInput(e: any) {
    this.setData({ registerSignature: e.detail.value || '' });
  },

  /**
   * 确认注册信息
   */
  async onRegisterConfirm() {
    const { registerAvatar, registerNickname } = this.data;

    if (!registerNickname.trim()) {
      wx.showToast({ title: '请输入昵称', icon: 'none' });
      return;
    }

    this.setData({ isLoading: true });

    try {
      // 上传头像
      let avatarUrl = '';
      if (registerAvatar) {
        avatarUrl = await uploadAvatar(registerAvatar);
      }

      // 更新昵称和签名
      await updateNickname(registerNickname.trim());
      if (this.data.registerSignature.trim()) {
        await updateSignature(this.data.registerSignature.trim());
      }

      const userInfo = {
        openId: this.data.userInfo.openId,
        nickname: registerNickname.trim(),
        avatar: avatarUrl || this.data.userInfo.avatar,
        balance: this.data.userInfo.balance,
        signature: this.data.registerSignature.trim() || '',
      };

      // 更新本地缓存
      wx.setStorageSync('cloudUserInfo', userInfo);

      this.setData({
        isLoggedIn: true,
        isLoading: false,
        showRegisterPopup: false,
        userInfo,
      });

      app.globalData.isLoggedIn = true;
      app.globalData.openId = userInfo.openId;
      app.globalData.userInfo = userInfo;

      wx.showToast({ title: '注册成功', icon: 'success' });

      // 注册后从云端拉取作品
      this.loadWorksFromCloud();
    } catch (err) {
      console.error('注册失败:', err);
      this.setData({ isLoading: false });
      wx.showToast({ title: '注册失败，请重试', icon: 'none' });
    }
  },

  /**
   * 取消注册弹窗
   */
  onRegisterCancel() {
    this.setData({ showRegisterPopup: false });
  },

  /**
   * 退出登录
   */
  onLogout() {
    wx.showModal({
      title: '退出登录',
      content: '确定要退出登录吗？',
      success: (res) => {
        if (res.confirm) {
          logout();
          app.globalData.isLoggedIn = false;
          app.globalData.openId = '';
          app.globalData.userInfo = undefined;

          this.setData({
            isLoggedIn: false,
            userInfo: {
              openId: '',
              nickname: '微信用户',
              avatar: '',
              balance: 0,
              signature: '',
            },
            works: [], // 退出登录时清空作品列表
          });

          wx.showToast({ title: '已退出', icon: 'success' });
        }
      },
    });
  },

  // ========== 用户信息编辑 ==========

  onEditProfile() {
    if (!this.data.isLoggedIn) {
      this.onLoginTap();
      return;
    }
    wx.showActionSheet({
      itemList: ['修改昵称', '更换头像', '修改签名'],
      success: (res) => {
        if (res.tapIndex === 0) {
          this.editNickname();
        } else if (res.tapIndex === 1) {
          this.changeAvatar();
        } else if (res.tapIndex === 2) {
          this.editSignature();
        }
      },
    });
  },

  async editNickname() {
    wx.showModal({
      title: '修改昵称',
      editable: true,
      placeholderText: '请输入新昵称',
      success: async (res) => {
        if (res.confirm && res.content) {
          wx.showLoading({ title: '保存中...' });
          const success = await updateNickname(res.content);
          wx.hideLoading();

          if (success) {
            const userInfo = { ...this.data.userInfo, nickname: res.content };
            this.setData({ userInfo });

            if (app.globalData.userInfo) {
              app.globalData.userInfo.nickname = res.content;
            }

            wx.showToast({ title: '修改成功', icon: 'success' });
          } else {
            wx.showToast({ title: '修改失败', icon: 'none' });
          }
        }
      },
    });
  },

  async editSignature() {
    wx.showModal({
      title: '修改个性签名',
      editable: true,
      placeholderText: this.data.userInfo.signature || '写一句个性签名吧',
      success: async (res) => {
        if (res.confirm && res.content !== undefined) {
          wx.showLoading({ title: '保存中...' });
          const success = await updateSignature(res.content.trim());
          wx.hideLoading();

          if (success) {
            const userInfo = { ...this.data.userInfo, signature: res.content.trim() };
            this.setData({ userInfo });

            if (app.globalData.userInfo) {
              (app.globalData.userInfo as any).signature = res.content.trim();
            }

            wx.showToast({ title: '修改成功', icon: 'success' });
          } else {
            wx.showToast({ title: '修改失败', icon: 'none' });
          }
        }
      },
    });
  },

  changeAvatar() {
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sourceType: ['album', 'camera'],
      success: async (res) => {
        const tempFilePath = res.tempFiles[0].tempFilePath;
        wx.showLoading({ title: '上传中...' });

        try {
          const fileID = await uploadAvatar(tempFilePath);
          wx.hideLoading();

          const userInfo = { ...this.data.userInfo, avatar: fileID };
          this.setData({ userInfo });

          if (app.globalData.userInfo) {
            app.globalData.userInfo.avatar = fileID;
          }

          wx.showToast({ title: '更换成功', icon: 'success' });
        } catch (err) {
          wx.hideLoading();
          wx.showToast({ title: '上传失败', icon: 'none' });
        }
      },
    });
  },

  // ========== 作品列表 ==========

  /** 本地缓存快速渲染（首屏用） */
  renderWorksFromLocal() {
    this.setWorks(getCompletedCharacters());
  },

  /** 从云端拉取作品列表 */
  async loadWorksFromCloud() {
    try {
      const allCards = await fetchCharactersFromCloud();
      this.setWorks(allCards.filter(c => c.status === 'completed'));
    } catch (err) {
      console.error('云端加载作品失败，使用本地缓存:', err);
      this.renderWorksFromLocal();
    }
  },

  setWorks(cards: ICharacterCard[]) {
    this.setData({ works: this.cardsToWorks(cards) });
  },

  cardsToWorks(cards: ICharacterCard[]): IWork[] {
    return cards.map(card => ({
      id: card.id,
      name: card.characterInfo.name,
      image: card.avatar || PLACEHOLDER_IMAGE,
      date: this.formatDate(card.createdAt || Date.now()),
    }));
  },

  formatDate(timestamp: number): string {
    const date = new Date(timestamp);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  },

  onViewAllWorks() {
    wx.showToast({ title: '功能开发中', icon: 'none' });
  },

  onWorkTap(e: WechatMiniprogram.TouchEvent) {
    const { id } = e.currentTarget.dataset;
    wx.navigateTo({ url: `/pages/preview/preview?characterId=${id}&readonly=true` });
  },

  // ========== 菜单 ==========

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

  showGuide() {
    wx.showModal({
      title: '使用指南',
      content: '1. 点击首页的"+"按钮创建新角色\n2. 与AI对话描述你的角色想法\n3. 确认生成后得到完整的角色信息卡\n4. 所有作品都会保存在"我的"页面',
      showCancel: false,
    });
  },

  showFeedback() {
    wx.showModal({
      title: '意见反馈',
      content: '感谢您的反馈！请发送邮件至：feedback@oyic.com',
      showCancel: false,
    });
  },

  showRecharge() {
    if (!this.data.isLoggedIn) {
      wx.showToast({ title: '请先登录', icon: 'none' });
      return;
    }
    wx.navigateTo({ url: '/pages/payment/payment' });
  },

  showAbout() {
    wx.showModal({
      title: '关于O亿C',
      content: 'O亿C是基于AI Agent的原创角色创作灵感助手，帮助ACGN爱好者快速构建专业的角色信息卡。\n\n版本：1.0.0',
      showCancel: false,
    });
  },

  // ========== 兑换码 ==========

  onRedeemTap() {
    if (!this.data.isLoggedIn) {
      wx.showToast({ title: '请先登录', icon: 'none' });
      return;
    }
    this.setData({ redeemPopupVisible: true, redeemCode: '' });
  },

  onRedeemCodeInput(e: WechatMiniprogram.Input) {
    this.setData({ redeemCode: e.detail.value });
  },

  async onRedeemSubmit() {
    const code = (this.data.redeemCode || '').trim();
    if (!code) {
      wx.showToast({ title: '请输入兑换码', icon: 'none' });
      return;
    }

    this.setData({ redeemLoading: true });
    console.log('[Redeem] 开始兑换，输入码：', code);

    try {
      const res = await wx.cloud.callFunction({
        name: 'redeem',
        data: { action: 'redeem', code },
      });

      const result = res.result as any;
      console.log('[Redeem] 云函数返回：', JSON.stringify(result));

      if (result.code === 0) {
        const { rewardType, rewardValue, description } = result.data || {};

        // 构建奖励说明文案
        let rewardText = '';
        if (rewardType === 'points') {
          rewardText = `+${rewardValue} 创作点已到账`;
        } else if (rewardType === 'vip') {
          rewardText = `已获得 ${rewardValue} 天 VIP`;
        } else if (rewardType === 'cardTemplate') {
          rewardText = '角色卡模板已添加至我的作品';
        } else {
          rewardText = description || '奖励已发放';
        }

        const modalContent = description
          ? `${rewardText}\n\n${description}`
          : rewardText;

        console.log('[Redeem] 兑换成功 →', { rewardType, rewardValue, description, rewardText });

        this.setData({ redeemLoading: false, redeemPopupVisible: false, redeemCode: '' });

        // 使用 showModal 展示完整兑换结果，避免 showToast 7字限制导致截断
        wx.showModal({
          title: '🎉 兑换成功',
          content: modalContent,
          showCancel: false,
          confirmText: '好的',
        });

        // 刷新余额
        this.loadBalanceOverview();
      } else {
        const errMsg = result.message || '兑换失败，请稍后重试';
        console.warn('[Redeem] 兑换失败：', errMsg, '| 完整返回：', JSON.stringify(result));
        this.setData({ redeemLoading: false });
        wx.showToast({ title: errMsg, icon: 'none', duration: 2500 });
      }
    } catch (err: any) {
      console.error('[Redeem] 云函数调用异常：', err?.message || err);
      this.setData({ redeemLoading: false });
      wx.showToast({ title: '网络异常，请重试', icon: 'none' });
    }
  },

  onRedeemPopupClose() {
    this.setData({ redeemPopupVisible: false, redeemCode: '', redeemLoading: false });
  },
});
