/**
 * 存储服务
 * 云端数据库为唯一数据源，本地缓存仅用于加速首屏
 * 每次进入页面都从云端加载最新数据
 *
 * 角色卡数据结构参考 docs/character_card_design.md
 * 类型定义统一从 types/character.ts 导入
 */

import type { ICharacterCard } from '../types/character';

// 对话消息类型
export interface IMessage {
  id: string;
  role: 'ai' | 'user';
  content: string;
  images?: string[];
  timestamp: number;
  animate?: boolean;
  transient?: boolean;
  pending?: boolean;
  pendingText?: string; // AI思考中显示的文本
  requestId?: string;
  userId?: string;
  sequence?: number; // 消息序号，用于确保排序正确
}

// 本地缓存键名前缀
const STORAGE_KEYS = {
  CHARACTER_LIST: 'characterList',
  CHARACTER_PREFIX: 'character_',
  CONVERSATION_PREFIX: 'conversation_',
};

// 占位图路径
export const PLACEHOLDER_IMAGE = '/assets/images/character_placeholder.png';

/**
 * 获取当前登录用户的 openId
 * 未登录时返回空字符串
 */
export function getCurrentUserId(): string {
  const app = getApp<IAppOption>();
  const openId = app?.globalData?.openId || '';
  if (openId) return openId;

  const cached = wx.getStorageSync('cloudUserInfo');
  if (cached?.openId) {
    app.globalData.isLoggedIn = true;
    app.globalData.openId = cached.openId;
    app.globalData.userInfo = cached;
    return cached.openId;
  }

  return '';
}

/**
 * 用户隔离的缓存 key
 */
function userKey(key: string): string {
  const uid = getCurrentUserId();
  if (!uid) return key;
  return `u_${uid}_${key}`;
}

// ================================================================
//  云端优先：从云端加载角色卡
// ================================================================

/**
 * 从云端加载当前用户的所有角色卡（核心方法）
 * 拉取后同时更新本地缓存
 * 返回 ICharacterCard[] 数组
 */
export async function fetchCharactersFromCloud(): Promise<ICharacterCard[]> {
  if (!getCurrentUserId()) return [];

  try {
    const res = await wx.cloud.callFunction({
      name: 'characterCard',
      data: { action: 'list' },
    });

    const result = res.result as any;
    if (result.code !== 0 || !Array.isArray(result.data)) {
      console.warn('云端拉取失败:', result.message);
      // 降级：返回本地缓存
      return getLocalCharacters();
    }

    const cards: ICharacterCard[] = [];
    const idList: string[] = [];

    for (const cloud of result.data) {
      const cardId = cloud.cardId;
      if (!cardId) continue;

      // 跳过无效空卡片（脏数据），顺便清理
      if (!cloud.characterInfo?.name && !cloud.conversationId) {
        wx.cloud.callFunction({
          name: 'characterCard',
          data: { action: 'delete', cardId },
        }).catch(() => {});
        continue;
      }

      const card: ICharacterCard = {
        id: cardId,
        status: cloud.status || 'incomplete',
        conversationId: cloud.conversationId || '',
        avatar: cloud.avatar || '',
        gallery: Array.isArray(cloud.gallery) ? cloud.gallery : [],
        characterInfo: cloud.characterInfo || {},
        createdAt: toTimestamp(cloud.createdAt),
        updatedAt: toTimestamp(cloud.updatedAt),
      };

      cards.push(card);
      idList.push(cardId);

      // 更新本地缓存
      wx.setStorageSync(userKey(`${STORAGE_KEYS.CHARACTER_PREFIX}${cardId}`), card);
    }

    // 更新本地 ID 列表缓存
    wx.setStorageSync(userKey(STORAGE_KEYS.CHARACTER_LIST), idList);

    return cards;
  } catch (err) {
    console.error('云端拉取异常:', err);
    // 网络异常降级到本地缓存
    return getLocalCharacters();
  }
}

/**
 * 从云端加载单个角色卡
 */
export async function fetchCharacterFromCloud(characterId: string): Promise<ICharacterCard | null> {
  if (!getCurrentUserId()) return null;

  try {
    const res = await wx.cloud.callFunction({
      name: 'characterCard',
      data: { action: 'get', cardId: characterId },
    });

    const result = res.result as any;
    if (result.code === 0 && result.data) {
      const cloud = result.data;
      const card: ICharacterCard = {
        id: cloud.cardId || characterId,
        status: cloud.status || 'incomplete',
        conversationId: cloud.conversationId || '',
        avatar: cloud.avatar || '',
        gallery: Array.isArray(cloud.gallery) ? cloud.gallery : [],
        characterInfo: cloud.characterInfo || {},
        createdAt: toTimestamp(cloud.createdAt),
        updatedAt: toTimestamp(cloud.updatedAt),
      };
      // 更新本地缓存
      wx.setStorageSync(userKey(`${STORAGE_KEYS.CHARACTER_PREFIX}${characterId}`), card);
      return card;
    }
  } catch (err) {
    console.warn('云端获取单卡失败:', err);
  }

  // 降级到本地缓存
  return getCharacter(characterId);
}

