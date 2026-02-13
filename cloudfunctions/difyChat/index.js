// 云函数 - Dify 对话代理
// 将 Dify API Key 安全地保存在云端，前端通过此云函数间接调用 Dify API
const cloud = require('wx-server-sdk')
const https = require('https')
const billingConfig = require('./billingConfig')

cloud.init({
  env: 'cloud1-0g88vkjh890eca50'
})

const db = cloud.database()
const _ = db.command

// ===== Dify 配置 =====
// 请在此处填入你的 Dify API Key
const DIFY_API_KEY = 'app-DGu2SMOta7HNZRP9kPjLcXRn'
const DIFY_BASE_URL = 'https://api.dify.ai/v1'
const WELCOME_CONTENT = '你好！我是你的角色创作助手\n\n告诉我你的想法吧！可以是角色的外貌、性格、背景故事，或者任何零散的灵感。\n\n你也可以上传参考图片~'

exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext()
  const openId = wxContext.OPENID

  const { action } = event

  try {
    switch (action) {
      case 'chat':
        return await sendChatMessage(event, openId)
      case 'ping':
        return await testConnectivity()
      default:
        return { code: -1, message: `未知操作: ${action}` }
    }
  } catch (err) {
    console.error('Dify 云函数错误:', err)
    return {
      code: -1,
      message: '调用失败',
      error: err.message || String(err)
    }
  }
}

/**
 * 发送对话消息到 Dify
 * event.query: 用户发送的消息文本
 * event.conversationId: Dify 会话 ID（首次为空，后续传入）
 * event.files: 上传的文件（可选）
 */
async function sendChatMessage(event, openId) {
  const { query, conversationId, files, cardId } = event
  const requestId = normalizeRequestId(event.requestId)

  if (!query) {
    return { code: -1, message: '缺少 query 参数' }
  }

  const user = await getUserByOpenId(openId)
  if (!user) {
    return { code: -1, message: '用户不存在' }
  }

  const isCardGen = isCardGenRequest(query)
  let shouldFinalizeRequest = false
  let finalizeStatus = 'failed'

  if (cardId && requestId) {
    const requestState = await beginConversationRequest(openId, cardId, requestId)
    if (requestState.duplicate) {
      return { code: 1, message: '请求处理中，请勿重复提交' }
    }
    shouldFinalizeRequest = true
  }

  try {
    const requestBody = {
      inputs: {},
      query: query,
      response_mode: 'streaming',
      conversation_id: conversationId || '',
      user: openId,
    }

    if (files && files.length > 0) {
      requestBody.files = files
    }

    // 流式请求：接收 SSE 并拼装完整回复
    const result = await httpPostSSE(
      `${DIFY_BASE_URL}/chat-messages`,
      requestBody,
      {
        'Authorization': `Bearer ${DIFY_API_KEY}`,
        'Content-Type': 'application/json',
      }
    )

    if (result.error) {
      return { code: -1, message: result.error, error: result.error }
    }

    const tokens = result.tokens || 0
    const chatCost = calcChatCost(tokens)
    const cardCost = isCardGen ? billingConfig.CARD_GEN_COST : 0
    const changes = [{
      type: 'chat',
      delta: -chatCost,
      tokens,
      conversationId: result.conversationId || '',
      cardId: cardId || '',
      source: 'dify',
      meta: { messageId: result.messageId || '' },
    }]

    if (cardCost > 0) {
      changes.push({
        type: 'card',
        delta: -cardCost,
        tokens: 0,
        conversationId: result.conversationId || '',
        cardId: cardId || '',
        source: 'dify',
        meta: { messageId: result.messageId || '' },
      })
    }

    const applyResult = await applyBalanceChanges(openId, changes)
    if (!applyResult.ok) {
      return { code: -1, message: applyResult.message || '扣费失败' }
    }

    // 兜底保存对话到云端（用户中途退出也能恢复）
    if (cardId) {
      await upsertConversation(openId, cardId, query, result.answer || '', requestId)
    }

    finalizeStatus = 'done'
    return {
      code: 0,
      message: '成功',
      data: {
        answer: result.answer || '',
        conversationId: result.conversationId || '',
        messageId: result.messageId || '',
        tokens,
        cost: chatCost + cardCost,
      }
    }
  } finally {
    if (shouldFinalizeRequest) {
      await finishConversationRequest(openId, cardId, requestId, finalizeStatus)
    }
  }
}

