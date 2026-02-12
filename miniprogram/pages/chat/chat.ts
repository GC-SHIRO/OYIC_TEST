// 创建角色 - AI对话页面（集成 Dify）
import type { IMessage } from '../../services/storage';
import {
  saveConversation as storageSaveConversation,
  saveCharacter,
  getCharacter,
  fetchConversationFromCloud,
  getConversationLocal,
  getCurrentUserId,
  generateId,
  PLACEHOLDER_IMAGE,
} from '../../services/storage';
import type { ICharacterCard } from '../../types/character';
import { createEmptyCharacterInfo } from '../../types/character';
import type { IAgentResponse } from '../../services/agent';
import { chatWithDify, generateCharacterCard } from '../../services/agent';

// 打字机效果状态（模块级变量）
let _typewriterTimer: any = null;
let _typewriterFullText = '';
let _typewriterMsgIndex = -1;

Page({
  data: {
    characterId: '',
    difyConversationId: '',
    inputValue: '',
    messages: [] as IMessage[],
    isTyping: false,
    isGenerating: false,
    scrollTop: 0,
    keyboardHeight: 0,
  },

  onLoad(options: { characterId?: string }) {
    if (options.characterId) {
      this.setData({ characterId: options.characterId });
      this.loadExistingConversation(options.characterId);
    } else {
      this.showWelcomeMessage();
    }
  },

  // 显示欢迎消息
  showWelcomeMessage() {
    const welcomeMessage: IMessage = {
      id: 'welcome',
      role: 'ai',
      content: '你好！我是你的角色创作助手\n\n告诉我你的想法吧！可以是角色的外貌、性格、背景故事，或者任何零散的灵感。\n\n你也可以上传参考图片~',
      timestamp: Date.now(),
      userId: 'ai',
    };
    this.setData({ messages: [welcomeMessage] });
    this.scrollToBottom();
  },

  // 加载已有对话（恢复 difyConversationId）
  async loadExistingConversation(characterId: string) {
    // 云端优先，失败则回退本地缓存
    const messages = await fetchConversationFromCloud(characterId);
    if (messages && messages.length > 0) {
      this.setData({ messages });
    } else {
      const cached = getConversationLocal(characterId);
      if (cached.length > 0) {
        this.setData({ messages: cached });
      } else {
        this.showWelcomeMessage();
      }
    }

    // 从角色卡恢复 Dify 会话 ID
    const card = getCharacter(characterId);
    if (card && card.conversationId) {
      this.setData({ difyConversationId: card.conversationId });
    }

    this.scrollToBottom();
  },

  // 输入框变化
  onInput(e: WechatMiniprogram.Input) {
    this.setData({ inputValue: e.detail.value });
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
    const { inputValue, messages, difyConversationId, characterId } = this.data;
    if (!inputValue.trim()) return;

    // 负余额提示：允许继续，但先提醒用户
    const canProceed = await this.checkBalanceWarning();
    if (!canProceed) return;

    // 如果打字机正在运行，先完成它
    this.finishTypewriter();

    const userText = inputValue.trim();

    const userMessage: IMessage = {
      id: `user_${Date.now()}`,
      role: 'user',
      content: userText,
      timestamp: Date.now(),
      animate: true,
      userId: getCurrentUserId(),
    };

    const newMessages = [...messages, userMessage];
    this.setData({
      messages: newMessages,
      inputValue: '',
      isTyping: true,
    });
    this.scrollToBottom();

    // 首次发送时，创建未完成角色卡（需要登录）
    let activeCardId = characterId;
    if (!activeCardId) {
      const app = getApp<IAppOption>();
      if (!app.globalData.openId) {
        this.setData({ isTyping: false });
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

      const newId = generateId();
      const now = Date.now();
      const card: ICharacterCard = {
        id: newId,
        createdAt: now,
        updatedAt: now,
        creatorId: app.globalData.openId,
        status: 'incomplete',
        conversationId: '',
        avatar: '',
        characterInfo: createEmptyCharacterInfo(),
      };
      saveCharacter(card, false); // 初始草稿只存本地，不推云端
      activeCardId = newId;
      this.setData({ characterId: newId });
    }

    // 调用 Dify API
    const response = await chatWithDify(userText, difyConversationId, activeCardId).catch((err: any) => {
      console.error('chatWithDify 异常:', err);
      return { success: false, message: '', error: err?.message || String(err) } as IAgentResponse;
    });

    if (response.success && response.message) {
      const newConvId = response.conversationId || difyConversationId;
      if (newConvId && newConvId !== difyConversationId) {
        this.setData({ difyConversationId: newConvId });
        this.updateCardConversationId(newConvId);
      }

      const aiMessage: IMessage = {
        id: `ai_${Date.now()}`,
        role: 'ai',
        content: '',
        timestamp: Date.now(),
        animate: true,
        userId: 'ai',
      };

      const updatedMessages = [...newMessages, aiMessage];
      this.setData({
        messages: updatedMessages,
        isTyping: false,
      });

      // 启动打字机流式显示
      this.streamDisplayMessage(response.message, updatedMessages.length - 1);
    } else {
      const errDetail = response.error || response.message || '未知错误';
      console.error('Dify 调用失败，详细原因:', errDetail);

      const errorMessage: IMessage = {
        id: `ai_${Date.now()}`,
        role: 'ai',
        content: `调用失败: ${errDetail}`,
        timestamp: Date.now(),
        animate: true,
        transient: true,
        userId: 'ai',
      };

      this.setData({
        messages: [...newMessages, errorMessage],
        isTyping: false,
      });
      this.scrollToBottom();
    }
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
  onChooseImage() {
    wx.chooseMedia({
      count: 3,
      mediaType: ['image'],
      sourceType: ['album', 'camera'],
      success: (res) => {
        const images = res.tempFiles.map((file) => file.tempFilePath);

        const userMessage: IMessage = {
          id: `user_${Date.now()}`,
          role: 'user',
          content: '参考图片',
          images,
          timestamp: Date.now(),
          userId: getCurrentUserId(),
        };

        const { messages } = this.data;
        this.setData({
          messages: [...messages, userMessage],
          scrollToMessage: `msg-${userMessage.id}`,
        });

        // TODO: 后续可将图片上传到云存储后发给 Dify
        // 暂时展示图片回复提示
        setTimeout(() => {
          const aiMessage: IMessage = {
            id: `ai_${Date.now()}`,
            role: 'ai',
            content: '收到你的参考图片了！我会根据这些图片帮你构建角色形象。你想要这个角色有什么特别的特征吗？',
            timestamp: Date.now(),
            userId: 'ai',
          };
          this.setData({
            messages: [...this.data.messages, aiMessage],
            scrollToMessage: `msg-${aiMessage.id}`,
          });
        }, 1500);
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
    const { messages, difyConversationId, characterId } = this.data;

    if (messages.length <= 1) {
      wx.showToast({ title: '请先描述你的角色', icon: 'none' });
      return;
    }

    if (!difyConversationId) {
      wx.showToast({ title: '对话未建立，请先发送消息', icon: 'none' });
      return;
    }

    // 负余额提示：允许继续，但先提醒用户
    const canProceed = await this.checkBalanceWarning();
    if (!canProceed) return;

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
        if (missingFields.length > 0) {
          wx.hideLoading();
          this.setData({ isGenerating: false });
          wx.showModal({
            title: '角色信息不完整',
            content: `以下信息缺失：${missingFields.join('、')}\n\n建议继续与 AI 对话补充细节后再生成。`,
            confirmText: '继续生成',
            cancelText: '返回补充',
            success: (modalRes) => {
              if (modalRes.confirm) {
                this.saveAndNavigateToPreview(result.data!, characterId);
              }
            },
          });
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
      saveCharacter(card);
    }

    this.saveConversation();

    wx.navigateTo({
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
    if (!info.appearance || !info.appearance.detail) {
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
    this.finishTypewriter();
    this.saveConversation();
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

  // 打字机流式显示 AI 回复
  streamDisplayMessage(fullText: string, msgIndex: number) {
    this.finishTypewriter();

    _typewriterFullText = fullText;
    _typewriterMsgIndex = msgIndex;

    let charIndex = 0;
    let scrollTick = 0;
    // 根据文本长度调整每次显示字符数和间隔
    const batchSize = fullText.length > 500 ? 8 : 3;
    const interval = 50; // 降低频率，减少 setData 次数

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

  // 检查创作点余额是否为负，负数时弹窗提醒
  async checkBalanceWarning(): Promise<boolean> {
    try {
      const res = await wx.cloud.callFunction({
        name: 'billing',
        data: { action: 'overview' },
      });

      const result = res.result as any;
      if (result.code !== 0 || !result.data) return true;

      const balance = Number(result.data.balance ?? 0);
      if (balance >= 0) return true;

      return await new Promise((resolve) => {
        wx.showModal({
          title: '创作点不足',
          content: '当前创作点已为负数，继续对话或生成会进一步扣费。是否继续？',
          confirmText: '继续',
          cancelText: '去充值',
          success: (modalRes) => {
            if (modalRes.confirm) {
              resolve(true);
            } else {
              wx.navigateTo({ url: '/pages/payment/payment' });
              resolve(false);
            }
          },
        });
      });
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

function looksLikeResultJson(content: string): boolean {
  const normalized = content.replace(/```(?:json)?/g, '').trim();
  if (!normalized.startsWith('{')) return false;
  return /personality_tags|personalityTags/.test(normalized)
    && /appearance/.test(normalized)
    && /backstory/.test(normalized);
}
