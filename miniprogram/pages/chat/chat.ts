// 创建角色 - AI对话页面（集成 Dify）
import type { IMessage } from '../../services/storage';
import {
  saveConversation as storageSaveConversation,
  saveCharacter,
  getCharacter,
  createCharacterDraftInCloud,
  fetchConversationFromCloud,
  getConversationLocal,
  getCurrentUserId,
  PLACEHOLDER_IMAGE,
} from '../../services/storage';
import { getLocalUserInfo } from '../../services/user';
import type { IAgentResponse } from '../../services/agent';
import { chatWithDify, generateCharacterCard } from '../../services/agent';
import { uploadImagesToCloud } from '../../services/image';

const WELCOME_CONTENT = '你好！我是你的角色创作助手\n\n告诉我你的想法吧！可以是角色的外貌、性格、背景故事，或者任何零散的灵感。\n\n你也可以上传参考图片~';
const DIFY_ERROR_TEXT = 'AI服务出现错误，请联系管理员处理';

// AI思考中轮播文本（可自定义）
const PENDING_TEXTS = [
  '正在思考中',
  '正在整合变量',
  '正在构建角色信息',
  '正在整理回复',
  '正在准备接收回复',
];

// 打字机效果状态（模块级变量）
let _typewriterTimer: any = null;
let _typewriterFullText = '';
let _typewriterMsgIndex = -1;
let _pendingBlockModalShowing = false;
let _pendingSyncTimer: any = null;
let _exitGiveResultInFlight = false;
let _exitGiveResultForCard = '';

// AI思考中轮播状态
let _pendingTextTimer: any = null;
let _currentPendingTextIndex = 0;