/**
 * 云端创建空白角色卡，返回并缓存到本地
 */
export async function createCharacterDraftInCloud(): Promise<ICharacterCard | null> {
  if (!getCurrentUserId()) return null;

  try {
    const res = await wx.cloud.callFunction({
      name: 'characterCard',
      data: { action: 'createDraft' },
    });

    const result = res.result as any;
    if (result.code === 0 && result.data) {
      const cloud = result.data;
      const card: ICharacterCard = {
        id: cloud.cardId,
        status: cloud.status || 'incomplete',
        conversationId: cloud.conversationId || '',
        avatar: cloud.avatar || '',
        gallery: Array.isArray(cloud.gallery) ? cloud.gallery : [],
        characterInfo: cloud.characterInfo || {},
        createdAt: toTimestamp(cloud.createdAt),
        updatedAt: toTimestamp(cloud.updatedAt),
        creatorId: getCurrentUserId(),
      };

      // 更新本地缓存
      wx.setStorageSync(userKey(`${STORAGE_KEYS.CHARACTER_PREFIX}${card.id}`), card);
      const list = getCharacterList();
      if (!list.includes(card.id)) {
        list.unshift(card.id);
        wx.setStorageSync(userKey(STORAGE_KEYS.CHARACTER_LIST), list);
      }

      return card;
    }
  } catch (err) {
    console.warn('云端创建角色卡失败:', err);
  }

  return null;
}

// ================================================================
//  本地缓存读取（仅用于离线降级 / 首屏快速渲染）
// ================================================================

/**
 * 从本地缓存获取角色ID列表
 */
export function getCharacterList(): string[] {
  if (!getCurrentUserId()) return [];
  return wx.getStorageSync(userKey(STORAGE_KEYS.CHARACTER_LIST)) || [];
}

/**
 * 从本地缓存获取角色卡详情
 */
export function getCharacter(characterId: string): ICharacterCard | null {
  if (!getCurrentUserId()) return null;
  return wx.getStorageSync(userKey(`${STORAGE_KEYS.CHARACTER_PREFIX}${characterId}`)) || null;
}

/**
 * 从本地缓存获取所有角色卡
 */
function getLocalCharacters(): ICharacterCard[] {
  const list = getCharacterList();
  return list
    .map(id => getCharacter(id))
    .filter((c): c is ICharacterCard => c !== null);
}

/**
 * 从本地缓存获取已完成角色卡（仅用于首屏快速渲染）
 */
export function getCompletedCharacters(): ICharacterCard[] {
  return getLocalCharacters().filter(c => c.status === 'completed');
}

/**
 * 从本地缓存获取未完成角色卡（仅用于首屏快速渲染）
 */
export function getIncompleteCharacters(): ICharacterCard[] {
  return getLocalCharacters().filter(c => c.status === 'incomplete');
}

// ================================================================
//  写入操作（本地 + 云端双写）
// ================================================================

/**
 * 保存角色卡（本地缓存 + 可选云端同步）
 * @param syncCloud 是否同步到云端，默认 true；初始草稿传 false 仅存本地
 */
export function saveCharacter(card: ICharacterCard, syncCloud = true): void {
  if (!getCurrentUserId()) {
    console.warn('未登录，无法保存角色卡');
    return;
  }

  card.updatedAt = Date.now();

  // 写入本地缓存
  wx.setStorageSync(userKey(`${STORAGE_KEYS.CHARACTER_PREFIX}${card.id}`), card);
  const list = getCharacterList();
  if (!list.includes(card.id)) {
    list.unshift(card.id);
    wx.setStorageSync(userKey(STORAGE_KEYS.CHARACTER_LIST), list);
  }

  // 写入云端
  if (syncCloud) {
    syncCardToCloud(card).catch(err => {
      console.warn('云端写入失败，数据已保存在本地:', err);
    });
  }
}

/**
 * 删除角色卡（本地 + 云端）
 */
