Page({
  data: {
    balance: 0,
    todayCost: 0,
    packs: [] as Array<{ price: number; points: number; bonus?: number; bonusText?: string }>,
    activity: {
      title: '',
      subtitle: '',
    },
    selectedPackIndex: 0,
    selectedPlanType: 'pack' as 'pack' | 'custom',
    rechargeRate: 0,
    customAmount: '',
    customPoints: 0,
  },

  onShow() {
    this.loadOverview();
  },

  onBackTap() {
    wx.navigateBack({ delta: 1 });
  },

  onViewUsage() {
    wx.navigateTo({ url: '/pages/usage/usage' });
  },

  onRechargeTap() {
    wx.showToast({ title: '功能开发中', icon: 'none' });
  },

  onCustomPackTap() {
    this.setData({ selectedPlanType: 'custom' });
  },

  onCustomAmountInput(e: WechatMiniprogram.Input) {
    const value = (e.detail.value || '').trim();
    const amount = Number(value);
    const rate = Number(this.data.rechargeRate) || 0;
    const points = Number.isFinite(amount) && amount > 0
      ? Math.floor(amount * rate)
      : 0;
    this.setData({ customAmount: value, customPoints: points, selectedPlanType: 'custom' });
  },

  onPackTap(e: WechatMiniprogram.TouchEvent) {
    const { index } = e.currentTarget.dataset as { index: number };
    if (typeof index === 'number') {
      this.setData({ selectedPackIndex: index, selectedPlanType: 'pack' });
    }
  },

  async loadOverview() {
    try {
      const res = await wx.cloud.callFunction({
        name: 'billing',
        data: { action: 'overview' },
      });

      const result = res.result as any;
      if (result.code === 0 && result.data) {
        const data = result.data;
        this.setData({
          balance: data.balance ?? 0,
          todayCost: data.todayCost ?? 0,
          packs: data.packs || this.data.packs,
          activity: data.activity || this.data.activity,
          selectedPackIndex: pickDefaultPackIndex(data.packs || this.data.packs),
          selectedPlanType: 'pack',
          rechargeRate: data.rechargeRate ?? this.data.rechargeRate,
        });

        const cached = wx.getStorageSync('cloudUserInfo') || {};
        cached.balance = data.balance ?? cached.balance ?? 0;
        wx.setStorageSync('cloudUserInfo', cached);
      }
    } catch (err) {
      console.error('获取支付概览失败:', err);
    }
  },
});

function pickDefaultPackIndex(packs: Array<{ isHot?: boolean }>): number {
  const hotIndex = packs.findIndex((pack) => !!pack.isHot);
  return hotIndex >= 0 ? hotIndex : 0;
}