Page({
  data: {
    characterId: '',
    difyConversationId: '',
    inputValue: '',
    messages: [] as IMessage[],
    isGenerating: false,
    isSending: false,
    scrollTop: 0,
    keyboardHeight: 0,
    userAvatar: '',
  },

  onLoad(options: { characterId?: string }) {
    this.loadUserAvatar();
    if (options.characterId) {
      this.setData({ characterId: options.characterId });
      this.loadExistingConversation(options.characterId);
    } else {
      this.showWelcomeMessage();
    }
  },

  loadUserAvatar() {
    const userInfo = getLocalUserInfo();
    if (userInfo?.avatar) {
      this.setData({ userAvatar: userInfo.avatar });
    }
  },

  onShow() {
    this.startPendingSyncIfNeeded();
  },

  onHide() {
    this.stopPendingSync();
    this.stopPendingTextRotation();
    this.requestGiveResultOnExit();
  },

  // 显示欢迎消息
  showWelcomeMessage() {
    const welcomeMessage: IMessage = {
      id: 'welcome',
      role: 'ai',
      content: WELCOME_CONTENT,
      timestamp: Date.now(),
      userId: 'ai',
    };
    this.setData({ messages: [welcomeMessage] });
    this.scrollToBottom();
  },

  // 加载已有对话（恢复 difyConversationId）
  async loadExistingConversation(characterId: string) {
    // 云端优先，失败则回退本地缓存
    const cloudMessages = await fetchConversationFromCloud(characterId);
    const localMessages = getConversationLocal(characterId);
    const messages = mergeConversationMessages(cloudMessages || [], localMessages || []);

    if (messages.length > 0) {
      this.setData({ messages: finalizeStalePendingMessages(ensureWelcomeMessage(messages)) });
    } else {
      this.showWelcomeMessage();
    }

    // 从角色卡恢复 Dify 会话 ID
    const card = getCharacter(characterId);
    if (card && card.conversationId) {
      this.setData({ difyConversationId: card.conversationId });
    }

    this.scrollToBottom();
    this.startPendingSyncIfNeeded();
  },

  // 输入框变化
  onInput(e: WechatMiniprogram.Input) {
    this.setData({ inputValue: e.detail.value });
  },

  // 输入框行数变化（自动增高时触发）
  onLineChange() {
    // 输入框高度变化时，确保消息列表滚动到底部，避免被遮挡
    this.scrollToBottom();
  },

  // 键盘高度变化（核心：防止闪烁）
  onKeyboardChange(e: any) {
    const height = e.detail.height || 0;
    this.setData({ keyboardHeight: height });
    if (height > 0) {
      this.scrollToBottom();
    }
  },

  // 输入框获焦
  onInputFocus() {
    // 延迟滚动，等键盘动画完成
    setTimeout(() => this.scrollToBottom(), 300);
  },

  // 输入框失焦
  onInputBlur() {
    this.setData({ keyboardHeight: 0 });
  },

  // 发送消息
  async onSend() {
    const { inputValue, messages, difyConversationId, characterId, isSending } = this.data;
    if (!inputValue.trim()) return;
    if (isSending) {
      wx.showToast({ title: '上一条消息处理中', icon: 'none' });
      return;
    }
    if (hasRecentPendingMessage(messages)) {
      this.showPendingMessageBlockedModal();
      return;
    }

    this.setData({ isSending: true });

    // 余额为负时拦截，直接在对话中插入提示消息
    const balanceOk = await this.checkBalanceNotNegative();
    if (!balanceOk) {
      const { messages } = this.data;
      this.setData({
        isSending: false,
        messages: [...messages, {
          id: `balance_err_${Date.now()}`,
          role: 'ai',
          content: '创作点不足，请前往充值页面充值后继续对话。',
          timestamp: Date.now(),
          userId: 'ai',
        }],
      });
      this.scrollToBottom();
      return;
    }

    // 如果打字机正在运行，先完成它
    this.finishTypewriter();

    const userText = inputValue.trim();
    const requestId = `${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;

    try {
      const userMessage: IMessage = {
        id: `user_${requestId}`,
        role: 'user',
        content: userText,
        timestamp: Date.now(),
        animate: true,
        requestId,
        userId: getCurrentUserId(),
      };

      const newMessages = [...messages, userMessage];
      // 从第一个文本开始（按顺序播放）
      _currentPendingTextIndex = 0;
      const aiPlaceholder: IMessage = {
        id: `ai_${requestId}`,
        role: 'ai',
        content: '',
        timestamp: Date.now(),
        animate: true,
        pending: true,
        pendingText: PENDING_TEXTS[_currentPendingTextIndex],
        requestId,
        userId: 'ai',
      };

      const updatedMessages = [...newMessages, aiPlaceholder];
      this.setData({
        messages: updatedMessages,
        inputValue: '',
      });
      await new Promise<void>((resolve) => wx.nextTick(resolve));
      this.scrollToBottom();

      // 启动思考中文本轮播
      this.startPendingTextRotation(aiPlaceholder.id);

      const pendingId = aiPlaceholder.id;

      // 首次发送时，创建未完成角色卡（需要登录）
      let activeCardId = characterId;
      if (!activeCardId) {
        const app = getApp<IAppOption>();
        if (!app.globalData.openId) {
          this.resolvePendingMessage(pendingId, {
            pending: false,
            content: '请先登录后再创建角色卡',
            transient: true,
          });
          wx.showModal({
            title: '请先登录',
            content: '创建角色卡需要先登录账号',
            confirmText: '去登录',
            cancelText: '取消',
            success: (res) => {
              if (res.confirm) {
                wx.navigateBack();
                setTimeout(() => wx.switchTab({ url: '/pages/profile/profile' }), 300);
              }
            },
          });
          return;
        }

        const draft = await createCharacterDraftInCloud();
        if (!draft) {
          this.resolvePendingMessage(pendingId, {
            pending: false,
            content: '创建角色卡失败，请重试',
            transient: true,
          });
          wx.showToast({ title: '创建角色卡失败', icon: 'none' });
          return;
        }

        // 初始草稿已在云端创建，本地仅缓存加速
        saveCharacter(draft, false);
        activeCardId = draft.id;
        this.setData({ characterId: draft.id });
      }

      // 调用 Dify API
      const response = await chatWithDify(userText, difyConversationId, activeCardId, requestId).catch((err: any) => {
        console.error('chatWithDify 异常:', err);
        return { success: false, message: '', error: err?.message || String(err) } as IAgentResponse;
      });

      if (response.success && response.message) {
        const newConvId = response.conversationId || difyConversationId;
        if (newConvId && newConvId !== difyConversationId) {
          this.setData({ difyConversationId: newConvId });
          this.updateCardConversationId(newConvId);
        }

        const msgIndex = this.findMessageIndexById(pendingId);
        if (msgIndex >= 0) {
          this.setData({ [`messages[${msgIndex}].pending`]: false });
          // 停止思考中文本轮播
          this.stopPendingTextRotation();
          // 启动打字机流式显示
          this.streamDisplayMessage(response.message, msgIndex);
        } else {
          // 停止思考中文本轮播
          this.stopPendingTextRotation();
          const fallbackMessages = this.appendAiFallbackMessage(requestId);
          this.setData({ messages: fallbackMessages });
          this.streamDisplayMessage(response.message, fallbackMessages.length - 1);
        }
      } else {
        // 停止思考中文本轮播
        this.stopPendingTextRotation();

        const errDetail = response.error || response.message || '未知错误';
        console.error('Dify 调用失败，详细原因:', errDetail);
        const failText = 'AI服务出现错误，请联系管理员处理';

        const msgIndex = this.findMessageIndexById(pendingId);
        if (msgIndex >= 0) {
          this.setData({
            [`messages[${msgIndex}].pending`]: false,
            [`messages[${msgIndex}].content`]: failText,
            [`messages[${msgIndex}].transient`]: true,
          });
        } else {
          const errorMessage = {
            ...this.appendAiFallbackMessage(requestId).slice(-1)[0],
            content: failText,
            transient: true,
          } as IMessage;
          this.setData({ messages: [...this.data.messages, errorMessage] });
        }
        this.scrollToBottom();
      }
    } finally {
      this.setData({ isSending: false });
    }
  },

  findMessageIndexById(messageId: string): number {
    return this.data.messages.findIndex((msg) => msg.id === messageId);
  },

  resolvePendingMessage(messageId: string, patch: Partial<IMessage>) {
    const msgIndex = this.findMessageIndexById(messageId);
    if (msgIndex < 0) return;

    const updatePayload: Record<string, any> = {};
    Object.entries(patch).forEach(([key, value]) => {
      updatePayload[`messages[${msgIndex}].${key}`] = value;
    });
    this.setData(updatePayload);
  },

  appendAiFallbackMessage(requestId?: string) {
    const fallbackMessage: IMessage = {
      id: requestId ? `ai_${requestId}` : `ai_${Date.now()}`,
      role: 'ai',
      content: '',
      timestamp: Date.now(),
      animate: true,
      requestId,
      userId: 'ai',
    };
    return [...this.data.messages, fallbackMessage];
  },

  showPendingMessageBlockedModal() {
    if (_pendingBlockModalShowing) return;
    _pendingBlockModalShowing = true;
    wx.showModal({
      title: '消息处理中',
      content: '当前有一条消息正在由 AI 处理，请等待该消息完成后再发送新内容。',
      showCancel: false,
      confirmText: '我知道了',
      success: () => {
        _pendingBlockModalShowing = false;
      },
      fail: () => {
        _pendingBlockModalShowing = false;
      },
    });
  },

  // 更新角色卡的 conversationId
  updateCardConversationId(convId: string) {
    const { characterId } = this.data;
    if (!characterId) return;
    const card = getCharacter(characterId);
    if (card) {
      card.conversationId = convId;
      saveCharacter(card);
    }
  },

  // 选择图片
  async onChooseImage() {
    wx.chooseMedia({
      count: 3,
      mediaType: ['image'],
      sourceType: ['album', 'camera'],
      success: async (res) => {
        const tempFilePaths = res.tempFiles.map((file) => file.tempFilePath);
        wx.showLoading({ title: '上传中...' });
        try {
          const fileIDs = await uploadImagesToCloud(tempFilePaths);

          // 首次上传图片时，创建未完成角色卡（需要登录）
          let { messages, difyConversationId, characterId } = this.data;
          let activeCardId = characterId;
          if (!activeCardId) {
            const app = getApp<IAppOption>();
            if (!app.globalData.openId) {
              wx.showModal({
                title: '请先登录',
                content: '创建角色卡需要先登录账号',
                confirmText: '去登录',
                cancelText: '取消',
                success: (res) => {
                  if (res.confirm) {
                    wx.navigateBack();
                    setTimeout(() => wx.switchTab({ url: '/pages/profile/profile' }), 300);
                  }
                },
              });
              return;
            }

            const draft = await createCharacterDraftInCloud();
            if (!draft) {
              wx.showToast({ title: '创建角色卡失败', icon: 'none' });
              return;
            }

            // 初始草稿已在云端创建，本地仅缓存加速
            saveCharacter(draft, false);
            activeCardId = draft.id;
            this.setData({ characterId: draft.id });
          }

          const userMessage: IMessage = {
            id: `user_${Date.now()}`,
            role: 'user',
            content: '参考图片',
            images: fileIDs,
            timestamp: Date.now(),
            userId: getCurrentUserId(),
          };

          // 同步添加用户消息和 AI 占位消息，避免 setData race
          const requestId = `${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
          const aiPlaceholder: IMessage = {
            id: `ai_${requestId}`,
            role: 'ai',
            content: '',
            timestamp: Date.now(),
            animate: true,
            pending: true,
            pendingText: '正在分析图片',
            requestId,
            userId: 'ai',
          };

          const combined = [...messages, userMessage, aiPlaceholder];
          this.setData({
            messages: combined,
            scrollToMessage: `msg-${aiPlaceholder.id}`,
          });

          // 立刻保存到本地缓存，防止后台定时同步用云端数据覆盖本地占位消息
          try {
            this.saveConversation();
          } catch (e) {
            console.warn('保存本地对话失败:', e);
          }
          // 启动后台定时同步（确保云端写入后能尽快拉取到本地）
          this.startPendingSyncIfNeeded();

          // 调用 chatWithDify，传递 fileIDs
          const response = await chatWithDify('图片参考', difyConversationId, activeCardId, requestId, fileIDs).catch((err: any) => {
            console.error('chatWithDify 图片异常:', err);
            return { success: false, message: '', error: err?.message || String(err) };
          });

          // 更新 conversationId
          if (response.success && 'conversationId' in response && response.conversationId) {
            const newConvId = response.conversationId;
            if (newConvId !== difyConversationId) {
              this.setData({ difyConversationId: newConvId });
              this.updateCardConversationId(newConvId);
            }
          }

          const msgIndex = this.findMessageIndexById(aiPlaceholder.id);
          if (response.success && response.message) {
            if (msgIndex >= 0) {
              this.setData({ [`messages[${msgIndex}].pending`]: false });
              this.streamDisplayMessage(response.message, msgIndex);
            }
          } else {
            if (msgIndex >= 0) {
              this.setData({
                [`messages[${msgIndex}].pending`]: false,
                [`messages[${msgIndex}].content`]: 'AI服务处理图片失败',
                [`messages[${msgIndex}].transient`]: true,
              });
            }
          }
        } catch (err) {
          wx.hideLoading();
          wx.showToast({ title: '图片上传失败', icon: 'none' });
        } finally {
          wx.hideLoading();
        }
      },
    });
  },

  // 预览图片
  onPreviewImage(e: WechatMiniprogram.TouchEvent) {
    const url = e.currentTarget.dataset.url;
    const allImages = this.data.messages
      .filter((m) => m.images && m.images.length > 0)
      .flatMap((m) => m.images || []);
    wx.previewImage({ current: url, urls: allImages });
  },

  // 返回上一页
  onBack() {
    this.finishTypewriter();
    this.saveConversation();
    wx.navigateBack();
  },

  // 确认生成角色卡
  async onConfirm() {
    this.finishTypewriter();
    const { messages, difyConversationId, characterId, isSending } = this.data;

    if (isSending) {
      wx.showToast({ title: '请等待当前回复完成', icon: 'none' });
      return;
    }

    if (messages.length <= 1) {
      wx.showToast({ title: '请先描述你的角色', icon: 'none' });
      return;
    }

    if (!difyConversationId) {
      wx.showToast({ title: '对话未建立，请先发送消息', icon: 'none' });
      return;
    }

    // 余额为负时拦截，直接在对话中插入提示消息
    const balanceOk = await this.checkBalanceNotNegative();
    if (!balanceOk) {
      const { messages } = this.data;
      this.setData({
        messages: [...messages, {
          id: `balance_err_${Date.now()}`,
          role: 'ai',
          content: '创作点不足，请前往充值页面充值后继续生成。',
          timestamp: Date.now(),
          userId: 'ai',
        }],
      });
      this.scrollToBottom();
      return;
    }

    // 显示生成中状态
    this.setData({ isGenerating: true });
    wx.showLoading({ title: '正在生成角色卡...', mask: true });

    try {
      // 发送 "Give_Result" 获取结构化角色卡数据
      const result = await generateCharacterCard(difyConversationId, characterId);

      wx.hideLoading();
      this.setData({ isGenerating: false });

      if (result.success && result.data) {
        // 检查角色卡信息完整性（abilities 和 relationships 为可选，不检查）
        const missingFields = this.checkCharacterCompleteness(result.data);
        const missingFieldsBold = missingFields.map(field => `**${field}**`).join('、');
        if (missingFields.length > 0) {
          wx.hideLoading();
          this.setData({ isGenerating: false, messages: [...messages, {
            id: `uncompleted_${Date.now()}`,
            role: 'ai',
            content: `当前角色信息不完整，缺失必要信息：${missingFieldsBold}，请与我对话补充细节后再生成吧！`,
            timestamp: Date.now(),
            userId: 'ai',
          }]});
          this.scrollToBottom();
         /* wx.showModal({
            title: '角色信息不完整',
            content: `以下必要信息缺失：${missingFields.join('、')}\n\n建议继续与 AI 对话补充细节后再生成。`,
            confirmText: '继续生成',
            cancelText: '返回补充',
            success: (modalRes) => {
              if (modalRes.confirm) {
                this.saveAndNavigateToPreview(result.data!, characterId);
              }
            },
          });*/
          return;
        }

        this.saveAndNavigateToPreview(result.data, characterId);
      } else {
        wx.showToast({
          title: result.error || '生成失败，请重试',
          icon: 'none',
          duration: 2000,
        });
      }
    } catch (error) {
      console.error('生成角色卡失败:', error);
      wx.hideLoading();
      this.setData({ isGenerating: false });
      wx.showToast({ title: '生成失败，请重试', icon: 'none' });
    }
  },

  // 保存角色卡并跳转预览
  saveAndNavigateToPreview(charInfo: any, characterId: string) {
    const card = getCharacter(characterId);
    if (card) {
      card.characterInfo = charInfo;
      card.avatar = card.avatar || PLACEHOLDER_IMAGE;
      card.status = 'completed';
      saveCharacter(card);
    }

    this.saveConversation();

    wx.redirectTo({
      url: `/pages/preview/preview?characterId=${characterId}`,
    });
  },

  // 检查角色卡必填字段完整性（排除 abilities 和 relationships）
  checkCharacterCompleteness(info: any): string[] {
    const missing: string[] = [];
    const checks: [string, string][] = [
      ['name', '角色姓名'],
      ['gender', '性别'],
      ['species', '物种'],
      ['introduction', '角色简介'],
      ['personality', '性格描述'],
      ['backstory', '角色背景'],
    ];

    for (const [key, label] of checks) {
      if (!info[key] || (typeof info[key] === 'string' && !info[key].trim())) {
        missing.push(label);
      }
    }

    // 检查性格标签
    if (!info.personalityTags || !Array.isArray(info.personalityTags) || info.personalityTags.length === 0) {
      missing.push('性格标签');
    }

    // 检查外观
    if (!info.appearance) {
      missing.push('外观描述');
    }

    // 检查雷达图
    if (!info.radar) {
      missing.push('性格六维图');
    }

    return missing;
  },

  // 页面卸载时清理
  onUnload() {
    this.stopPendingSync();
    this.stopPendingTextRotation();
    this.finishTypewriter();
    this.saveConversation();
    this.requestGiveResultOnExit();
  },

  async requestGiveResultOnExit() {
    const { difyConversationId, characterId, isSending, messages } = this.data;
    if (!characterId || !difyConversationId) return;
    if (isSending || hasAnyPendingMessage(messages)) return;

    if (_exitGiveResultInFlight && _exitGiveResultForCard === characterId) return;
    _exitGiveResultInFlight = true;
    _exitGiveResultForCard = characterId;

    try {
      const result = await generateCharacterCard(difyConversationId, characterId);
      if (!result.success || !result.data) return;

      const card = getCharacter(characterId);
      if (!card) return;

      card.characterInfo = result.data;
      card.conversationId = result.conversationId || difyConversationId;
      card.avatar = card.avatar || PLACEHOLDER_IMAGE;
      saveCharacter(card);

      // 退出时不将 Give_Result 结果同步进消息记录（不保存到本地/云端消息）
      // 不做任何消息数组的 setData 或 saveConversation
    } catch (error) {
      console.warn('退出时更新角色卡失败:', error);
    } finally {
      _exitGiveResultInFlight = false;
    }
  },

  startPendingSyncIfNeeded() {
    const { characterId, messages, isSending } = this.data;
    if (!characterId || isSending) return;
    if (!hasAnyPendingMessage(messages)) {
      this.stopPendingSync();
      return;
    }
    if (_pendingSyncTimer) return;

    _pendingSyncTimer = setInterval(async () => {
      if (this.data.isSending) return;
      const { characterId: currentId, messages: currentMessages } = this.data;
      if (!currentId) return;

      const cloudMessages = await fetchConversationFromCloud(currentId);
      // 合并云端消息和本地消息，保留本地 pending 状态
      const merged = mergeCloudMessagesWithLocal(cloudMessages || [], currentMessages);
      const finalized = finalizeStalePendingMessages(ensureWelcomeMessage(merged));
      if (!sameMessageSnapshot(this.data.messages, finalized)) {
        this.setData({ messages: finalized });
        this.scrollToBottom();
      }

      if (!hasAnyPendingMessage(finalized)) {
        this.stopPendingSync();
      }
    }, 1800);
  },

  stopPendingSync() {
    if (_pendingSyncTimer) {
      clearInterval(_pendingSyncTimer);
      _pendingSyncTimer = null;
    }
  },

  // 滚动到页面底部
  scrollToBottom() {
    wx.nextTick(() => {
      const query = this.createSelectorQuery();
      query.select('.message-list').boundingClientRect();
      query.select('.chat-container').boundingClientRect();
      query.exec((res: any) => {
        if (res && res[0] && res[1]) {
          const listHeight = res[0].height || 0;
          const containerHeight = res[1].height || 0;
          if (listHeight > containerHeight) {
            this.setData({ scrollTop: listHeight + 500 });
          }
        }
      });
    });
  },

  // 启动思考中文本轮播（按顺序播放）
  startPendingTextRotation(messageId: string) {
    this.stopPendingTextRotation();
    _currentPendingTextIndex = 0; // 从第一个开始，按顺序播放

    // 启动轮播
    this.runPendingTextRotation(messageId);
  },

  // 执行单次轮播（每次间隔3-8秒随机）
  runPendingTextRotation(messageId: string) {
    const msgIndex = this.findMessageIndexById(messageId);
    if (msgIndex < 0) {
      this.stopPendingTextRotation();
      return;
    }
    const msg = this.data.messages[msgIndex];
    if (!msg || !msg.pending) {
      this.stopPendingTextRotation();
      return;
    }

    // 顺序切换到下一个文本
    _currentPendingTextIndex = (_currentPendingTextIndex + 1) % PENDING_TEXTS.length;
    this.setData({
      [`messages[${msgIndex}].pendingText`]: PENDING_TEXTS[_currentPendingTextIndex],
    });

    // 3-8秒后执行下一次轮播
    const nextInterval = 3000 + Math.random() * 5000;
    _pendingTextTimer = setTimeout(() => {
      this.runPendingTextRotation(messageId);
    }, nextInterval);
  },

  // 停止思考中文本轮播
  stopPendingTextRotation() {
    if (_pendingTextTimer) {
      clearTimeout(_pendingTextTimer);
      _pendingTextTimer = null;
    }
  },

  // 打字机流式显示 AI 回复
  streamDisplayMessage(fullText: string, msgIndex: number) {
    this.finishTypewriter();

    _typewriterFullText = fullText;
    _typewriterMsgIndex = msgIndex;

    // 关闭入场动画，避免每次 setData 触发闪烁
    this.setData({
      [`messages[${msgIndex}].animate`]: false,
    });

    let charIndex = 0;
    let scrollTick = 0;
    // 根据文本长度调整每次显示字符数和间隔
    const batchSize = fullText.length > 500 ? 8 : 3;
    const interval = 10; // 降低频率，减少 setData 次数

    _typewriterTimer = setInterval(() => {
      charIndex = Math.min(charIndex + batchSize, fullText.length);
      scrollTick++;

      this.setData({
        [`messages[${msgIndex}].content`]: fullText.substring(0, charIndex),
      });


      // 每 500ms 滚动一次 + 完成时滚动
      if (scrollTick % 10 === 0 || charIndex >= fullText.length) {
        this.scrollToBottom();
      }

      if (charIndex >= fullText.length) {
        clearInterval(_typewriterTimer);
        _typewriterTimer = null;
        _typewriterFullText = '';
        _typewriterMsgIndex = -1;
        this.saveConversation();
      }
    }, interval);
  },

  // 立即完成打字机效果（用于发送新消息、离开页面等场景）
  finishTypewriter() {
    if (_typewriterTimer) {
      clearInterval(_typewriterTimer);
      _typewriterTimer = null;
    }
    if (_typewriterFullText && _typewriterMsgIndex >= 0) {
      this.setData({
        [`messages[${_typewriterMsgIndex}].content`]: _typewriterFullText,
      });
      _typewriterFullText = '';
      _typewriterMsgIndex = -1;
    }
  },

  // 保存对话到本地
  saveConversation() {
    const { messages, characterId } = this.data;
    if (!characterId) return;
    // 避免将失败提示或结果 JSON 同步到云端
    const sanitized = sanitizeMessages(messages);
    const hasUserMessage = sanitized.some((message) => {
      if (message.role !== 'user') return false;
      const content = (message.content || '').trim();
      return content.length > 0 || (message.images && message.images.length > 0);
    });
    if (!hasUserMessage) return;
    storageSaveConversation(characterId, sanitized);
  },

  // 检查创作点余额是否 >= 0，负数时返回 false 由调用方在对话中插入提示
  async checkBalanceNotNegative(): Promise<boolean> {
    try {
      const res = await wx.cloud.callFunction({
        name: 'billing',
        data: { action: 'overview' },
      });

      const result = res.result as any;
      if (result.code !== 0 || !result.data) return true;

      const balance = Number(result.data.balance ?? 0);
      return balance >= 0;
    } catch (err) {
      console.error('获取余额失败:', err);
      return true;
    }
  },
});

