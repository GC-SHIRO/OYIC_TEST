/**
 * Agent API 服务
 * 通过 difyChat 云函数间接调用 Dify 对话 API
 * API 密钥安全存放在云端，前端不暴露任何密钥
 */

import type { ICharacterInfo } from '../types/character';

// ========== 类型定义 ==========

/** 调用 Dify 的统一返回类型 */
export interface IAgentResponse {
  success: boolean;
  message: string;
  conversationId?: string;
  data?: any;
  error?: string;
}

/** 角色卡生成结果 */
export interface IGenerateResponse {
  success: boolean;
  data?: ICharacterInfo;
  conversationId?: string;
  error?: string;
}

// ========== 核心 API ==========

/**
 * 发送对话消息到 Dify（通过云函数代理）
 * @param query 用户输入的文本
 * @param conversationId Dify 会话 ID（首次留空，后续传入以维持上下文）
 * @returns 包含 AI 回复和 conversationId
 */
export async function chatWithDify(
  query: string,
  conversationId?: string,
  cardId?: string,
  requestId?: string,
  images?: string[], // 新增参数，图片 fileID 列表
): Promise<IAgentResponse> {
  const startTime = Date.now();
  try {
    console.log('[Dify Request] 上下文长度:', query.length, '字符');
    const res = await (wx.cloud.callFunction as any)({
      name: 'difyChat',
      data: {
        action: 'chat',
        query,
        conversationId: conversationId || '',
        cardId: cardId || '',
        requestId: requestId || '',
        files: images && images.length > 0 ? images : undefined,
      },
      timeout: 60000,
    });
    const duration = Date.now() - startTime;
    const result = res.result as any;
    if (result.code === 0 && result.data) {
      console.log('[Chat Stats] tokens:', result.data.tokens, '| 创作点:', result.data.cost, '| 时长:', duration + 'ms');
    }

    if (result.code === 1) {
      return { success: false, message: result.message || '请求处理中，请勿重复提交' };
    }
    if (result.code !== 0) {
      return { success: false, message: result.message || '调用失败', error: result.error };
    }

    const data = result.data;
    return {
      success: true,
      message: data.answer || '',
      conversationId: data.conversationId || '',
      data,
    };
  } catch (error: any) {
    console.error('chatWithDify 异常:', error);
    return {
      success: false,
      message: '网络异常，请稍后重试',
      error: error.message,
    };
  }
}

/**
 * 发送 "Give_Result" 到 Dify，获取标准角色卡 JSON
 * @param conversationId Dify 会话 ID（必须已有对话上下文）
 * @returns 解析后的 ICharacterInfo
 */
export async function generateCharacterCard(
  conversationId: string,
  cardId?: string
): Promise<IGenerateResponse> {
  try {
    const response = await chatWithDify(
      'Give_Result',
      conversationId,
      cardId,
      `give_result_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    );

    if (!response.success) {
      return { success: false, error: response.error || '生成失败' };
    }

    const rawAnswer = response.message || '';
    console.log('原始 Dify 回复:', rawAnswer);
    // 尝试从回复中提取 JSON（Dify 可能在 JSON 外包裹 markdown 代码块）
    const characterInfo = parseCharacterJSON(rawAnswer);
    console.log('解析后的角色信息:', characterInfo);
    if (characterInfo) {
      return {
        success: true,
        data: characterInfo,
        conversationId: response.conversationId,
      };
    } 
    else {
      return {
        success: false,
        error: '无法解析角色卡数据，请重试',
      };
    }
  } catch (error: any) {
    console.error('生成角色卡失败:', error);
    return {
      success: false,
      error: error.message,
    };
  }
}

// ========== 工具函数 ==========

/**
 * 从 Dify 回复文本中解析角色卡 JSON
 */
function parseCharacterJSON(text: string): ICharacterInfo | null {
  if (!text) {
    console.error('解析失败: 文本为空');
    return null;
  }

  console.log('开始解析，原始文本长度:', text.length);
  
  // 1. 提取内容
  const codeBlockMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  let jsonStr = codeBlockMatch ? codeBlockMatch[1].trim() : text.trim();

  if (!codeBlockMatch) {
    const firstBrace = jsonStr.indexOf('{');
    const lastBrace = jsonStr.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace > firstBrace) {
      jsonStr = jsonStr.substring(firstBrace, lastBrace + 1);
    }
  }

  console.log('提取的字符串:', jsonStr.substring(0, 200));

  // 2. Python 转 JSON（改进版）
  jsonStr = convertPythonToJson(jsonStr);
  console.log('转换后:', jsonStr.substring(0, 200));

  // 3. 尝试解析
  try {
    const obj = JSON.parse(jsonStr);
    console.log('解析成功');
    return normalizeCharacterInfo(obj);
  } catch (e: any) {
    console.error('JSON 解析失败:', e.message);
    console.error('问题文本:', jsonStr.substring(0, 500));
    return null;
  }
}

/**
 * 将 Python 字典转换为 JSON（改进版）
 */
function convertPythonToJson(text: string): string {
  // 步骤 1: 替换 Python 关键字
  let result = text
    .replace(/\bNone\b/g, 'null')
    .replace(/\bTrue\b/g, 'true')
    .replace(/\bFalse\b/g, 'false');

  // 步骤 2: 使用正则替换单引号（更精确的模式）
  // 匹配: '字符串内容' 其中内容不包含未转义的单引号
  result = result.replace(
    /'([^'\\]*(?:\\.[^'\\]*)*)'/g, 
    (match, content) => {
      // 将内容中的双引号转义
      const escaped = content.replace(/"/g, '\\"');
      return `"${escaped}"`;
    }
  );

  return result;
}

/**
 * 标准化角色信息字段（兼容 Dify 返回的 snake_case 和 camelCase）
 */
function normalizeCharacterInfo(obj: any): ICharacterInfo {
  return {
    name: obj.name || '',
    gender: obj.gender || '',
    birthday: obj.birthday || '',
    constellation: obj.constellation || '',
    species: obj.species || '',
    introduction: obj.introduction || '',
    personalityTags: obj.personalityTags || obj.personality_tags || [],
    appearance: {
      hairColor: obj.appearance?.hairColor || obj.appearance?.hair_color || '',
      eyeColor: obj.appearance?.eyeColor || obj.appearance?.eye_color || '',
      detail: obj.appearance?.detail || '',
    },
    personality: obj.personality || '',
    backstory: obj.backstory || '',
    storyline: obj.storyline || '',
    abilities: (obj.abilities || []).map((a: any) => ({
      name: a.name || '',
      description: a.description || '',
    })),
    relationships: (obj.relationships || []).map((r: any) => ({
      character: r.character || '',
      relation: r.relation || '',
    })),
    radar: {
      extroversion: Number(obj.radar?.extroversion ?? obj.ridar?.extroversion ?? 0.5),
      rationality: Number(obj.radar?.rationality ?? obj.ridar?.rationality ?? 0.5),
      kindness: Number(obj.radar?.kindness ?? obj.ridar?.kindness ?? 0.5),
      courage: Number(obj.radar?.courage ?? obj.ridar?.courage ?? 0.5),
      openness: Number(obj.radar?.openness ?? obj.ridar?.openness ?? 0.5),
      responsibility: Number(obj.radar?.responsibility ?? obj.ridar?.responsibility ?? 0.5),
    },
  };
}