export function deleteCharacter(characterId: string): void {
  if (!getCurrentUserId()) return;

  // 删除本地
  wx.removeStorageSync(userKey(`${STORAGE_KEYS.CHARACTER_PREFIX}${characterId}`));
  wx.removeStorageSync(userKey(`${STORAGE_KEYS.CONVERSATION_PREFIX}${characterId}`));
  const list = getCharacterList();
  const index = list.indexOf(characterId);
  if (index > -1) {
    list.splice(index, 1);
    wx.setStorageSync(userKey(STORAGE_KEYS.CHARACTER_LIST), list);
  }

  // 删除云端
  wx.cloud.callFunction({
    name: 'characterCard',
    data: { action: 'delete', cardId: characterId },
  }).catch(err => console.warn('云端删除失败:', err));

  // 删除云端对话记录
  removeConversationFromCloud(characterId).catch(err => {
    console.warn('云端对话删除失败:', err);
  });
}

// ================================================================
//  对话历史（云端为主，本地缓存加速）
// ================================================================

export async function fetchConversationFromCloud(characterId: string): Promise<IMessage[]> {
  try {
    const res = await wx.cloud.callFunction({
      name: 'conversation',
      data: { action: 'get', characterId },
    });

    const result = res.result as any;
    if (result.code === 0 && result.data) {
      const cloudMessages = Array.isArray(result.data.messages) ? result.data.messages : [];
      // 更新本地缓存（仅在已知用户时）
      if (getCurrentUserId()) {
        const localMessages = getConversationLocal(characterId);
        const mergedMessages = mergeConversationMessages(cloudMessages, localMessages);
        wx.setStorageSync(userKey(`${STORAGE_KEYS.CONVERSATION_PREFIX}${characterId}`), mergedMessages);
        return mergedMessages;
      }
      return cloudMessages;
    }
  } catch (err) {
    console.warn('云端对话拉取失败，降级本地缓存:', err);
  }

  return getConversationLocal(characterId);
}

export function getConversationLocal(characterId: string): IMessage[] {
  if (!getCurrentUserId()) return [];
  return wx.getStorageSync(userKey(`${STORAGE_KEYS.CONVERSATION_PREFIX}${characterId}`)) || [];
}

export function saveConversation(characterId: string, messages: IMessage[]): void {
  if (!getCurrentUserId()) return;
  // 先写本地缓存，加速首屏
  wx.setStorageSync(userKey(`${STORAGE_KEYS.CONVERSATION_PREFIX}${characterId}`), messages);
  // 不在前端写云端，对话由后端兜底写入
}

// ================================================================
//  内部工具
// ================================================================

/**
 * 推送角色卡到云端（先 update，不存在则 create）
 */
async function syncCardToCloud(card: ICharacterCard): Promise<void> {
  try {
    const updateRes = await wx.cloud.callFunction({
      name: 'characterCard',
      data: {
        action: 'update',
        cardId: card.id,
        data: {
          status: card.status,
          conversationId: card.conversationId || '',
          avatar: card.avatar || '',
          gallery: Array.isArray(card.gallery) ? card.gallery : [],
          characterInfo: card.characterInfo,
        },
      },
    });

    const updateResult = updateRes.result as any;
    if (updateResult.code === 0 && updateResult.data?.updated > 0) {
      return;
    }

    await wx.cloud.callFunction({
      name: 'characterCard',
      data: {
        action: 'create',
        data: {
          id: card.id,
          status: card.status,
          conversationId: card.conversationId || '',
          avatar: card.avatar || '',
          gallery: Array.isArray(card.gallery) ? card.gallery : [],
          characterInfo: card.characterInfo,
        },
      },
    });
  } catch (err) {
    console.error('云端写入角色卡失败:', err);
    throw err;
  }
}

async function removeConversationFromCloud(characterId: string): Promise<void> {
  await wx.cloud.callFunction({
    name: 'conversation',
    data: { action: 'delete', characterId },
  });
}

function toTimestamp(val: any): number {
  if (!val) return 0;
  if (typeof val === 'number') return val;
  if (val instanceof Date) return val.getTime();
  if (typeof val === 'string') return new Date(val).getTime();
  if (val.$date) return val.$date;
  return 0;
}

function mergeConversationMessages(cloudMessages: IMessage[], localMessages: IMessage[]): IMessage[] {
  const merged = new Map<string, IMessage>();

  const upsert = (message: IMessage) => {
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

  cloudMessages.forEach(upsert);
  localMessages.forEach(upsert);

  return Array.from(merged.values())
    .sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
}

// ================================================================
//  工具函数
// ================================================================

export function clearAllData(): void {
  wx.clearStorageSync();
}