function sanitizeMessages(messages: IMessage[]): IMessage[] {
  return messages.filter((message) => {
    if (message.transient) return false;
    const content = (message.content || '').trim();
    if (message.role === 'ai' && content.startsWith('调用失败:')) return false;
    // 过滤 Give_Result 结果的结构化 JSON 文本
    if (message.role === 'ai' && looksLikeResultJson(content)) return false;
    return true;
  });
}

function mergeConversationMessages(cloudMessages: IMessage[], localMessages: IMessage[]): IMessage[] {
  const merged = new Map<string, IMessage>();

  const pushMessage = (message: IMessage) => {
    if (!message || !message.id) return;
    const existing = merged.get(message.id);
    if (!existing) {
      merged.set(message.id, message);
      return;
    }

    if (existing.pending && !message.pending) {
      merged.set(message.id, message);
      return;
    }

    if (!existing.pending && message.pending) {
      return;
    }

    if ((message.content || '').length > (existing.content || '').length) {
      merged.set(message.id, message);
    }
  };

  cloudMessages.forEach(pushMessage);
  localMessages.forEach(pushMessage);

  const result = Array.from(merged.values());
  result.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
  return result;
}

function hasRecentPendingMessage(messages: IMessage[], ttlMs = 180000): boolean {
  const now = Date.now();
  return messages.some((message) => {
    if (!message.pending) return false;
    const ts = Number(message.timestamp || 0);
    return ts > 0 && now - ts < ttlMs;
  });
}

