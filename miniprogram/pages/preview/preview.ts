// 预览角色卡页面
interface ICharacterDetail {
  id: string;
  name: string;
  subtitle: string;
  age: string;
  gender: string;
  height: string;
  occupation: string;
  appearance: string;
  personality: string;
  backstory: string;
  abilities: string[];
}

interface ITemplate {
  id: string;
  name: string;
}

// 生成请求接口定义
interface IGenerateRequest {
  characterId: string;
  templateId: string;
  conversationHistory: any[];
}

interface IGenerateResponse {
  success: boolean;
  data?: ICharacterDetail;
  error?: string;
}

Page({
  data: {
    characterId: '',
    readonly: false,
    loading: true,
    selectedTemplate: 'standard',
    templates: [
      { id: 'standard', name: '标准模板' },
      { id: 'detailed', name: '详细模板' },
      { id: 'minimal', name: '简约模板' }
    ] as ITemplate[],
    character: {} as ICharacterDetail
  },

  onLoad(options: { characterId?: string; readonly?: string }) {
    const characterId = options.characterId || 'new';
    const readonly = options.readonly === 'true';
    
    this.setData({ characterId, readonly });
    
    if (readonly) {
      // 查看已有角色
      this.loadCharacterDetail(characterId);
    } else {
      // 生成新角色卡
      this.generateCharacterCard(characterId);
    }
  },

  // 加载角色详情
  loadCharacterDetail(characterId: string) {
    // TODO: 从本地存储或服务器加载
    const character = wx.getStorageSync(`character_${characterId}`);
    
    if (character) {
      this.setData({ character, loading: false });
    } else {
      // 如果没有找到，使用示例数据
      this.setData({
        character: this.getMockCharacter(),
        loading: false
      });
    }
  },

  // 生成角色卡
  async generateCharacterCard(characterId: string) {
    this.setData({ loading: true });

    try {
      // 获取对话历史
      const conversation = wx.getStorageSync(`conversation_${characterId}`) || [];
      
      // 调用生成API
      const response = await this.callGenerateAPI({
        characterId,
        templateId: this.data.selectedTemplate,
        conversationHistory: conversation
      });

      if (response.success && response.data) {
        this.setData({
          character: response.data,
          loading: false
        });
      } else {
        throw new Error(response.error || '生成失败');
      }
    } catch (error) {
      console.error('Generate character error:', error);
      
      // 使用模拟数据
      this.setData({
        character: this.getMockCharacter(),
        loading: false
      });
    }
  },

  /**
   * 调用生成API
   * 这是暴露的接口，用于对外确认生成请求
   * @param request 生成请求参数
   */
  async callGenerateAPI(request: IGenerateRequest): Promise<IGenerateResponse> {
    // TODO: 替换为实际的API调用
    // 示例请求格式：
    // const response = await wx.request({
    //   url: 'YOUR_API_ENDPOINT/generate',
    //   method: 'POST',
    //   header: {
    //     'Content-Type': 'application/json',
    //     'Authorization': 'Bearer YOUR_API_KEY'
    //   },
    //   data: request
    // });

    // 模拟API响应
    return new Promise((resolve) => {
      setTimeout(() => {
        resolve({
          success: true,
          data: this.getMockCharacter()
        });
      }, 2000);
    });
  },

  // 获取模拟角色数据
  getMockCharacter(): ICharacterDetail {
    return {
      id: 'mock_1',
      name: '樱花剑姬',
      subtitle: 'Sakura Sword Maiden',
      age: '17岁',
      gender: '女',
      height: '162cm',
      occupation: '剑术师',
      appearance: '粉色长发及腰，浅紫色的温柔眼眸。身穿白色和服，衣袖和裙摆绣有精致的樱花图案。腰间配备樱花形状护手的武士刀，整体气质优雅而坚定。',
      personality: '温柔、善良、内心坚强。平时待人温和有礼，战斗时展现出惊人的意志力。珍惜每一个生命，但在保护重要之人时绝不退缩。',
      backstory: '出生于樱花盛开的古都守护者家族，自幼跟随父亲学习家传剑术。在一次妖魔袭击事件中展现出非凡的天赋，继承了家族的樱花剑，从此踏上守护古都和平的道路。',
      abilities: ['樱花剑术', '灵力感知', '结界术', '瞬步']
    };
  },

  // 选择模板
  onSelectTemplate(e: WechatMiniprogram.TouchEvent) {
    const templateId = e.currentTarget.dataset.id;
    this.setData({ selectedTemplate: templateId });
  },

  // 返回
  onBack() {
    wx.navigateBack();
  },

  // 继续创作
  onContinue() {
    const { characterId } = this.data;
    wx.navigateBack({
      success: () => {
        // 返回聊天页面继续创作
      }
    });
  },

  // 完成创建
  onComplete() {
    const { character, characterId } = this.data;
    
    // 保存角色到本地存储
    wx.setStorageSync(`character_${characterId}`, {
      ...character,
      status: 'completed',
      createdAt: Date.now()
    });

    // 更新角色列表
    this.updateCharacterList(characterId);

    wx.showToast({
      title: '创建成功',
      icon: 'success',
      duration: 1500,
      success: () => {
        setTimeout(() => {
          // 返回首页
          wx.switchTab({
            url: '/pages/home/home'
          });
        }, 1500);
      }
    });
  },

  // 更新角色列表
  updateCharacterList(characterId: string) {
    const characterList = wx.getStorageSync('characterList') || [];
    
    if (!characterList.includes(characterId)) {
      characterList.push(characterId);
      wx.setStorageSync('characterList', characterList);
    }
  }
});
