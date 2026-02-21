module.exports = {
  TOKEN_UNIT: 10, // 统计粒度：每10 tokens算1单位
  TOKEN_COST: 1,  // 每单位消耗1点
  CARD_GEN_COST: 300, // 生成角色卡消耗300点
  REGISTER_BONUS: 6000, // 注册奖励6000点
  SHARE_DAILY_BONUS: 120,
  RECHARGE_RATE: 1000, // 充值1元=1000点
  RECHARGE_PACKS: [
    { price: 6, points: 6000, bonus: 6300 },
    { price: 12, points: 13200, bonusText: '多送 10%', isHot: true },
    { price: 30, points: 36000, bonus: 6000 },
    { price: 68, points: 88400, bonus: 20400 },
  ],
  ACTIVITY: {
    title: '分享得创作点',
    subtitle: '每日分享群聊可领取额外创作点',
  },
};
