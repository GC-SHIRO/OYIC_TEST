/**
 * 角色卡统一类型定义
 * 基于 docs/character_card_design.md 的数据结构参考
 * 所有角色卡相关的类型定义统一从此文件导出
 */

// ========== 角色信息子结构 ==========

/** 外观自定义属性条目 */
export interface IAppearanceAttr {
  label: string;           // 属性名（如「发型」）
  value: string;           // 属性值
  locked: boolean;         // 锁定时标签不可编辑、不可删除
}

/** 外观描述 */
export interface IAppearance {
  hairColor: string;       // 发色
  eyeColor: string;        // 瞳色
  detail: string;          // 详细描述（长文本段）
  customAttrs?: IAppearanceAttr[]; // 用户自定义外观属性
}

/** 特殊能力 */
export interface IAbility {
  name: string;            // 能力名称
  description: string;     // 能力描述
}

/** 关系网条目 */
export interface IRelationship {
  character: string;       // 关联角色名称
  relation: string;        // 关系描述
}

/** 性格六维图（数值 0~1） */
export interface IPersonalityRadar {
  extroversion: number;    // 外向度
  rationality: number;     // 理智度
  kindness: number;        // 善良度
  courage: number;         // 胆识度
  openness: number;        // 开放度
  responsibility: number;  // 责任感
}

// ========== 角色完整信息（角色具体信息） ==========

/** 角色具体信息，对应设计文档中的角色卡数据结构参考 */
export interface ICharacterInfo {
  name: string;                            // 角色姓名
  gender: string;                          // 性别
  birthday?: string;                       // 生日
  constellation?: string;                  // 星座
  species: string;                         // 物种
  introduction: string;                    // 角色简介
  personalityTags: string[];               // 性格标签（多个词组成）
  appearance: IAppearance;                 // 外观描述
  personality: string;                     // 性格描述（长文本段）
  backstory: string;                       // 角色背景（长文本段）
  storyline?: string;                      // 故事线（可选，长文本段）
  abilities?: IAbility[];                  // 特殊能力（可选）
  relationships?: IRelationship[];         // 关系网（可选）
  radar: IPersonalityRadar;                // 性格六维图
}

// ========== 角色卡存储结构（数据库一级结构） ==========

/**
 * 角色卡完整存储结构
 * 包含元数据 + 角色具体信息，用于本地存储和后端数据库同步
 *
 * 对应设计文档 "数据库需要存储的内容":
 *   1. 卡片 id
 *   2. 卡片创建时间
 *   3. 卡片创建用户 id
 *   4. 卡片创建状态
 *   5. Dify 端的会话 id
 *   6. 角色具体信息
 */
export interface ICharacterCard {
  id: string;                                    // 卡片 ID
  createdAt: number;                             // 卡片创建时间
  updatedAt: number;                             // 卡片更新时间
  creatorId?: string;                            // 卡片创建用户 ID
  status: 'completed' | 'incomplete';            // 卡片创建状态
  conversationId?: string;                       // Dify 端的会话 ID
  avatar?: string;                               // 角色头像（可选）
  gallery?: string[];                            // 角色画廊（云文件 fileID 列表）
  characterInfo: ICharacterInfo;                 // 角色具体信息
}

// ========== 列表展示用的精简结构 ==========

/** 首页/作品列表展示用的精简角色卡信息 */
export interface ICharacterListItem {
  id: string;
  name: string;
  introduction: string;
  avatar?: string;
  status: 'completed' | 'incomplete';
  createdAt?: number;
}

// ========== 工具函数：从 ICharacterCard 提取列表项 ==========

/** 从完整角色卡提取列表展示信息 */
export function toListItem(card: ICharacterCard): ICharacterListItem {
  return {
    id: card.id,
    name: card.characterInfo.name,
    introduction: card.characterInfo.introduction,
    avatar: card.avatar,
    status: card.status,
    createdAt: card.createdAt,
  };
}

/** 创建空白的角色卡信息 */
export function createEmptyCharacterInfo(): ICharacterInfo {
  return {
    name: '',
    gender: '',
    species: '',
    introduction: '',
    personalityTags: [],
    appearance: { hairColor: '', eyeColor: '', detail: '' },
    personality: '',
    backstory: '',
    radar: {
      extroversion: 0.5,
      rationality: 0.5,
      kindness: 0.5,
      courage: 0.5,
      openness: 0.5,
      responsibility: 0.5,
    },
  };
}
