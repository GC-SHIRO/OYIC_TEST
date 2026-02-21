/**
 * Agent API 服务
 * 通过 difyChat 云函数间接调用 Dify 对话 API
 * API 密钥安全存放在云端，前端不暴露任何密钥
 */

import { compareVersion } from '../miniprogram_npm/tdesign-miniprogram/common/version';
import type { ICharacterInfo } from '../types/character';

// ========== 类型定义 ==========

/** Dify 对话响应（由云函数返回） */
export interface IDifyChatResult {
  answer: string;
  conversationId: string;
  messageId: string;
}

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
  // ===== 异步任务 + 轮询模式（解决云函数 60 秒超时问题）=====
  // 1. startChat: 快速创建任务（< 1 秒），立即返回 jobId
  // 2. runJob:    fire-and-forget 触发实际 Dify 调用（独享 60 秒）
  // 3. pollChat:  每 2 秒轮询结果，直到完成或超时
  try {
    // Step 1: 创建任务
    const startRes = await (wx.cloud.callFunction as any)({
      name: 'difyChat',
      data: {
        action: 'startChat',
        query,
        conversationId: conversationId || '',
        cardId: cardId || '',
        requestId: requestId || '',
        files: images && images.length > 0 ? images : undefined,
      },
      timeout: 15000,
    });

    const startResult = startRes.result as any;
    if (startResult.code === 1) {
      // 去重：任务已在处理中
      return { success: false, message: startResult.message || '请求处理中，请勿重复提交' };
    }
    if (!startResult.data?.jobId) {
      console.error('startChat 返回无效:', startResult);
      return { success: false, message: startResult.message || '创建任务失败', error: startResult.error };
    }

    const jobId: string = startResult.data.jobId;
    console.log('chatWithDify: job created', jobId);

    // Step 2: fire-and-forget 触发 runJob（不 await，云函数在服务端独立运行）
    (wx.cloud.callFunction as any)({
      name: 'difyChat',
      data: { action: 'runJob', jobId },
      timeout: 65000,
    }).catch((e: any) => {
      console.warn('runJob fire-and-forget error (non-fatal):', e?.message || e);
    });

    // Step 3: 轮询，最多等待 150 秒（75 次 × 2 秒）
    const MAX_POLLS = 75;
    const POLL_INTERVAL_MS = 2000;

    for (let i = 0; i < MAX_POLLS; i++) {
      await new Promise<void>((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));

      let pollResult: any;
      try {
        const pollRes = await (wx.cloud.callFunction as any)({
          name: 'difyChat',
          data: { action: 'pollChat', jobId },
          timeout: 10000,
        });
        pollResult = (pollRes.result as any)?.data;
      } catch (e: any) {
        console.warn('pollChat 请求异常，继续重试:', e?.message || e);
        continue;
      }

      if (!pollResult) continue;

      const status: string = pollResult.status;
      console.log(`chatWithDify poll[${i + 1}/${MAX_POLLS}]: status=${status}`);

      if (status === 'done') {
        return {
          success: true,
          message: pollResult.answer || '',
          conversationId: pollResult.conversationId || '',
          data: pollResult,
        };
      } else if (status === 'failed') {
        return {
          success: false,
          message: pollResult.error || 'AI处理失败，请重试',
          error: pollResult.error,
        };
      }
      // pending / running → 继续等待
    }

    return {
      success: false,
      message: 'AI响应超时，请稍后重试',
      error: 'poll_timeout',
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
 * 安全尝试 JSON.parse
 */
function tryParseJSON(str: string): any | null {
  try {
    return JSON.parse(str);
  } catch {
    return null;
  }
}

/**
 * 将 Python 风格的单引号字典转换为合法 JSON
 * 处理: 'key': 'value' → "key": "value"
 * 同时处理值内部包含的撇号（如 it's）
 */
function fixPythonQuotes(text: string): string {
  let result = '';
  let i = 0;
  let inString = false;
  let stringChar = '';

  while (i < text.length) {
    const ch = text[i];

    if (!inString) {
      if (ch === "'") {
        // 单引号开始字符串，替换为双引号
        result += '"';
        inString = true;
        stringChar = "'";
        i++;
        continue;
      } else if (ch === '"') {
        result += '"';
        inString = true;
        stringChar = '"';
        i++;
        continue;
      }
      result += ch;
      i++;
    } else {
      if (ch === '\\') {
        // 转义字符，保留下一个字符
        result += ch;
        i++;
        if (i < text.length) {
          result += text[i];
          i++;
        }
        continue;
      }

      if (stringChar === "'" && ch === "'") {
        // 检查这个单引号是否是字符串结束符
        // 结束符后面通常跟: , ] } 或空白/换行
        const after = text.substring(i + 1).trimStart();
        const nextChar = after[0];
        if (!nextChar || ':,]}'.indexOf(nextChar) !== -1) {
          // 是结束引号
          result += '"';
          inString = false;
          i++;
          continue;
        } else {
          // 值内部的撇号（如 it's），转义
          result += "\\'";
          i++;
          continue;
        }
      }

      if (stringChar === '"' && ch === '"') {
        result += '"';
        inString = false;
        i++;
        continue;
      }

      // 在单引号字符串内的双引号需要转义
      if (stringChar === "'" && ch === '"') {
        result += '\\"';
        i++;
        continue;
      }

      result += ch;
      i++;
    }
  }

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
