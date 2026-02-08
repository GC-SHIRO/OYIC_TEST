/**
 * 本地存储服务
 * 管理角色卡、对话历史等数据的本地存储
 * 
 * 角色卡数据结构参考 docs/character_card_design.md
 * 类型定义统一从 types/character.ts 导入
 */

import type {
  ICharacterCard,
  ICharacterListItem,
  ICharacterInfo,
} from '../types/character';
import { toListItem } from '../types/character';

// 重新导出类型供其他模块使用
export type { ICharacterCard, ICharacterListItem, ICharacterInfo };

// 对话消息类型
export interface IMessage {
  id: string;
  role: 'ai' | 'user';
  content: string;
  images?: string[];
  timestamp: number;
}

// 存储键名
const STORAGE_KEYS = {
  CHARACTER_LIST: 'characterList',
  CHARACTER_PREFIX: 'character_',
  CONVERSATION_PREFIX: 'conversation_',
  USER_INFO: 'userInfo'
};

// ========== 角色卡 CRUD ==========

/**
 * 获取所有角色ID列表
 */
export function getCharacterList(): string[] {
  return wx.getStorageSync(STORAGE_KEYS.CHARACTER_LIST) || [];
}

/**
 * 获取角色卡详情
 */
export function getCharacter(characterId: string): ICharacterCard | null {
  return wx.getStorageSync(`${STORAGE_KEYS.CHARACTER_PREFIX}${characterId}`) || null;
}

/**
 * 保存角色卡
 */
export function saveCharacter(card: ICharacterCard): void {
  card.updatedAt = Date.now();

  // 保存角色卡信息
  wx.setStorageSync(`${STORAGE_KEYS.CHARACTER_PREFIX}${card.id}`, card);

  // 更新角色列表
  const list = getCharacterList();
  if (!list.includes(card.id)) {
    list.unshift(card.id);
    wx.setStorageSync(STORAGE_KEYS.CHARACTER_LIST, list);
  }
}

/**
 * 删除角色卡
 */
export function deleteCharacter(characterId: string): void {
  // 删除角色卡信息
  wx.removeStorageSync(`${STORAGE_KEYS.CHARACTER_PREFIX}${characterId}`);

  // 删除对话历史
  wx.removeStorageSync(`${STORAGE_KEYS.CONVERSATION_PREFIX}${characterId}`);

  // 更新角色列表
  const list = getCharacterList();
  const index = list.indexOf(characterId);
  if (index > -1) {
    list.splice(index, 1);
    wx.setStorageSync(STORAGE_KEYS.CHARACTER_LIST, list);
  }
}

/**
 * 获取所有已完成的角色卡
 */
export function getCompletedCharacters(): ICharacterCard[] {
  const list = getCharacterList();
  return list
    .map(id => getCharacter(id))
    .filter((c): c is ICharacterCard => c !== null && c.status === 'completed');
}

/**
 * 获取所有未完成的角色卡
 */
export function getIncompleteCharacters(): ICharacterCard[] {
  const list = getCharacterList();
  return list
    .map(id => getCharacter(id))
    .filter((c): c is ICharacterCard => c !== null && c.status === 'incomplete');
}

/**
 * 获取角色卡列表展示数据
 */
export function getCharacterListItems(): ICharacterListItem[] {
  const list = getCharacterList();
  return list
    .map(id => getCharacter(id))
    .filter((c): c is ICharacterCard => c !== null)
    .map(toListItem);
}

// ========== 对话历史 ==========

/**
 * 获取对话历史
 */
export function getConversation(characterId: string): IMessage[] {
  return wx.getStorageSync(`${STORAGE_KEYS.CONVERSATION_PREFIX}${characterId}`) || [];
}

/**
 * 保存对话历史
 */
export function saveConversation(characterId: string, messages: IMessage[]): void {
  wx.setStorageSync(`${STORAGE_KEYS.CONVERSATION_PREFIX}${characterId}`, messages);
}

// ========== 工具函数 ==========

/**
 * 清空所有数据（慎用）
 */
export function clearAllData(): void {
  wx.clearStorageSync();
}

/**
 * 生成唯一ID
 */
export function generateId(): string {
  return `${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}
