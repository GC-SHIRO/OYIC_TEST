// 创建角色 - AI对话页面
interface IMessage {
  id: string;
  role: 'ai' | 'user';
  content: string;
  images?: string[];
  timestamp: number;
}

// Agent API 接口定义
interface IAgentResponse {
  success: boolean;
  message: string;
  data?: any;
}

Page({
  data: {
    characterId: '', // 如果是编辑已有角色
    inputValue: '',
    messages: [] as IMessage[],
    isTyping: false,
    scrollToMessage: '',
    // 对话历史，用于发送给Agent
    conversationHistory: [] as { role: string; content: string }[]
  },

  onLoad(options: { characterId?: string }) {
    if (options.characterId) {
      this.setData({ characterId: options.characterId });
      this.loadExistingConversation(options.characterId);
    } else {
      // 新建角色，显示欢迎消息
      this.showWelcomeMessage();
    }
  },

  // 显示欢迎消息
  showWelcomeMessage() {
    const welcomeMessage: IMessage = {
      id: 'welcome',
      role: 'ai',
      content: '你好！我是你的角色创作助手\n\n告诉我你的想法吧！可以是角色的外貌、性格、背景故事，或者任何零散的灵感。\n\n你也可以上传参考图片~',
      timestamp: Date.now()
    };
    
    this.setData({
      messages: [welcomeMessage]
    });
  },

  // 加载已有对话
  loadExistingConversation(characterId: string) {
    // TODO: 从本地存储或服务器加载对话历史
    const conversation = wx.getStorageSync(`conversation_${characterId}`);
    if (conversation && conversation.length > 0) {
      this.setData({ messages: conversation });
    } else {
      this.showWelcomeMessage();
    }
  },

  // 输入框变化
  onInput(e: WechatMiniprogram.Input) {
    this.setData({
      inputValue: e.detail.value
    });
  },

  // 发送消息
  async onSend() {
    const { inputValue, messages, conversationHistory } = this.data;
    
    if (!inputValue.trim()) return;

    // 创建用户消息
    const userMessage: IMessage = {
      id: `user_${Date.now()}`,
      role: 'user',
      content: inputValue.trim(),
      timestamp: Date.now()
    };

    // 更新界面
    const newMessages = [...messages, userMessage];
    this.setData({
      messages: newMessages,
      inputValue: '',
      scrollToMessage: `msg-${userMessage.id}`,
      isTyping: true
    });

    // 更新对话历史
    const newHistory = [...conversationHistory, { role: 'user', content: inputValue.trim() }];
    this.setData({ conversationHistory: newHistory });

    // 调用Agent API
    try {
      const response = await this.callAgentAPI(inputValue.trim(), newHistory);
      
      // 创建AI回复消息
      const aiMessage: IMessage = {
        id: `ai_${Date.now()}`,
        role: 'ai',
        content: response.message || '我理解了你的想法，请继续告诉我更多细节吧~',
        timestamp: Date.now()
      };

      this.setData({
        messages: [...newMessages, aiMessage],
        isTyping: false,
        scrollToMessage: `msg-${aiMessage.id}`,
        conversationHistory: [...newHistory, { role: 'assistant', content: aiMessage.content }]
      });

      // 保存对话到本地
      this.saveConversation();
      
    } catch (error) {
      console.error('Agent API error:', error);
      
      // 显示错误消息
      const errorMessage: IMessage = {
        id: `ai_${Date.now()}`,
        role: 'ai',
        content: '抱歉，我遇到了一些问题，请稍后再试~',
        timestamp: Date.now()
      };

      this.setData({
        messages: [...newMessages, errorMessage],
        isTyping: false
      });
    }
  },

  /**
   * 调用 Agent API
   * 这是暴露的接口，用于接入外部的 Coze API
   * @param userInput 用户输入
   * @param history 对话历史
   */
  async callAgentAPI(userInput: string, history: { role: string; content: string }[]): Promise<IAgentResponse> {
    // TODO: 替换为实际的 Coze API 调用
    // 示例请求格式：
    // const response = await wx.request({
    //   url: 'YOUR_COZE_API_ENDPOINT',
    //   method: 'POST',
    //   header: {
    //     'Content-Type': 'application/json',
    //     'Authorization': 'Bearer YOUR_API_KEY'
    //   },
    //   data: {
    //     conversation_id: this.data.characterId || 'new',
    //     messages: history,
    //     user_input: userInput
    //   }
    // });
    
    // 模拟API响应延迟
    return new Promise((resolve) => {
      setTimeout(() => {
        resolve({
          success: true,
          message: this.generateMockResponse(userInput)
        });
      }, 1000 + Math.random() * 1000);
    });
  },

  // 模拟AI回复（开发阶段使用）
  generateMockResponse(input: string): string {
    const responses = [
      '很棒的想法！这个角色听起来很有意思。能告诉我更多关于TA的性格特点吗？',
      '我已经记录下了这些信息。这个角色有什么特殊的能力或技能吗？',
      '太有创意了！让我们继续完善这个角色的背景故事吧。',
      '非常好！这些细节让角色更加立体了。还有什么想补充的吗？',
      '我理解了，这个角色的设定很完整了。你可以点击右上角的确认按钮来生成角色卡~'
    ];
    
    return responses[Math.floor(Math.random() * responses.length)];
  },

  // 选择图片
  onChooseImage() {
    wx.chooseMedia({
      count: 3,
      mediaType: ['image'],
      sourceType: ['album', 'camera'],
      success: (res) => {
        const images = res.tempFiles.map(file => file.tempFilePath);
        
        // 创建带图片的用户消息
        const userMessage: IMessage = {
          id: `user_${Date.now()}`,
          role: 'user',
          content: '参考图片',
          images: images,
          timestamp: Date.now()
        };

        const { messages } = this.data;
        this.setData({
          messages: [...messages, userMessage],
          scrollToMessage: `msg-${userMessage.id}`
        });

        // 模拟AI回复
        setTimeout(() => {
          const aiMessage: IMessage = {
            id: `ai_${Date.now()}`,
            role: 'ai',
            content: '收到你的参考图片了！我会根据这些图片帮你构建角色形象。你想要这个角色有什么特别的特征吗？',
            timestamp: Date.now()
          };

          this.setData({
            messages: [...this.data.messages, aiMessage],
            scrollToMessage: `msg-${aiMessage.id}`
          });
        }, 1500);
      }
    });
  },

  // 预览图片
  onPreviewImage(e: WechatMiniprogram.TouchEvent) {
    const url = e.currentTarget.dataset.url;
    const allImages = this.data.messages
      .filter(m => m.images && m.images.length > 0)
      .flatMap(m => m.images || []);
    
    wx.previewImage({
      current: url,
      urls: allImages
    });
  },

  // 返回上一页
  onBack() {
    wx.navigateBack();
  },

  // 确认生成
  onConfirm() {
    const { messages, characterId } = this.data;
    
    if (messages.length <= 1) {
      wx.showToast({
        title: '请先描述你的角色',
        icon: 'none'
      });
      return;
    }

    // 保存对话后跳转到预览页
    this.saveConversation();
    
    wx.navigateTo({
      url: `/pages/preview/preview?characterId=${characterId || 'new'}`
    });
  },

  // 保存对话到本地
  saveConversation() {
    const { messages, characterId } = this.data;
    const id = characterId || `new_${Date.now()}`;
    wx.setStorageSync(`conversation_${id}`, messages);
    
    if (!characterId) {
      this.setData({ characterId: id });
    }
  }
});
