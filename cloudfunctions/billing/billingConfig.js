module.exports = {
  TOKEN_UNIT: 1000,
  TOKEN_COST: 30,
  CARD_GEN_COST: 80,
  REGISTER_BONUS: 120,
  SHARE_DAILY_BONUS: 120,
  RECHARGE_RATE: 100,
  RECHARGE_PACKS: [
    { price: 12, points: 1200, bonus: 120 },
    { price: 30, points: 3500, bonusText: '多送 15%', isHot: true },
    { price: 68, points: 8000, bonus: 1200 },
    { price: 128, points: 16000, bonus: 3000 },
  ],
  ACTIVITY: {
    title: '分享得创作点',
    subtitle: '每日分享群聊可领取额外创作点',
  },
};
