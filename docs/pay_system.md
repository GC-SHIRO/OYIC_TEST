# O亿C小程序支付功能开发需求文档

## 付费说明

### 支付功能概要
本小程序采用"创作点"消费体系。用户通过充值或活动获取创作点，在 AI 对话和角色卡生成过程中按配置比例扣除创作点。用户注册可获得一次性激励创作点，每日可通过分享群聊获得额外创作点。

## 功能需求

### 添加消费页面

**payment 页面：从 profile 页的"余额充值"进入**
**设计要求**：
- 保持页面风格与其他页面一致
- 展示当前余额与今日消耗
- 提供充值方案入口

**usage 页面：payment 页面明细查询**
**设计要求**：
- 保持页面风格与其他页面一致
- 可查询当前用户的消费记录
- 可返回上级目录

### 快捷更改比率和价值
- 能快速在代码端更改 AI 消耗创作点的比例
- 能快速在代码端添加充值方案（金额与创作点）

### 安全的逻辑设计
- 用户余额存储在云数据库中
- 每次消耗记录进入账单集合
- 所有扣费均由云函数服务端执行

## 逻辑设计（核心）

### 术语定义
- 创作点：计费单位（原文档中的"积分"统一更名）
- token：Dify 返回的 token 用量统计

### 计费与配置（云函数常量）
建议在云函数内新增配置文件，如 `cloudfunctions/billingConfig.js`：
- `TOKEN_UNIT`：统计粒度（如 1000 tokens）
- `TOKEN_COST`：每 `TOKEN_UNIT` 消耗的创作点
- `CARD_GEN_COST`：角色卡生成消耗的创作点
- `REGISTER_BONUS`：注册赠送创作点
- `SHARE_DAILY_BONUS`：每日分享奖励创作点
- `RECHARGE_PACKS`：充值方案数组（price, points, bonus 等）

### 数据模型设计

**users 集合（新增/补充字段）**
- `_openid` string
- `nickname` string
- `avatar` string
- `signature` string
- `balance` number
- `loginCount` number
- `createdAt` number
- `lastShareAt` number（用于每日分享奖励幂等）

**usage_logs 集合（账单）**
- `_id` string
- `_openid` string
- `type` string（chat | card | recharge | share | register）
- `delta` number（正数入账，负数消耗）
- `balanceBefore` number
- `balanceAfter` number
- `tokens` number（可为空）
- `conversationId` string（可为空）
- `cardId` string（可为空）
- `source` string（dify | wechatPay | system）
- `meta` object（扩展字段，如 paymentId、ip、traceId）
- `createdAt` number

### 业务流程（服务端）

**1. 注册奖励**
- `login` 云函数在新用户注册时：
	- 读取 `REGISTER_BONUS`
	- 给 `users.balance` 加值
	- 写入一条 `usage_logs`（type=register）

**2. AI 对话消耗**
- `difyChat` 云函数返回 token 用量后：
	- 根据 `TOKEN_UNIT` 与 `TOKEN_COST` 计算消耗值
	- 校验余额是否足够，不足则拒绝调用并返回错误码
	- 原子更新 `users.balance` 并写入 `usage_logs`

**3. 角色卡生成消耗**
- `characterCard` 或 `difyChat` 的生成指令完成后：
	- 扣除 `CARD_GEN_COST`
	- 写入 `usage_logs`（type=card）

**4. 充值入账（预留）**
- 微信支付回调成功后：
	- 按 `RECHARGE_PACKS` 计算创作点
	- 原子更新 `users.balance`
	- 写入 `usage_logs`（type=recharge）

**5. 分享奖励**
- 新增云函数 `shareReward` 或在现有函数中处理：
	- 根据 `lastShareAt` 做每日幂等
	- 当日未领取则入账 + 写入 `usage_logs`（type=share）

### 幂等与安全策略
- 余额与账单写入必须在云函数完成
- 同一行为只允许一次入账（注册奖励、每日分享）
- 每次扣费前校验余额，避免负数
- 账单记录包含 `balanceBefore/After` 方便审计

### 前端表现（payment/usage）
- payment 页面读取 `users.balance` 与 `RECHARGE_PACKS`
- usage 页面分页拉取 `usage_logs`（按时间倒序）
- 所有文案统一为"创作点"

## 技术实现说明
- 用户表记录余额与 token 用量统计（来自 dify 响应）
- 账单表记录每一次消耗/入账的创作点与 tokens
