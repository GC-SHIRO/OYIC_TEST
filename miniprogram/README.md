# O亿C — AI 原创角色创作助手

> 基于微信小程序 + 云开发 + Dify AI Agent 的原创角色 (OC) 创作灵感助手。
> 解决 ACGN 爱好者在构思角色时思维零散、逻辑简单等痛点，通过 AI 对话引导用户整理灵感，最终生成结构化的专业角色信息卡。

---

## 目录

- [技术栈](#技术栈)
- [项目结构](#项目结构)
- [整体架构](#整体架构)
- [页面说明](#页面说明)
- [服务层设计](#服务层设计)
- [云函数](#云函数)
- [数据模型](#数据模型)
- [UI / 设计规范](#ui--设计规范)
- [开发环境搭建](#开发环境搭建)
- [配置说明](#配置说明)
- [待完成事项](#待完成事项)

---

## 技术栈

| 层级 | 技术 | 说明 |
|------|------|------|
| 前端框架 | 微信小程序 (TypeScript) | `glass-easel` 组件框架，`lazyCodeLoading` |
| UI 组件库 | TDesign Miniprogram v1.12+ | npm 构建至 `miniprogram_npm/` |
| 后端 | 微信云开发 (CloudBase) | 云函数 + 云数据库 + 云存储 |
| AI 引擎 | Dify (SSE 流式) | 通过 `difyChat` 云函数安全代理调用 |
| 类型系统 | TypeScript (ES2020, strict) | `tsconfig.json` 全量严格模式 |
| 构建 | 微信开发者工具内置 TS 编译器插件 | `useCompilerPlugins: ["typescript"]` |

---

## 项目结构

```
miniprogram-1/
├── package.json                           # 根依赖（tdesign-miniprogram）
├── project.config.json                    # 小程序项目配置（appid、云环境、编译选项）
├── tsconfig.json                          # TypeScript 编译配置
│
├── cloudfunctions/                        # ☁️ 云函数（Node.js）
│   ├── login/                             #    用户登录 / 自动注册
│   │   └── index.js
│   ├── billing/                           #    创作点计费与账单
│   │   └── index.js
│   ├── conversation/                      #    对话记录读写
│   │   └── index.js
│   ├── difyChat/                          #    Dify API 代理（SSE 流式）
│   │   └── index.js
│   ├── characterCard/                     #    角色卡 CRUD
│   │   └── index.js
│   └── updateUser/                        #    更新用户信息（昵称/头像/签名）
│       └── index.js
│
├── miniprogram/                           # 📱 小程序前端
│   ├── app.json                           #    全局配置（页面路由、TabBar、窗口）
│   ├── app.ts                             #    入口文件（云开发初始化、登录状态检查）
│   ├── app.wxss                           #    全局样式（CSS 变量、字体、通用类）
│   │
│   ├── pages/
│   │   ├── home/                          #    🏠 首页 — 角色卡中心
│   │   │   ├── home.ts                    #        横向滚动列表、云端/本地数据加载
│   │   │   ├── home.wxml                  #        卡片模板（新建/未完成/已完成）
│   │   │   ├── home.wxss                  #        卡片样式、渐变背景、动画
│   │   │   └── home.json                  #        页面组件声明
│   │   ├── chat/                          #    💬 AI 对话 — 创建角色
│   │   │   ├── chat.ts                    #        Dify 对话交互、pending 占位、打字机显示
│   │   │   ├── chat.wxml                  #        聊天气泡、输入栏、悬浮确认按钮
│   │   │   ├── chat.wxss                  #        消息样式、键盘适配
│   │   │   └── chat.json                  #        页面组件声明
│   │   ├── preview/                       #    👁️ 预览 — 角色卡详情
│   │   │   ├── preview.ts                 #        角色信息渲染、Canvas 雷达图、完成创建
│   │   │   ├── preview.wxml               #        角色全字段展示模板
│   │   │   ├── preview.wxss               #        卡片预览样式
│   │   │   └── preview.json               #        页面组件声明
│   │   ├── profile/                       #    👤 我的 — 用户中心
│   │   │   ├── profile.ts                 #        云开发登录/注册、编辑资料、我的作品
│   │   │   ├── profile.wxml               #        用户头部、作品列表、菜单、注册弹窗
│   │   │   ├── profile.wxss               #        用户中心样式
│   │   │   └── profile.json               #        页面组件声明
│   │   ├── index/                         #    （默认模板页，未使用）
│   │   └── logs/                          #    （启动日志页，默认模板）
│   │
│   ├── services/                          #    🔧 服务层
│   │   ├── agent.ts                       #        Dify AI 对话 & 角色卡生成（JSON 解析）
│   │   ├── storage.ts                     #        存储服务（云端优先 + 本地缓存降级）
│   │   └── user.ts                        #        用户服务（登录/注册/资料更新/头像上传）
│   │
│   ├── types/
│   │   └── character.ts                   #    📐 角色卡类型定义（ICharacterCard 等）
│   │
│   ├── utils/
│   │   └── util.ts                        #    时间格式化工具
│   │
│   ├── custom-tab-bar/                    #    ⬇️ 自定义 TabBar（小程序规范目录）
│   │   ├── index.ts / .wxml / .wxss / .json
│   │
│   ├── components/
│   │   └── custom-tabbar/                 #    自定义 TabBar 组件（备用实现）
│   │
│   ├── assets/                            #    静态资源
│   │   ├── icons/
│   │   └── images/
│   │
│   └── miniprogram_npm/                   #    npm 构建产物
│       └── tdesign-miniprogram/           #        TDesign 组件库
│
├── docs/                                  # 📄 设计文档
│   ├── prd.md                             #    产品需求文档
│   ├── character_card_design.md           #    角色卡数据结构设计
│   └── 角色卡正式构建需求文档.md
│
├── prototype/                             # 🎨 原型 HTML（设计参考）
│   ├── home.html / chat.html / preview.html / profile.html
│
├── test_tool/                             # 🧪 调试脚本
│   ├── test_dify.py                       #    Dify API 连通性测试
│   └── test_cloud_connectivity.py         #    云函数网络测试
│
└── typings/                               # TypeScript 类型声明
    ├── index.d.ts                         #    IAppOption 全局类型
    └── types/
```

---

## 整体架构

```
┌─────────────────────────────────────────────────────────────┐
│                      微信小程序前端                          │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐   │
│  │   Home   │  │   Chat   │  │ Preview  │  │ Profile  │   │
│  │ 角色卡列表│  │ AI 对话  │  │ 卡片预览 │  │ 用户中心 │   │
│  └─────┬────┘  └────┬─────┘  └────┬─────┘  └────┬─────┘   │
│        │            │             │              │          │
│  ┌─────┴────────────┴─────────────┴──────────────┴───┐     │
│  │              services/ 服务层                       │     │
│  │  agent.ts (AI对话)  storage.ts (存储)  user.ts     │     │
│  └─────────────────────┬─────────────────────────────┘     │
└────────────────────────┼───────────────────────────────────┘
                         │ wx.cloud.callFunction()
┌────────────────────────┼───────────────────────────────────┐
│                   微信云开发 CloudBase                       │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐   │
│  │  login   │  │ difyChat │  │character │  │updateUser│   │
│  │ 登录注册 │  │ AI 代理  │  │  Card    │  │ 更新资料 │   │
│  └──────────┘  └────┬─────┘  └──────────┘  └──────────┘   │
│                     │                                       │
│  ┌──────────────────┴────────────────────────────────┐     │
│  │  云数据库: users 集合 / characters 集合            │     │
│  │  云存储:   avatars/ (用户头像)                     │     │
│  └───────────────────────────────────────────────────┘     │
└────────────────────────┼───────────────────────────────────┘
                         │ HTTPS (SSE 流式)
                 ┌───────┴───────┐
                 │  Dify AI API  │
                 │  角色创作助手  │
                 └───────────────┘
```

**核心数据流：**

1. **创建角色**：用户在 Chat 页输入灵感 → `agent.ts` 调用 `difyChat` 云函数 → 云函数发起 SSE 流式请求到 Dify API → AI 回复通过打字机效果逐字显示
2. **生成角色卡**：用户点击确认 → 发送 `Give_Result` 指令 → Dify 返回结构化 JSON → `agent.ts` 解析并标准化 → 跳转 Preview 页
3. **数据持久化**：角色卡草稿由云端创建（`characterCard.createDraft`）；对话结果由 `difyChat` 后端兜底入库，本地缓存仅用于首屏加速与离线降级

---

## 页面说明

### 🏠 首页 (pages/home)

角色卡管理中心，采用全屏横向滚动卡片布局。

- **卡片类型**：新建卡片（虚线 + "+" 图标）、未完成卡片（磨砂遮罩 + "未完成"标识）、已完成卡片（展示角色信息 + 标签）
- **数据策略**：`onShow` 时先从本地缓存快速渲染首屏，随后异步从云端拉取最新数据更新
- **交互**：点击未完成卡片 → 跳转 Chat 页继续编辑；点击已完成卡片 → 跳转 Preview 页只读查看
- **登录检查**：新建角色需先登录，未登录时弹窗引导至 Profile 页

### 💬 AI 对话 (pages/chat)

仿 AI 聊天界面，与 Dify Agent 实时对话创建角色。

- **消息系统**：用户消息 / AI 消息双气泡布局，支持图片消息
- **等待占位**：发送后立即插入 AI `pending` 占位气泡，避免“无反馈等待”
- **打字机效果**：AI 回复逐字显示（`streamDisplayMessage`），可随时中断
- **对话持久化**：后端 `difyChat` 写入云端对话，本地仅做缓存加速；再次进入优先读云端并自动补齐欢迎语
- **角色卡生成**：右上角悬浮确认按钮触发 `Give_Result` → Dify 返回 JSON → 解析后跳转 Preview
- **键盘适配**：输入栏跟随软键盘浮动，`adjust-position: false` + 手动计算偏移

### 👁️ 预览 (pages/preview)

角色卡完整信息预览，包含所有结构化字段。

- **展示内容**：基本信息（姓名/性别/星座/生日/物种）、性格标签、外观描述（发色/瞳色/详细）、性格描述、角色背景、故事线、特殊能力、关系网
- **六维雷达图**：使用 Canvas 2D API 绘制性格六维图（外向度/理智度/善良度/胆识度/开放度/责任感）
- **操作模式**：
  - 编辑模式（默认）：底部显示"继续创作"（返回 Chat）+ "完成创建"（标记已完成并同步云端）
  - 只读模式（`readonly=true`）：隐藏底部操作栏

### 👤 我的 (pages/profile)

用户信息中心与作品管理。

- **登录流程**：基于云开发 + `login` 云函数的微信一键登录，首次登录弹出注册弹窗（收集头像 + 昵称 + 签名）
- **资料编辑**：修改昵称、头像上传（云存储）、个性签名
- **我的作品**：横向滚动展示已完成角色卡，点击跳转 Preview 只读查看
- **功能菜单**：使用指南、意见反馈、余额充值（预留）、关于、退出登录

### 💳 支付中心 (pages/payment)

创作点充值与余额入口。

- **余额概览**：显示当前余额与今日消耗
- **充值方案**：从云函数读取 `RECHARGE_PACKS` 配置
- **活动入口**：展示分享活动文案
- **明细跳转**：进入消费明细页面

### 📄 消费明细 (pages/usage)

创作点账单记录查询。

- **账单汇总**：显示本月消耗与当前余额
- **筛选查看**：按对话/角色卡/充值/分享分类
- **数据来源**：读取 `usage_logs` 集合

---

## 服务层设计

### agent.ts — AI 对话服务

负责与 Dify AI Agent 的通信，**API 密钥安全存放在云函数端，前端不暴露任何密钥**。

| 函数 | 说明 |
|------|------|
| `chatWithDify(query, conversationId?)` | 发送对话消息，返回 AI 回复和会话 ID |
| `generateCharacterCard(conversationId)` | 发送 `Give_Result` 触发角色卡生成，解析返回的 JSON |
| `parseCharacterJSON(text)` | 从 AI 回复中提取 JSON（支持 markdown 代码块、Python 单引号兼容） |
| `normalizeCharacterInfo(obj)` | 标准化字段名（兼容 snake_case / camelCase） |

### storage.ts — 数据存储服务

**云端优先 + 本地缓存降级**的双层存储策略，数据按用户 openId 隔离。

| 函数 | 说明 |
|------|------|
| `fetchCharactersFromCloud()` | 从云端拉取所有角色卡（核心），同步更新本地缓存 |
| `fetchCharacterFromCloud(id)` | 从云端拉取单个角色卡 |
| `createCharacterDraftInCloud()` | 在云端创建空白草稿卡并回填本地缓存 |
| `saveCharacter(card)` | 角色卡本地缓存 + 云端更新 |
| `deleteCharacter(id)` | 本地 + 云端双删 |
| `fetchConversationFromCloud(id)` / `saveConversation(id, msgs)` | 对话历史（云端为主，本地仅缓存，不再前端写云） |
| `getCurrentUserId()` | 获取当前登录用户 openId |

### user.ts — 用户服务

| 函数 | 说明 |
|------|------|
| `cloudLogin(nickname?, avatar?)` | 调用 `login` 云函数，登录 / 自动注册 |
| `updateNickname(name)` | 更新昵称 |
| `updateSignature(sig)` | 更新签名 |
| `uploadAvatar(tempPath)` | 上传头像到云存储并更新用户记录 |
| `getCloudUserInfo()` | 直接查询云数据库获取用户信息 |
| `logout()` / `isLoggedIn()` / `getLocalUserInfo()` | 登录状态管理 |

---

## 云函数

云环境 ID：`cloud1-0g88vkjh890eca50`

| 云函数 | 超时 | 说明 |
|--------|------|------|
| **login** | 默认 | 用户登录 / 自动注册。查询 `users` 集合，已有用户更新登录时间，新用户赠送 10 次余额 |
| **billing** | 默认 | 创作点计费与账单服务。返回余额/当日消耗/本月消耗、充值方案与活动配置，记录账单明细 |
| **conversation** | 默认 | 对话记录读写。当前前端主要使用 `get`（删除流程仍调用 `delete`） |
| **difyChat** | 120s | Dify API 安全代理。支持 `chat`（SSE 流式对话）和 `ping`；`chat` 成功后后端兜底写入 `conversations` |
| **characterCard** | 30s | 角色卡 CRUD。支持 `createDraft` / `create` / `update` / `get` / `list` / `delete` 操作，数据存入 `characters` 集合 |
| **updateUser** | 默认 | 增量更新用户字段（nickname / avatar / signature），操作 `users` 集合 |

### 云数据库集合

| 集合 | 主要字段 | 说明 |
|------|----------|------|
| **users** | `_openid`, `nickname`, `avatar`, `signature`, `balance`, `loginCount`, `createdAt` | 用户信息 |
| **characters** | `cardId`, `_openid`, `status`, `conversationId`, `avatar`, `characterInfo`, `createdAt` | 角色卡数据 |
| **usage_logs** | `_openid`, `type`, `delta`, `balanceBefore`, `balanceAfter`, `tokens`, `createdAt` | 创作点账单明细 |
| **conversations** | `_openid`, `characterId`, `messages`, `createdAt`, `updatedAt` | 对话记录 |

---

## 数据模型

### ICharacterCard（角色卡存储结构）

```typescript
interface ICharacterCard {
  id: string;                    // 卡片 ID（云端创建草稿时生成）
  createdAt: number;             // 创建时间戳
  updatedAt: number;             // 更新时间戳
  creatorId?: string;            // 创建者 openId
  status: 'completed' | 'incomplete';  // 创建状态
  conversationId?: string;       // Dify 会话 ID
  avatar?: string;               // 角色头像
  characterInfo: ICharacterInfo; // 角色具体信息
}
```

### ICharacterInfo（角色具体信息）

```typescript
interface ICharacterInfo {
  name: string;                  // 姓名
  gender: string;                // 性别
  birthday?: string;             // 生日
  constellation?: string;        // 星座
  species: string;               // 物种
  introduction: string;          // 简介
  personalityTags: string[];     // 性格标签
  appearance: {                  // 外观
    hairColor: string;           //   发色
    eyeColor: string;            //   瞳色
    detail: string;              //   详细描述
  };
  personality: string;           // 性格描述
  backstory: string;             // 背景故事
  storyline?: string;            // 故事线（可选）
  abilities?: Array<{            // 特殊能力（可选）
    name: string;
    description: string;
  }>;
  relationships?: Array<{        // 关系网（可选）
    character: string;
    relation: string;
  }>;
  radar: {                       // 性格六维图（0~1）
    extroversion: number;        //   外向度
    rationality: number;         //   理智度
    kindness: number;            //   善良度
    courage: number;             //   胆识度
    openness: number;            //   开放度
    responsibility: number;      //   责任感
  };
}
```

---

## UI / 设计规范

### 色彩体系

采用银色灰调设计语言，通过 CSS 变量在 `app.wxss` 中统一定义：

| 变量 | 色值 | 用途 |
|------|------|------|
| `--bg` | `#f2f3f5` | 页面背景 |
| `--surface` | `#ffffff` | 卡片 / 容器表面 |
| `--text` | `#1f2937` | 主文本色 |
| `--muted` | `#6b7280` | 辅助文本色 |
| `--border` | `#e5e7eb` | 边框色 |
| `--silver-1` ~ `--silver-3` | `#f9fafb` ~ `#cbd5e1` | 银灰渐变梯度 |

### 字体

```css
font-family: "PingFang SC", "MiSans", "Noto Sans SC", "Source Han Sans SC", sans-serif;
```

### 导航

- 全局使用 `navigationStyle: custom` 自定义导航栏
- 自定义 TabBar 悬浮于页面底部，圆角胶囊造型（`border-radius: 48rpx`），底部留 32rpx 间距
- TabBar 两个入口：首页（`home` 图标）、我的（`user` 图标）

### 卡片样式

- 圆角：`64rpx`（角色卡）、`48rpx`（TabBar）
- 阴影：`0 16rpx 40rpx rgba(17,24,39,0.10)`
- 已完成卡片：银灰渐变 `linear-gradient(160deg, #f9fafb, #e5e7eb, #cbd5e1)`
- 未完成卡片：磨砂遮罩 `rgba(255,255,255,0.65)` + "未完成"标识
- 卡片尺寸：`500rpx × 950rpx`
- 入场动画：`@keyframes riseIn`（上滑淡入）

### 组件库

使用 [TDesign 微信小程序组件库](https://tdesign.tencent.com/miniprogram/getting-started)，常用组件：

`t-icon` · `t-button` · `t-tag` · `t-loading` · `t-avatar` · `t-cell` · `t-cell-group` · `t-image` · `t-badge` · `t-popup` · `t-navbar` · `t-fab`

---

## 开发环境搭建

### 前置要求

- [微信开发者工具](https://developers.weixin.qq.com/miniprogram/dev/devtools/download.html)（稳定版）
- Node.js 16+
- 微信小程序 AppID：`wxabc67471e809a0c7`

### 快速开始

```bash
# 1. 克隆项目
git clone <repo-url>
cd miniprogram-1

# 2. 安装依赖
npm install

# 3. 用微信开发者工具打开项目
#    - 导入项目目录，填入 AppID
#    - 工具 → 构建 npm（将 tdesign-miniprogram 构建到 miniprogram_npm/）

# 4. 云开发
#    - 开通云开发环境（环境 ID: cloud1-0g88vkjh890eca50）
#    - 上传全部云函数（右键各云函数目录 → 上传并部署）
#    - 创建云数据库集合：users、characters

# 5. 编译运行
#    - 在开发者工具中编译预览
```

### npm 构建

项目使用手动指定 npm 构建路径：

```json
// project.config.json
"packNpmManually": true,
"packNpmRelationList": [{
  "packageJsonPath": "./package.json",
  "miniprogramNpmDistDir": "./miniprogram/"
}]
```

修改 `package.json` 依赖后，需在微信开发者工具中重新执行 **工具 → 构建 npm**。

---

## 配置说明

### Dify API 配置

Dify API Key 存放在 `cloudfunctions/difyChat/index.js` 中：

```javascript
const DIFY_API_KEY = 'app-xxxxxxxxxxxxxxxx';  // 替换为你的 Dify API Key
const DIFY_BASE_URL = 'https://api.dify.ai/v1';
```

> ⚠️ API Key 仅在云函数端使用，前端通过 `wx.cloud.callFunction` 间接调用，**不暴露任何密钥**。

### 创作点计费配置（比率与充值方案）

计费比率与充值方案都在云函数配置文件中，修改后需重新上传对应云函数。

- 主配置（充值方案、分享活动、token 计费）：
  - [cloudfunctions/billing/billingConfig.js](cloudfunctions/billing/billingConfig.js)
  - 可调整字段：
    - `TOKEN_UNIT`：token 计费的统计粒度（例如 1000，表示每 1000 tokens 计费一次）
    - `TOKEN_COST`：每个 `TOKEN_UNIT` 消耗的创作点数
    - `CARD_GEN_COST`：角色卡生成的固定消耗创作点数
    - `REGISTER_BONUS`：新用户注册赠送创作点数
    - `SHARE_DAILY_BONUS`：每日分享奖励创作点数（需结合分享幂等逻辑）
    - `RECHARGE_PACKS`：充值方案数组，字段说明：
      - `price`：人民币金额
      - `points`：购买得到的创作点数
      - `bonus`：赠送创作点数（可选）
      - `bonusText`：展示用文案（可选，例如“多送 15%”）
    - `ACTIVITY`：活动展示文案：
      - `title`：活动标题
      - `subtitle`：活动副标题
- Dify 扣费配置（对话与角色卡生成）：
  - [cloudfunctions/difyChat/billingConfig.js](cloudfunctions/difyChat/billingConfig.js)
- 注册奖励配置：
  - [cloudfunctions/login/billingConfig.js](cloudfunctions/login/billingConfig.js)

修改完成后，请在微信开发者工具中重新上传并部署对应云函数。

### 云开发环境

```javascript
// app.ts
wx.cloud.init({
  env: 'cloud1-0g88vkjh890eca50',
  traceUser: true,
});
```

### TypeScript 配置

- 目标：ES2020
- 模块：CommonJS
- 全量严格模式（`strict: true`）
- 类型根目录：`./typings`

---

## 待完成事项

- [ ] 
- [ ] 
- [ ] 
- [ ] 
- [ ] 
- [ ] 
- [ ] 