function hasAnyPendingMessage(messages: IMessage[]): boolean {
  return messages.some((message) => !!message.pending);
}

function sameMessageSnapshot(a: IMessage[], b: IMessage[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const m1 = a[i];
    const m2 = b[i];
    if (m1.id !== m2.id) return false;
    if (m1.pending !== m2.pending) return false;
    if ((m1.content || '') !== (m2.content || '')) return false;
  }
  return true;
}

function finalizeStalePendingMessages(messages: IMessage[], timeoutMs = 150000): IMessage[] {
  const now = Date.now();
  return messages.map((message) => {
    if (!message.pending) return message;
    const timestamp = Number(message.timestamp || 0);
    if (!timestamp || now - timestamp < timeoutMs) return message;

    return {
      ...message,
      pending: false,
      content: DIFY_ERROR_TEXT,
      transient: true,
    };
  });
}

function ensureWelcomeMessage(messages: IMessage[]): IMessage[] {
  const normalized = [...messages];
  const exists = normalized.some((message) => message.id === 'welcome');
  if (exists) return normalized;

  return [
    {
      id: 'welcome',
      role: 'ai',
      content: WELCOME_CONTENT,
      timestamp: Date.now(),
      userId: 'ai',
    },
    ...normalized,
  ];
}

/**
 * 合并云端消息和本地消息
 * - 以本地消息为基础（保留 pending 状态）
 * - 补充云端有但本地没有的消息
 * - 用云端的非 pending 消息替换本地的 pending 消息（相同 requestId）
 */
