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

// AI思考中轮播文本
const PENDING_TEXTS = [
  '正在思考中',
  '正在整合变量',
  '正在构建角色信息',
  '正在整理回复',
  '正在准备接收回复',
];

// 模块级状态
let _typewriterTimer: any = null;
let _typewriterFullText = '';
let _typewriterMsgIndex = -1;
let _typewriterMsgId = ''; // 正在打字的消息ID
let _pendingBlockModalShowing = false;
let _pendingSyncTimer: any = null;
let _exitGiveResultInFlight = false;
let _exitGiveResultForCard = '';
let _pendingTextTimer: any = null;
let _currentPendingTextIndex = 0;
let _isTypewriting = false; // 是否正在打字机效果中
let _messageSequence = 0; // 消息序号生成器

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

  // 显示欢迎消息（仅用于新对话）
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

  // 加载已有对话
  async loadExistingConversation(characterId: string) {
    // 先显示本地缓存，快速响应
    const localMessages = getConversationLocal(characterId);
    if (localMessages.length > 0) {
      this.setData({ messages: ensureWelcomeMessage(localMessages) });
    } else {
      this.showWelcomeMessage();
    }

    // 从角色卡恢复 Dify 会话 ID
    const card = getCharacter(characterId);
    if (card?.conversationId) {
      this.setData({ difyConversationId: card.conversationId });
    }

    this.scrollToBottom();

    // 异步拉取云端消息并同步
    try {
      const cloudMessages = await fetchConversationFromCloud(characterId);
      if (cloudMessages.length > 0) {
        const merged = mergeMessages(cloudMessages, this.data.messages);
        this.setData({ messages: ensureWelcomeMessage(merged) });
        // 保存到本地缓存
        storageSaveConversation(characterId, merged);
      }
    } catch (err) {
      console.warn('拉取云端消息失败:', err);
    }

    this.startPendingSyncIfNeeded();
  },

  // 输入框变化
  onInput(e: WechatMiniprogram.Input) {
    this.setData({ inputValue: e.detail.value });
  },

  onLineChange() {
    this.scrollToBottom();
  },

  onKeyboardChange(e: any) {
    const height = e.detail.height || 0;
    this.setData({ keyboardHeight: height });
    if (height > 0) {
      this.scrollToBottom();
    }
  },

  onInputFocus() {
    setTimeout(() => this.scrollToBottom(), 300);
  },

  onInputBlur() {
    this.setData({ keyboardHeight: 0 });
  },

  // 发送文字消息
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

    // 余额检查
    const balanceOk = await this.checkBalanceNotNegative();
    if (!balanceOk) {
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

    this.finishTypewriter();

    const userText = inputValue.trim();
    const requestId = generateRequestId();

    try {
      // 首次发送时创建角色卡草稿
      let activeCardId = characterId;
      if (!activeCardId) {
        const draft = await this.createCharacterDraft();
        if (!draft) {
          this.setData({ isSending: false });
          return;
        }
        activeCardId = draft;
      }

      // 添加用户消息和 AI 占位消息到本地（仅用于显示）
      const userMessage: IMessage = {
        id: `user_${requestId}`,
        role: 'user',
        content: userText,
        timestamp: Date.now(),
        animate: true,
        requestId,
        userId: getCurrentUserId(),
        sequence: getNextSequence(),
      };

      const aiPlaceholder: IMessage = {
        id: `ai_${requestId}`,
        role: 'ai',
        content: '',
        timestamp: Date.now(),
        animate: true,
        pending: true,
        pendingText: PENDING_TEXTS[0],
        requestId,
        userId: 'ai',
        sequence: getNextSequence(),
      };

      const updatedMessages = [...messages, userMessage, aiPlaceholder];
      this.setData({
        messages: updatedMessages,
        inputValue: '',
      });
      this.scrollToBottom();

      // 启动思考中文本轮播
      this.startPendingTextRotation(aiPlaceholder.id);

      // 调用 Dify API
      const response = await chatWithDify(userText, difyConversationId, activeCardId, requestId);

      // 停止思考中文本轮播
      this.stopPendingTextRotation();

      if (response.success && response.message) {
        // 更新 conversationId
        if (response.conversationId && response.conversationId !== difyConversationId) {
          this.setData({ difyConversationId: response.conversationId });
          this.updateCardConversationId(response.conversationId);
        }

        // 更新 AI 消息
        const msgIndex = this.findMessageIndexById(aiPlaceholder.id);
        if (msgIndex >= 0) {
          this.setData({ [`messages[${msgIndex}].pending`]: false });
          this.streamDisplayMessage(response.message, msgIndex);
        }
      } else {
        // 处理错误
        const msgIndex = this.findMessageIndexById(aiPlaceholder.id);
        if (msgIndex >= 0) {
          this.setData({
            [`messages[${msgIndex}].pending`]: false,
            [`messages[${msgIndex}].content`]: DIFY_ERROR_TEXT,
            [`messages[${msgIndex}].transient`]: true,
          });
        }
      }
    } catch (err) {
      console.error('发送消息失败:', err);
      wx.showToast({ title: '发送失败', icon: 'none' });
    } finally {
      this.setData({ isSending: false });
      this.startPendingSyncIfNeeded();
    }
  },

  // 创建角色卡草稿
  async createCharacterDraft(): Promise<string | null> {
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
      return null;
    }

    const draft = await createCharacterDraftInCloud();
    if (!draft) {
      wx.showToast({ title: '创建角色卡失败', icon: 'none' });
      return null;
    }

    saveCharacter(draft, false);
    this.setData({ characterId: draft.id });
    return draft.id;
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

          // 首次上传时创建角色卡草稿
          let { messages, difyConversationId, characterId } = this.data;
          let activeCardId = characterId;
          if (!activeCardId) {
            const draft = await this.createCharacterDraft();
            if (!draft) {
              wx.hideLoading();
              return;
            }
            activeCardId = draft;
          }

          const requestId = generateRequestId();

          // 添加用户消息和 AI 占位消息到本地
          const userMessage: IMessage = {
            id: `user_${requestId}`,
            role: 'user',
            content: '参考图片',
            images: fileIDs,
            timestamp: Date.now(),
            userId: getCurrentUserId(),
            sequence: getNextSequence(),
          };

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
            sequence: getNextSequence(),
          };

          const updatedMessages = [...messages, userMessage, aiPlaceholder];
          this.setData({
            messages: updatedMessages,
            scrollToMessage: `msg-${aiPlaceholder.id}`,
          });
          this.scrollToBottom();

          // 调用 Dify API
          const response = await chatWithDify('图片参考', difyConversationId, activeCardId, requestId, fileIDs);

          // 更新 conversationId
          if (response.success && response.conversationId && response.conversationId !== difyConversationId) {
            this.setData({ difyConversationId: response.conversationId });
            this.updateCardConversationId(response.conversationId);
          }

          // 更新 AI 消息
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
          console.error('上传图片失败:', err);
          wx.showToast({ title: '图片上传失败', icon: 'none' });
        } finally {
          wx.hideLoading();
          this.startPendingSyncIfNeeded();
        }
      },
    });
  },

  // 启动后台同步
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
      // 打字机效果进行中时暂停同步，避免消息被覆盖
      if (_isTypewriting) return;
      const { characterId: currentId } = this.data;
      if (!currentId) return;

      try {
        const cloudMessages = await fetchConversationFromCloud(currentId);
        // 使用智能合并，保留本地更完整的内容
        const finalized = finalizeStalePendingMessages(ensureWelcomeMessage(cloudMessages || []));
        const merged = smartMergeMessages(this.data.messages, finalized);
        if (!sameMessageSnapshot(this.data.messages, merged)) {
          this.setData({ messages: merged });
          this.scrollToBottom();
        }

        if (!hasAnyPendingMessage(merged)) {
          this.stopPendingSync();
        }
      } catch (err) {
        console.warn('同步云端消息失败:', err);
      }
    }, 2000);
  },

  stopPendingSync() {
    if (_pendingSyncTimer) {
      clearInterval(_pendingSyncTimer);
      _pendingSyncTimer = null;
    }
  },

  // 打字机效果
  streamDisplayMessage(fullText: string, messageIndex: number) {
    if (_typewriterTimer) {
      clearInterval(_typewriterTimer);
    }

    _typewriterFullText = fullText;
    _typewriterMsgIndex = messageIndex;
    _isTypewriting = true;
    const msg = this.data.messages[messageIndex];
    _typewriterMsgId = msg?.id || '';
    let currentIndex = 0;

    const updateMessage = () => {
      if (currentIndex >= fullText.length) {
        clearInterval(_typewriterTimer);
        _typewriterTimer = null;
        _isTypewriting = false;
        _typewriterMsgId = '';
        this.saveConversation();
        return;
      }

      currentIndex += 2;
      const displayText = fullText.slice(0, currentIndex);
      this.setData({
        [`messages[${messageIndex}].content`]: displayText,
      });
    };

    _typewriterTimer = setInterval(updateMessage, 16);
  },

  finishTypewriter() {
    if (_typewriterTimer && _typewriterMsgIndex >= 0) {
      clearInterval(_typewriterTimer);
      _typewriterTimer = null;
      _isTypewriting = false;
      this.setData({
        [`messages[${_typewriterMsgIndex}].content`]: _typewriterFullText,
      });
      _typewriterMsgId = '';
    }
  },

  // 思考中文本轮播
  startPendingTextRotation(messageId: string) {
    this.stopPendingTextRotation();
    _currentPendingTextIndex = 0;

    const rotate = () => {
      const msgIndex = this.findMessageIndexById(messageId);
      if (msgIndex < 0) {
        this.stopPendingTextRotation();
        return;
      }
      const msg = this.data.messages[msgIndex];
      if (!msg?.pending) {
        this.stopPendingTextRotation();
        return;
      }

      _currentPendingTextIndex = (_currentPendingTextIndex + 1) % PENDING_TEXTS.length;
      this.setData({
        [`messages[${msgIndex}].pendingText`]: PENDING_TEXTS[_currentPendingTextIndex],
      });

      _pendingTextTimer = setTimeout(() => rotate(), 3000 + Math.random() * 2000);
    };

    rotate();
  },

  stopPendingTextRotation() {
    if (_pendingTextTimer) {
      clearTimeout(_pendingTextTimer);
      _pendingTextTimer = null;
    }
  },

  // 工具方法
  findMessageIndexById(messageId: string): number {
    return this.data.messages.findIndex((msg) => msg.id === messageId);
  },

  updateCardConversationId(convId: string) {
    const { characterId } = this.data;
    if (!characterId) return;
    const card = getCharacter(characterId);
    if (card) {
      card.conversationId = convId;
      saveCharacter(card);
    }
  },

  saveConversation() {
    const { characterId, messages } = this.data;
    if (characterId) {
      storageSaveConversation(characterId, messages);
    }
  },

  scrollToBottom() {
    wx.nextTick(() => {
      const query = this.createSelectorQuery();
      query.select('.message-list').boundingClientRect();
      query.select('.chat-container').boundingClientRect();
      query.exec((res: any) => {
        if (res?.[0] && res?.[1]) {
          const listHeight = res[0].height || 0;
          const containerHeight = res[1].height || 0;
          if (listHeight > containerHeight) {
            this.setData({ scrollTop: listHeight + 500 });
          }
        }
      });
    });
  },

  // 余额检查
  async checkBalanceNotNegative(): Promise<boolean> {
    try {
      const res = await wx.cloud.callFunction({
        name: 'billing',
        data: { action: 'overview' },
      });
      const result = res.result as any;
      if (result.code !== 0 || !result.data) return true;
      return (result.data.balance || 0) >= 0;
    } catch {
      return true;
    }
  },

  showPendingMessageBlockedModal() {
    if (_pendingBlockModalShowing) return;
    _pendingBlockModalShowing = true;
    wx.showModal({
      title: '消息处理中',
      content: '当前有一条消息正在由 AI 处理，请等待该消息完成后再发送新内容。',
      showCancel: false,
      confirmText: '我知道了',
      success: () => { _pendingBlockModalShowing = false; },
      fail: () => { _pendingBlockModalShowing = false; },
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

  // 返回
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

    const balanceOk = await this.checkBalanceNotNegative();
    if (!balanceOk) {
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

    this.setData({ isGenerating: true });
    wx.showLoading({ title: '正在生成角色卡...', mask: true });

    try {
      const result = await generateCharacterCard(difyConversationId, characterId);

      if (result.success && result.data) {
        const missingFields = this.checkCharacterCompleteness(result.data);
        if (missingFields.length > 0) {
          const missingFieldsBold = missingFields.map((f: string) => `**${f}**`).join('、');
          this.setData({
            isGenerating: false,
            messages: [...messages, {
              id: `uncompleted_${Date.now()}`,
              role: 'ai',
              content: `当前角色信息不完整，缺失必要信息：${missingFieldsBold}，请与我对话补充细节后再生成吧！`,
              timestamp: Date.now(),
              userId: 'ai',
            }],
          });
          this.scrollToBottom();
        } else {
          this.saveAndNavigateToPreview(result.data, characterId);
        }
      } else {
        wx.showToast({ title: result.error || '生成失败', icon: 'none' });
      }
    } catch (error) {
      console.error('生成角色卡失败:', error);
      wx.showToast({ title: '生成失败', icon: 'none' });
    } finally {
      wx.hideLoading();
      this.setData({ isGenerating: false });
    }
  },

  checkCharacterCompleteness(info: any): string[] {
    const missing: string[] = [];
    const checks = [
      ['name', '角色名称'],
      ['gender', '角色性别'],
      ['backstory', '角色背景'],
    ];

    for (const [key, label] of checks) {
      if (!info[key] || (typeof info[key] === 'string' && !info[key].trim())) {
        missing.push(label);
      }
    }

    if (!info.personalityTags?.length) missing.push('性格标签');
    if (!info.appearance) missing.push('外观描述');
    if (!info.radar) missing.push('性格六维图');

    return missing;
  },

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
    } catch (error) {
      console.warn('退出时更新角色卡失败:', error);
    } finally {
      _exitGiveResultInFlight = false;
    }
  },
});

