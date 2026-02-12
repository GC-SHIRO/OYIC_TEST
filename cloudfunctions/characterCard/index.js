// 云函数 - 角色卡 CRUD
// 操作 characters 集合，支持创建、更新、查询、删除角色卡
const cloud = require('wx-server-sdk')

cloud.init({
  env: 'cloud1-0g88vkjh890eca50'
})

const db = cloud.database()
const _ = db.command

exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext()
  const openId = wxContext.OPENID
  const { action } = event

  try {
    switch (action) {
      case 'create':
        return await createCard(event, openId)
      case 'createDraft':
        return await createDraftCard(openId)
      case 'update':
        return await updateCard(event, openId)
      case 'get':
        return await getCard(event, openId)
      case 'list':
        return await listCards(event, openId)
      case 'delete':
        return await deleteCard(event, openId)
      default:
        return { code: -1, message: `未知操作: ${action}` }
    }
  } catch (err) {
    console.error(`角色卡操作失败 [${action}]:`, err)
    return {
      code: -1,
      message: '操作失败',
      error: err.message || String(err)
    }
  }
}

/**
 * 创建空白角色卡（云端生成 cardId）
 */
async function createDraftCard(openId) {
  const cardId = generateCardId()
  const now = db.serverDate()
  const record = {
    cardId,
    _openid: openId,
    status: 'incomplete',
    conversationId: '',
    avatar: '',
    characterInfo: buildEmptyCharacterInfo(),
    createdAt: now,
    updatedAt: now,
  }

  const res = await db.collection('characters').add({ data: record })

  return {
    code: 0,
    message: '创建成功',
    data: { _id: res._id, ...record }
  }
}

/**
 * 创建角色卡
 * event.data: { id, status, conversationId, avatar, characterInfo }
 */
async function createCard(event, openId) {
  const { data } = event
  if (!data || !data.id) {
    return { code: -1, message: '缺少角色卡数据' }
  }

  const now = db.serverDate()
  const record = {
    cardId: data.id,                       // 卡片 ID（前端生成）
    _openid: openId,                       // 创建用户 ID
    status: data.status || 'incomplete',   // 创建状态
    conversationId: data.conversationId || '', // Dify 端的会话 ID
    avatar: data.avatar || '',             // 角色头像
    characterInfo: data.characterInfo || {},  // 角色具体信息
    createdAt: now,
    updatedAt: now,
  }

  const res = await db.collection('characters').add({ data: record })

  return {
    code: 0,
    message: '创建成功',
    data: { _id: res._id, cardId: data.id }
  }
}

/**
 * 更新角色卡（仅限本人）
 * event.cardId: 卡片 ID
 * event.data: 需要更新的字段
 */
async function updateCard(event, openId) {
  const { cardId, data } = event
  if (!cardId) {
    return { code: -1, message: '缺少 cardId' }
  }

  const updateData = {}
  if (data.status !== undefined) updateData.status = data.status
  if (data.conversationId !== undefined) updateData.conversationId = data.conversationId
  if (data.avatar !== undefined) updateData.avatar = data.avatar
  if (data.characterInfo !== undefined) updateData.characterInfo = data.characterInfo
  updateData.updatedAt = db.serverDate()

  const res = await db.collection('characters').where({
    cardId: cardId,
    _openid: openId
  }).update({ data: updateData })

  return {
    code: 0,
    message: '更新成功',
    data: { updated: res.stats.updated }
  }
}

/**
 * 获取单个角色卡
 * event.cardId: 卡片 ID
 */
async function getCard(event, openId) {
  const { cardId } = event

  const res = await db.collection('characters').where({
    cardId: cardId,
    _openid: openId
  }).get()

  if (res.data.length === 0) {
    return { code: 1, message: '角色卡不存在', data: null }
  }

  return {
    code: 0,
    message: '查询成功',
    data: res.data[0]
  }
}

/**
 * 列出当前用户的所有角色卡
 * event.status: 可选筛选状态 'completed' | 'incomplete'
 */
async function listCards(event, openId) {
  const query = { _openid: openId }
  if (event.status) {
    query.status = event.status
  }

  const res = await db.collection('characters')
    .where(query)
    .orderBy('createdAt', 'desc')
    .limit(50)
    .get()

  return {
    code: 0,
    message: '查询成功',
    data: res.data
  }
}

/**
 * 删除角色卡（仅限本人）
 * event.cardId: 卡片 ID
 */
async function deleteCard(event, openId) {
  const { cardId } = event

  const res = await db.collection('characters').where({
    cardId: cardId,
    _openid: openId
  }).remove()

  await db.collection('conversations').where({
    _openid: openId,
    characterId: cardId,
  }).remove()

  return {
    code: 0,
    message: '删除成功',
    data: { removed: res.stats.removed }
  }
}

function generateCardId() {
  const rand = Math.random().toString(36).slice(2, 10)
  return `${Date.now()}_${rand}`
}

function buildEmptyCharacterInfo() {
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
  }
}
