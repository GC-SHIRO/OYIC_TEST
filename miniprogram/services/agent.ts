/**
 * Agent API 服务
 * 用于接入外部的 Coze API 或其他 AI Agent 服务
 */

// API 配置
const API_CONFIG = {
  // Coze API 端点，请替换为实际的 API 地址
  baseUrl: 'https://api.coze.cn',
  // API 密钥，请替换为实际的密钥
  apiKey: 'YOUR_COZE_API_KEY',
  // Bot ID
  botId: 'YOUR_BOT_ID'
};

// 对话消息类型
export interface IChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  content_type?: 'text' | 'image_url';
}

// Agent 响应类型
export interface IAgentResponse {
  success: boolean;
  message: string;
  data?: any;
  error?: string;
}

// 角色生成请求
export interface IGenerateRequest {
  characterId: string;
  templateId: string;
  conversationHistory: IChatMessage[];
}

// 角色生成响应
export interface IGenerateResponse {
  success: boolean;
  data?: {
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
  };
  error?: string;
}

/**
 * 调用 Coze Agent API 进行对话
 * @param userInput 用户输入
 * @param history 对话历史
 * @param conversationId 对话ID（可选，用于上下文关联）
 */
export async function chatWithAgent(
  userInput: string,
  history: IChatMessage[],
  conversationId?: string
): Promise<IAgentResponse> {
  try {
    const response = await new Promise<WechatMiniprogram.RequestSuccessCallbackResult>(
      (resolve, reject) => {
        wx.request({
          url: `${API_CONFIG.baseUrl}/v1/chat/completions`,
          method: 'POST',
          header: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${API_CONFIG.apiKey}`
          },
          data: {
            bot_id: API_CONFIG.botId,
            conversation_id: conversationId,
            messages: [
              ...history,
              { role: 'user', content: userInput }
            ],
            stream: false
          },
          success: resolve,
          fail: reject
        });
      }
    );

    if (response.statusCode === 200) {
      const data = response.data as any;
      return {
        success: true,
        message: data.choices?.[0]?.message?.content || '我理解了你的想法~',
        data: data
      };
    } else {
      throw new Error(`API Error: ${response.statusCode}`);
    }
  } catch (error: any) {
    console.error('Agent API Error:', error);
    return {
      success: false,
      message: '抱歉，我遇到了一些问题，请稍后再试~',
      error: error.message
    };
  }
}

/**
 * 调用 API 生成角色卡
 * @param request 生成请求参数
 */
export async function generateCharacterCard(
  request: IGenerateRequest
): Promise<IGenerateResponse> {
  try {
    // 构建生成提示
    const generatePrompt = `请根据以上对话内容，生成一个完整的角色信息卡，使用 ${request.templateId} 模板格式，包含以下字段：
    - 角色名称
    - 英文名/副标题
    - 年龄
    - 性别
    - 身高
    - 职业
    - 外貌特征
    - 性格特点
    - 背景故事
    - 特殊能力（列表形式）
    
    请以 JSON 格式返回。`;

    const response = await new Promise<WechatMiniprogram.RequestSuccessCallbackResult>(
      (resolve, reject) => {
        wx.request({
          url: `${API_CONFIG.baseUrl}/v1/chat/completions`,
          method: 'POST',
          header: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${API_CONFIG.apiKey}`
          },
          data: {
            bot_id: API_CONFIG.botId,
            messages: [
              ...request.conversationHistory,
              { role: 'user', content: generatePrompt }
            ],
            stream: false
          },
          success: resolve,
          fail: reject
        });
      }
    );

    if (response.statusCode === 200) {
      const data = response.data as any;
      const content = data.choices?.[0]?.message?.content;
      
      // 尝试解析 JSON
      try {
        const characterData = JSON.parse(content);
        return {
          success: true,
          data: characterData
        };
      } catch {
        // 如果无法解析，返回默认格式
        return {
          success: true,
          data: {
            name: '新角色',
            subtitle: 'New Character',
            age: '未知',
            gender: '未知',
            height: '未知',
            occupation: '未知',
            appearance: content,
            personality: '',
            backstory: '',
            abilities: []
          }
        };
      }
    } else {
      throw new Error(`API Error: ${response.statusCode}`);
    }
  } catch (error: any) {
    console.error('Generate API Error:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * 更新 API 配置
 * @param config 新的配置
 */
export function updateAPIConfig(config: Partial<typeof API_CONFIG>) {
  Object.assign(API_CONFIG, config);
}

/**
 * 获取当前 API 配置（不含敏感信息）
 */
export function getAPIConfig() {
  return {
    baseUrl: API_CONFIG.baseUrl,
    botId: API_CONFIG.botId,
    hasApiKey: !!API_CONFIG.apiKey && API_CONFIG.apiKey !== 'YOUR_COZE_API_KEY'
  };
}
