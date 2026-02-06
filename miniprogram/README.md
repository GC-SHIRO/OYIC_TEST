# O亿C 小程序前端开发说明

## 项目结构

```
miniprogram/
├── app.json                    # 小程序全局配置
├── app.ts                      # 小程序入口文件
├── app.wxss                    # 全局样式
├── assets/                     # 静态资源
│   ├── icons/                  # 图标资源
│   └── images/                 # 图片资源
├── components/                 # 自定义组件
│   └── custom-tabbar/         # 自定义 TabBar 组件
├── custom-tab-bar/            # 自定义 TabBar（小程序规范目录）
├── pages/                      # 页面目录
│   ├── home/                   # 首页 - 角色卡中心
│   ├── profile/                # 我的 - 用户中心
│   ├── chat/                   # 创建角色 - AI对话页面
│   └── preview/                # 预览角色卡页面
├── services/                   # 服务模块
│   ├── agent.ts               # Agent API 服务（接入 Coze）
│   └── storage.ts             # 本地存储服务
└── utils/                      # 工具函数
```

## 页面说明

### 1. 首页 (pages/home)
- 展示用户创建的角色卡片（横向滚动列表）
- 区分已完成和未完成的角色
- 提供新建角色入口

### 2. 创建角色 (pages/chat)
- 仿AI聊天界面，与Agent对话
- 支持上传参考图片
- 右上角确认按钮跳转到预览页

### 3. 预览角色卡 (pages/preview)
- 展示生成的角色信息卡
- 支持选择不同模板
- 确认创建或继续创作

### 4. 我的 (pages/profile)
- 用户信息展示与编辑
- 我的作品列表
- 系统功能菜单

## 接入 Coze API

在 `services/agent.ts` 中修改配置：

```typescript
const API_CONFIG = {
  baseUrl: 'https://api.coze.cn',  // Coze API 地址
  apiKey: 'YOUR_COZE_API_KEY',     // 替换为你的 API Key
  botId: 'YOUR_BOT_ID'             // 替换为你的 Bot ID
};
```

## TDesign 组件使用

项目使用 TDesign 微信小程序组件库，已安装在 `miniprogram_npm/tdesign-miniprogram/`。

常用组件：
- `t-icon` - 图标
- `t-button` - 按钮
- `t-tag` - 标签
- `t-loading` - 加载
- `t-avatar` - 头像
- `t-cell` - 单元格
- `t-divider` - 分割线

## 开发注意事项

1. 使用自定义 TabBar 实现圆角悬浮效果
2. 所有页面使用 `navigationStyle: custom` 自定义导航栏
3. 颜色主题：深蓝灰渐变 `linear-gradient(135deg, #0f172a 0%, #334155 100%)`
4. 边框圆角统一使用较大值（32rpx - 64rpx）

## 待完成事项

- [ ] 添加实际的角色图片资源
- [ ] 接入真实的 Coze API
- [ ] 实现图片上传到云存储
- [ ] 添加用户登录授权
- [ ] 完善错误处理和加载状态
