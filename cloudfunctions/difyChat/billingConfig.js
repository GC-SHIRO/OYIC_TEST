// 计费配置（此文件为 difyChat 云函数专用，与 billing/billingConfig.js 需手动保持一致）
module.exports = {
  CHAR_UNIT: 10,       // 每10字符为1单位
  CHAR_COST: 1,        // 每单位1创作点
  CARD_GEN_COST: 80,   // 角色卡生成固定附加消耗
};
