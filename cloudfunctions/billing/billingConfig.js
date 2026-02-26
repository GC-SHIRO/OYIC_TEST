// 计费配置（与 difyChat/billingConfig.js、login/billingConfig.js 需手动保持一致）
module.exports = {
  CHAR_UNIT: 10,  // 统计粒度：每10字符算1单位
  CHAR_COST: 1,   // 每单位消耗1创作点
  CARD_GEN_COST: 80, // 角色卡生成固定附加消耗
  // 注册奖励统一由 login/billingConfig.js 的 REGISTER_BONUS 控制（当前为 3000）
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