// ================================
// 对话云端持久化（后端兜底）
// ================================
async function upsertConversation(openId, characterId, userText, aiText, requestId) {
  if (!characterId) return

  const now = Date.now()
  const userMsg = {
    id: requestId ? `user_${requestId}` : `user_${now}`,
    role: 'user',
    content: userText || '',
    timestamp: now,
    userId: openId,
    requestId: requestId || '',
  }

  const aiMsg = {
    id: requestId ? `ai_${requestId}` : `ai_${now + 1}`,
    role: 'ai',
    content: aiText || '',
    timestamp: now + 1,
    userId: 'ai',
    requestId: requestId || '',
  }

  const record = await ensureConversationRecord(openId, characterId)
  if (!record || !record._id) return

  const messages = Array.isArray(record.messages) ? record.messages : []
  if (!messages.some((msg) => msg && msg.id === 'welcome')) {
    await db.collection('conversations').doc(record._id).update({
      data: {
        messages: [buildWelcomeMessage(), ...messages],
        updatedAt: db.serverDate(),
      }
    })
  }

  await db.collection('conversations').doc(record._id).update({
    data: {
      messages: _.push([userMsg, aiMsg]),
      updatedAt: db.serverDate(),
    }
  })
}

async function ensureConversationRecord(openId, characterId) {
  const existing = await db.collection('conversations').where({
    _openid: openId,
    characterId,
  }).get()

  const record = existing.data && existing.data.length > 0 ? existing.data[0] : null
  if (record && record._id) return record

  const legacyRes = await db.collection('conversations')
    .where({ characterId })
    .orderBy('updatedAt', 'desc')
    .limit(1)
    .get()
  const legacy = legacyRes.data && legacyRes.data.length > 0 ? legacyRes.data[0] : null
  if (legacy && legacy._id) {
    await db.collection('conversations').doc(legacy._id).update({
      data: {
        _openid: openId,
        characterId,
        updatedAt: db.serverDate(),
      }
    })
    return {
      ...legacy,
      _openid: openId,
      characterId,
    }
  }

  const addRes = await db.collection('conversations').add({
    data: {
      _openid: openId,
      characterId,
      messages: [buildWelcomeMessage()],
      requestState: {
        processingIds: [],
        completedIds: [],
        failedIds: [],
      },
      createdAt: db.serverDate(),
      updatedAt: db.serverDate(),
    }
  })

  return {
    _id: addRes._id,
    _openid: openId,
    characterId,
    messages: [buildWelcomeMessage()],
    requestState: {
      processingIds: [],
      completedIds: [],
      failedIds: [],
    },
  }
}

async function beginConversationRequest(openId, characterId, requestId) {
  const record = await ensureConversationRecord(openId, characterId)
  if (!record || !record._id) return { duplicate: false }

  return await db.runTransaction(async (transaction) => {
    const res = await transaction.collection('conversations').doc(record._id).get()
    const current = res.data || {}
    const state = current.requestState || {}
    const processingIds = Array.isArray(state.processingIds) ? state.processingIds : []
    const completedIds = Array.isArray(state.completedIds) ? state.completedIds : []
    const failedIds = Array.isArray(state.failedIds) ? state.failedIds : []

    if (processingIds.includes(requestId) || completedIds.includes(requestId)) {
      return { duplicate: true }
    }

    await transaction.collection('conversations').doc(record._id).update({
      data: {
        requestState: {
          processingIds: trimIdList([...processingIds, requestId], 50),
          completedIds: trimIdList(completedIds, 200),
          failedIds: trimIdList(failedIds, 50),
        },
        updatedAt: db.serverDate(),
      }
    })

    return { duplicate: false }
  })
}

async function finishConversationRequest(openId, characterId, requestId, status) {
  if (!openId || !characterId || !requestId) return

  const res = await db.collection('conversations').where({
    _openid: openId,
    characterId,
  }).limit(1).get()
  const record = res.data && res.data.length > 0 ? res.data[0] : null
  if (!record || !record._id) return

  const state = record.requestState || {}
  const processingIds = Array.isArray(state.processingIds) ? state.processingIds : []
  const completedIds = Array.isArray(state.completedIds) ? state.completedIds : []
  const failedIds = Array.isArray(state.failedIds) ? state.failedIds : []

  const nextProcessing = processingIds.filter((id) => id !== requestId)
  const nextCompleted = status === 'done'
    ? trimIdList([...completedIds, requestId], 200)
    : completedIds
  const nextFailed = status === 'done'
    ? failedIds.filter((id) => id !== requestId)
    : trimIdList([...failedIds, requestId], 50)

  await db.collection('conversations').doc(record._id).update({
    data: {
      requestState: {
        processingIds: nextProcessing,
        completedIds: nextCompleted,
        failedIds: nextFailed,
      },
      updatedAt: db.serverDate(),
    }
  })
}