function mergeCloudMessagesWithLocal(cloudMessages: IMessage[], localMessages: IMessage[]): IMessage[] {
  const result = [...localMessages];
  const localIds = new Set(localMessages.map(m => m.id));
  const localRequestIds = new Map(localMessages.map(m => [m.requestId, m]));

  for (const cloudMsg of cloudMessages) {
    // 如果本地已有相同 ID 的消息，跳过
    if (localIds.has(cloudMsg.id)) continue;

    // 如果云端消息有 requestId，且本地有相同 requestId 的 pending 消息
    if (cloudMsg.requestId) {
      const localMsg = localRequestIds.get(cloudMsg.requestId);
      if (localMsg && localMsg.pending && !cloudMsg.pending) {
        // 用云端消息替换本地 pending 消息
        const index = result.findIndex(m => m.id === localMsg.id);
        if (index >= 0) {
          result[index] = { ...cloudMsg };
          continue;
        }
      }
    }

    // 否则将云端消息添加到结果中
    result.push({ ...cloudMsg });
  }

  // 按时间戳排序
  return result.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
}

function looksLikeResultJson(content: string): boolean {
  const normalized = content.replace(/```(?:json)?/g, '').trim();
  if (!normalized.startsWith('{')) return false;
  return /personality_tags|personalityTags/.test(normalized)
    && /appearance/.test(normalized)
    && /backstory/.test(normalized);
}
