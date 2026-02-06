/**
 * 本地存储服务
 * 管理角色、对话历史等数据的本地存储
 */

// 角色信息类型
export interface ICharacter {
  id: string;
  name: string;
  subtitle?: string;
  description: string;
  image: string;
  status: 'completed' | 'incomplete';
  age?: string;
  gender?: string;
  height?: string;
  occupation?: string;
  appearance?: string;
  personality?: string;
  backstory?: string;
  abilities?: string[];
  createdAt: number;
  updatedAt: number;
}

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

/**
 * 获取所有角色ID列表
 */
export function getCharacterList(): string[] {
  return wx.getStorageSync(STORAGE_KEYS.CHARACTER_LIST) || [];
}

/**
 * 获取角色详情
 */
export function getCharacter(characterId: string): ICharacter | null {
  return wx.getStorageSync(`${STORAGE_KEYS.CHARACTER_PREFIX}${characterId}`) || null;
}

/**
 * 保存角色
 */
export function saveCharacter(character: ICharacter): void {
  // 保存角色信息
  wx.setStorageSync(`${STORAGE_KEYS.CHARACTER_PREFIX}${character.id}`, character);
  
  // 更新角色列表
  const list = getCharacterList();
  if (!list.includes(character.id)) {
    list.unshift(character.id);
    wx.setStorageSync(STORAGE_KEYS.CHARACTER_LIST, list);
  }
}

/**
 * 删除角色
 */
export function deleteCharacter(characterId: string): void {
  // 删除角色信息
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
 * 获取所有已完成的角色
 */
export function getCompletedCharacters(): ICharacter[] {
  const list = getCharacterList();
  return list
    .map(id => getCharacter(id))
    .filter((c): c is ICharacter => c !== null && c.status === 'completed');
}

/**
 * 获取所有未完成的角色
 */
export function getIncompleteCharacters(): ICharacter[] {
  const list = getCharacterList();
  return list
    .map(id => getCharacter(id))
    .filter((c): c is ICharacter => c !== null && c.status === 'incomplete');
}

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
