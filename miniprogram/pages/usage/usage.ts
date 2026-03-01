type UsageType = 'all' | 'chat' | 'card' | 'recharge' | 'share' | 'redeem';

interface UsageRecord {
  id: string;
  type: UsageType;
  title: string;
  meta: string;
  delta: number;
}

interface UsageLog {
  id: string;
  type: UsageType | 'register';
  delta: number;
  chars: number;
  createdAt: number;
}

Page({
  data: {
    monthlyCost: 0,
    balance: 0,
    filters: [
      { label: '全部', value: 'all' },
      { label: '对话消耗', value: 'chat' },
      { label: '角色卡生成', value: 'card' },
      { label: '充值入账', value: 'recharge' },
      { label: '分享奖励', value: 'share' },
      { label: '兑换奖励', value: 'redeem' },
    ] as Array<{ label: string; value: UsageType }>,
    activeFilter: 'all' as UsageType,
    records: [] as UsageRecord[],
    displayRecords: [] as UsageRecord[],
  },

  onShow() {
    this.loadOverview();
    this.loadUsageLogs();
  },

  onBackTap() {
    wx.navigateBack({ delta: 1 });
  },

  onFilterTap(e: WechatMiniprogram.TouchEvent) {
    const { value } = e.currentTarget.dataset as { value: UsageType };
    this.setData({ activeFilter: value });
    this.updateDisplayRecords();
  },

  updateDisplayRecords() {
    const { activeFilter, records } = this.data;
    if (activeFilter === 'all') {
      this.setData({ displayRecords: records });
      return;
    }
    this.setData({ displayRecords: records.filter(record => record.type === activeFilter) });
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
          monthlyCost: data.monthlyCost ?? 0,
        });
      }
    } catch (err) {
      console.error('获取账单概览失败:', err);
    }
  },

  async loadUsageLogs() {
    try {
      const res = await wx.cloud.callFunction({
        name: 'billing',
        data: { action: 'usage' },
      });

      const result = res.result as any;
      if (result.code === 0 && Array.isArray(result.data)) {
        const records = result.data.map(this.mapLogToRecord);
        this.setData({ records }, () => this.updateDisplayRecords());
      }
    } catch (err) {
      console.error('获取账单列表失败:', err);
    }
  },

  mapLogToRecord: (log: UsageLog): UsageRecord => {
    const timeText = formatDateTime(log.createdAt);
    const type = log.type === 'register' ? 'recharge' : log.type;
    const titleMap: Record<string, string> = {
      chat: 'Dify 对话消耗',
      card: '角色卡生成',
      recharge: '充值入账',
      share: '分享奖励',
      register: '注册奖励',
      redeem: '兑换码奖励',
    };

    const metaMap: Record<string, string> = {
      card: '结果生成',
      recharge: '微信支付',
      share: '群聊分享',
      register: '注册奖励',
      redeem: '兑换码',
    };

    const extra = log.type === 'chat' && log.chars
      ? `${log.chars} 字`
      : (metaMap[log.type] || '');

    return {
      id: log.id,
      type: type as UsageType,
      title: titleMap[log.type] || '账单记录',
      meta: extra ? `${timeText} · ${extra}` : timeText,
      delta: log.delta,
    };
  },
});

function formatDateTime(timestamp: number): string {
  const date = new Date(timestamp);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hour = String(date.getHours()).padStart(2, '0');
  const minute = String(date.getMinutes()).padStart(2, '0');
  return `${year}-${month}-${day} ${hour}:${minute}`;
}
