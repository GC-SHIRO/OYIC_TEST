# O亿C 云数据库结构优化文档

> 本文基于当前实现梳理并优化数据库结构，重点是可扩展性、查询效率与审计可追溯性。

---

## 目标

- 统一字段命名与时间字段格式
- 明确集合职责与读写路径
- 增加必要索引与冗余字段以提升查询效率
- 强化账单与对话记录的可追溯性

---

## 集合总览

- users: 用户基础信息与余额
- characters: 角色卡主数据
- usage_logs: 创作点账单流水
- conversations: 对话历史记录

---

## users

**用途**: 用户基础信息、登录状态与余额。

**推荐结构**:
```json
{
  "_openid": "string",
  "unionId": "string",
  "nickname": "string",
  "avatar": "string",
  "signature": "string",
  "balance": 0,
  "loginCount": 0,
  "lastLoginAt": "serverDate",
  "lastShareAt": "serverDate|null",
  "createdAt": "serverDate",
  "updatedAt": "serverDate",
  "status": "active|banned"
}
```

**优化点**:
- `balance` 为单一真实来源，所有扣费在云函数内完成。
- `lastShareAt` 用于每日分享奖励幂等。
- `status` 预留封禁或冻结控制。

**索引建议**:
- 主查询依赖 `_openid`，保持默认索引即可。

---

## characters

**用途**: 角色卡主数据，供首页与预览页读取。

**推荐结构**:
```json
{
  "cardId": "string",
  "_openid": "string",
  "status": "completed|incomplete",
  "conversationId": "string",
  "avatar": "string",
  "gallery": ["string"],
  "characterInfo": { "...": "..." },
  "createdAt": "serverDate",
  "updatedAt": "serverDate"
}
```

**优化点**:
- `cardId` 作为前端主键，与本地缓存一致。
- `status + createdAt` 组合便于首页列表查询。

**索引建议**:
- `_openid + status + createdAt(desc)`

---

## usage_logs

**用途**: 创作点账单流水，用于消费明细与审计。

**推荐结构**:
```json
{
  "_openid": "string",
  "type": "chat|card|recharge|share|register",
  "delta": -30,
  "balanceBefore": 100,
  "balanceAfter": 70,
  "tokens": 1200,
  "conversationId": "string",
  "cardId": "string",
  "source": "dify|system|wechatPay",
  "meta": { "messageId": "string" },
  "createdAt": "serverDate"
}
```

**优化点**:
- `balanceBefore/After` 便于审计与追溯。
- `tokens` 仅在对话类流水出现。
- `meta` 承载扩展字段，避免频繁改表结构。

**索引建议**:
- `_openid + createdAt(desc)`
- `_openid + type + createdAt(desc)`

---

## conversations

**用途**: 对话记录，云端为主，本地缓存加速。

**推荐结构**:
```json
{
  "_openid": "string",
  "characterId": "string",
  "messages": [
    {
      "id": "string",
      "role": "user|ai",
      "content": "string",
      "images": ["string"],
      "timestamp": 0,
      "userId": "string",
      "transient": false
    }
  ],
  "createdAt": "serverDate",
  "updatedAt": "serverDate"
}
```

**优化点**:
- `userId` 冗余写入，便于未来多端同步或多人协作。
- `transient` 标记的消息不应被同步到云端（前端已过滤）。

**索引建议**:
- `_openid + characterId` 唯一查询

---

## 统一时间字段建议

- 使用 `createdAt` / `updatedAt`
- 写入时使用 `db.serverDate()`
- 前端展示使用本地时间格式化

---

## 读写路径建议

- 角色卡: 前端缓存 + 云函数读写（已有）
- 账单: 全部通过云函数写入（已有）
- 对话: 云函数 `conversation` 读写，本地缓存仅用于降级

---

## 数据一致性与清理

- 删除角色卡时同时删除 `conversations` 对应记录
- 定期清理无效 `characters` 空数据与长时间未使用 `conversations`
- 账单流水不可删除，仅可归档

---

## 可选增强

- 为 `usage_logs` 添加 `traceId` 用于跨云函数追踪
- 为 `conversations` 添加 `messageCount` 缓存字段，加速统计
- 角色卡添加 `summary` 字段用于首页卡片快速展示