// ==================== 工具函数 ====================

function generateRequestId(): string {
  // 使用更高精度的随机数，避免并发时ID冲突
  const time = Date.now();
  const random = Math.random().toString(36).slice(2, 11);
  const random2 = Math.random().toString(36).slice(2, 5);
  return `${time}_${random}_${random2}`;
}

function getNextSequence(): number {
  return ++_messageSequence;
}

function hasRecentPendingMessage(messages: IMessage[]): boolean {
  const now = Date.now();
  return messages.some((m) => {
    if (!m.pending) return false;
    const ts = Number(m.timestamp || 0);
    return ts > 0 && now - ts < 30000;
  });
}

function hasAnyPendingMessage(messages: IMessage[]): boolean {
  return messages.some((m) => !!m.pending);
}

function sameMessageSnapshot(a: IMessage[], b: IMessage[]): boolean {
  if (a.length !== b.length) return false;

  // 创建ID到消息的映射，避免依赖数组顺序
  const bMap = new Map<string, IMessage>();
  for (const msg of b) {
    if (msg?.id) bMap.set(msg.id, msg);
  }

  for (const msgA of a) {
    if (!msgA?.id) continue;
    const msgB = bMap.get(msgA.id);
    if (!msgB) return false; // b中缺少这条消息

    // 比较关键字段
    if (msgA.pending !== msgB.pending) return false;
    if ((msgA.content || '') !== (msgB.content || '')) return false;
    if ((msgA.role || '') !== (msgB.role || '')) return false;

    // 比较图片
    const aImages = (msgA.images || []).join(',');
    const bImages = (msgB.images || []).join(',');
    if (aImages !== bImages) return false;
  }

  return true;
}