function trimIdList(list, limit) {
  if (!Array.isArray(list)) return []
  return list.slice(Math.max(0, list.length - limit))
}

function normalizeRequestId(raw) {
  if (!raw) return ''
  return String(raw).trim().slice(0, 64)
}

function buildWelcomeMessage() {
  return {
    id: 'welcome',
    role: 'ai',
    content: WELCOME_CONTENT,
    timestamp: Date.now(),
    userId: 'ai',
  }
}

/**
 * 发起 HTTPS POST 请求并解析 SSE 流式响应
 * Dify streaming 返回 text/event-stream，每行格式为:
 *   data: {"event":"message","answer":"...","conversation_id":"..."}
 *   data: {"event":"message_end","conversation_id":"...","metadata":{}}
 */
function httpPostSSE(url, body, headers) {
  return new Promise((resolve) => {
    const urlObj = new URL(url)
    const postData = JSON.stringify(body)

    const options = {
      hostname: urlObj.hostname,
      port: urlObj.port || 443,
      path: urlObj.pathname + urlObj.search,
      method: 'POST',
      headers: {
        ...headers,
        'Content-Length': Buffer.byteLength(postData),
        'Accept': 'text/event-stream',
      },
      timeout: 120000,
    }

    let fullAnswer = ''
    let conversationId = ''
    let messageId = ''
    let tokens = 0
    let buffer = ''

    const req = https.request(options, (res) => {
      // 如果不是 2xx，当作普通响应读取错误
      if (res.statusCode < 200 || res.statusCode >= 300) {
        let errData = ''
        res.on('data', (chunk) => { errData += chunk })
        res.on('end', () => {
          resolve({ error: `HTTP ${res.statusCode}: ${errData.substring(0, 300)}` })
        })
        return
      }

      res.on('data', (chunk) => {
        buffer += chunk.toString()

        // 按行解析 SSE
        const lines = buffer.split('\n')
        // 保留最后一行（可能不完整）
        buffer = lines.pop() || ''

        for (const line of lines) {
          const trimmed = line.trim()
          if (!trimmed || !trimmed.startsWith('data:')) continue

          const jsonStr = trimmed.slice(5).trim()
          if (!jsonStr) continue

          try {
            const evt = JSON.parse(jsonStr)

            if (evt.event === 'message' || evt.event === 'agent_message') {
              // 增量文本片段
              fullAnswer += (evt.answer || '')
              if (evt.conversation_id) conversationId = evt.conversation_id
              if (evt.message_id) messageId = evt.message_id
            } else if (evt.event === 'message_end') {
              if (evt.conversation_id) conversationId = evt.conversation_id
              if (evt.message_id) messageId = evt.message_id
              tokens = pickTokens(evt.metadata)
            } else if (evt.event === 'error') {
              resolve({ error: evt.message || '流式响应错误' })
              req.destroy()
              return
            }
          } catch (e) {
            // 忽略解析失败的行
          }
        }
      })

      res.on('end', () => {
        // 处理 buffer 中残留的最后一行
        if (buffer.trim().startsWith('data:')) {
          try {
            const evt = JSON.parse(buffer.trim().slice(5).trim())
            if (evt.event === 'message' || evt.event === 'agent_message') {
              fullAnswer += (evt.answer || '')
            }
            if (evt.conversation_id) conversationId = evt.conversation_id
          } catch (e) { /* ignore */ }
        }

        resolve({ answer: fullAnswer, conversationId, messageId, tokens })
      })
    })

    req.on('error', (err) => {
      resolve({ error: `请求失败: ${err.message}` })
    })

    req.on('timeout', () => {
      req.destroy()
      resolve({ error: '请求超时' })
    })

    req.write(postData)
    req.end()
  })
}

function calcChatCost(tokens) {
  const unit = billingConfig.TOKEN_UNIT || 1000
  const costPerUnit = billingConfig.TOKEN_COST || 0
  const usedTokens = Math.max(0, Number(tokens) || 0)
  const units = Math.max(1, Math.ceil(usedTokens / unit))
  return units * costPerUnit
}