function finalizeStalePendingMessages(messages: IMessage[], timeoutMs = 120000): IMessage[] {
  const now = Date.now();
  return messages.map((m) => {
    if (!m.pending) return m;
    const ts = Number(m.timestamp || 0);
    if (!ts || now - ts < timeoutMs) return m;
    return { ...m, pending: false, content: DIFY_ERROR_TEXT, transient: true };
  });
}

function ensureWelcomeMessage(messages: IMessage[]): IMessage[] {
  if (messages.some((m) => m.id === 'welcome')) return messages;
  return [
    {
      id: 'welcome',
      role: 'ai',
      content: WELCOME_CONTENT,
      timestamp: Date.now(),
      userId: 'ai',
    },
    ...messages,
  ];
}

function mergeMessages(cloudMessages: IMessage[], localMessages: IMessage[]): IMessage[] {
  // 使用智能合并策略
  return smartMergeMessages(localMessages, cloudMessages);
}

/**
 * 智能合并本地和云端消息
 * 策略：
 * 1. 以云端消息为基础（云端是持久化数据源）
 * 2. 对于相同ID的消息，保留内容更完整的版本（content长度更长）
 * 3. 本地独有的消息（如pending消息）保留
 * 4. 打字机效果进行中的消息优先使用本地版本
 */
function smartMergeMessages(localMessages: IMessage[], cloudMessages: IMessage[]): IMessage[] {
  const result = new Map<string, IMessage>();
  const now = Date.now();

  // 先添加所有云端消息
  for (const msg of cloudMessages) {
    if (msg?.id) {
      result.set(msg.id, msg);
    }
  }

  // 合并本地消息
  for (const localMsg of localMessages) {
    if (!localMsg?.id) continue;

    const existing = result.get(localMsg.id);

    if (!existing) {
      // 本地独有的消息，直接添加
      result.set(localMsg.id, localMsg);
    } else {
      // 相同ID的消息，选择更完整的版本
      const localContent = localMsg.content || '';
      const cloudContent = existing.content || '';
      const localHasImages = Array.isArray(localMsg.images) && localMsg.images.length > 0;
      const cloudHasImages = Array.isArray(existing.images) && existing.images.length > 0;

      // 判断哪个版本更完整
      const shouldUseLocal =
        // 本地内容更长
        localContent.length > cloudContent.length ||
        // 本地有图片而云端没有
        (localHasImages && !cloudHasImages) ||
        // 本地是pending状态且未超时（还在等待中）
        (localMsg.pending && localMsg.timestamp && now - localMsg.timestamp < 120000) ||
        // 正在打字机效果中的消息
        (localMsg.id === _typewriterMsgId && _isTypewriting);

      if (shouldUseLocal) {
        result.set(localMsg.id, localMsg);
      }
    }
  }

  // 按sequence排序，如果没有sequence则按timestamp排序
  return Array.from(result.values()).sort((a, b) => {
    // 优先使用sequence排序
    const seqA = a.sequence || 0;
    const seqB = b.sequence || 0;
    if (seqA !== seqB) return seqA - seqB;

    // sequence相同时，按timestamp排序
    const timeDiff = (a.timestamp || 0) - (b.timestamp || 0);
    if (timeDiff !== 0) return timeDiff;

    // 最后按id排序确保稳定
    return (a.id || '').localeCompare(b.id || '');
  });
}