function isCardGenRequest(query) {
  if (!query) return false
  return query.trim().toLowerCase() === 'give_result'
}

function pickTokens(metadata) {
  if (!metadata || !metadata.usage) return 0
  const usage = metadata.usage
  return usage.total_tokens
    || usage.total_tokens_count
    || usage.total
    || usage.totalTokens
    || 0
}

async function getUserByOpenId(openId) {
  const res = await db.collection('users').where({ _openid: openId }).get()
  return res.data && res.data.length > 0 ? res.data[0] : null
}

async function applyBalanceChanges(openId, changes) {
  if (!changes || changes.length === 0) {
    return { ok: true }
  }

  try {
    const totalDelta = changes.reduce((sum, item) => sum + item.delta, 0)

    const result = await db.runTransaction(async (transaction) => {
      const res = await transaction.collection('users').where({ _openid: openId }).get()
      if (!res.data || res.data.length === 0) {
        throw new Error('用户不存在')
      }

      const user = res.data[0]
      const balanceBefore = user.balance || 0
      const balanceAfter = balanceBefore + totalDelta

      await transaction.collection('users').doc(user._id).update({
        data: {
          balance: balanceAfter,
          updatedAt: db.serverDate(),
        }
      })

      let running = balanceBefore
      for (const change of changes) {
        const before = running
        const after = running + change.delta
        running = after

        await transaction.collection('usage_logs').add({
          data: {
            _openid: openId,
            type: change.type,
            delta: change.delta,
            balanceBefore: before,
            balanceAfter: after,
            tokens: change.tokens || 0,
            conversationId: change.conversationId || '',
            cardId: change.cardId || '',
            source: change.source || 'dify',
            meta: change.meta || {},
            createdAt: db.serverDate(),
          }
        })
      }

      return { balanceBefore, balanceAfter }
    })

    return { ok: true, balanceBefore: result.balanceBefore, balanceAfter: result.balanceAfter }
  } catch (err) {
    return { ok: false, message: err.message || String(err) }
  }
}

/**
 * 测试云函数到 Dify API 的网络连通性
 */
async function testConnectivity() {
  const startTime = Date.now()

  // 1. DNS 解析测试
  const dns = require('dns')
  let dnsOk = false
  let dnsIp = ''
  try {
    const addresses = await new Promise((resolve, reject) => {
      dns.resolve4('api.dify.ai', (err, addrs) => {
        if (err) reject(err)
        else resolve(addrs)
      })
    })
    dnsOk = true
    dnsIp = addresses[0] || ''
  } catch (e) {
    dnsIp = `DNS解析失败: ${e.message}`
  }

  // 2. HTTPS 连接测试（简单 GET 请求）
  let httpsOk = false
  let httpsMsg = ''
  try {
    const result = await new Promise((resolve) => {
      const req = https.get('https://api.dify.ai/v1/parameters?user=test', {
        headers: { 'Authorization': `Bearer ${DIFY_API_KEY}` },
        timeout: 15000,
      }, (res) => {
        let data = ''
        res.on('data', chunk => { data += chunk })
        res.on('end', () => {
          resolve({ status: res.statusCode, body: data.substring(0, 200) })
        })
      })
      req.on('error', (err) => resolve({ status: 0, body: `连接失败: ${err.message}` }))
      req.on('timeout', () => { req.destroy(); resolve({ status: 0, body: '连接超时(15s)' }) })
    })
    httpsOk = result.status >= 200 && result.status < 500
    httpsMsg = `HTTP ${result.status}: ${result.body}`
  } catch (e) {
    httpsMsg = `异常: ${e.message}`
  }

  const elapsed = Date.now() - startTime

  return {
    code: 0,
    message: '连通性测试完成',
    data: {
      dns: { ok: dnsOk, ip: dnsIp },
      https: { ok: httpsOk, detail: httpsMsg },
      elapsed: `${elapsed}ms`,
      conclusion: dnsOk && httpsOk
        ? '✅ 云函数可以访问 Dify API'
        : !dnsOk
          ? '❌ DNS解析失败，api.dify.ai 无法从腾讯云解析（海外域名被墙或DNS异常）'
          : '❌ DNS正常但HTTPS连接失败，可能是网络不通或被防火墙拦截'
    }
  }
}
