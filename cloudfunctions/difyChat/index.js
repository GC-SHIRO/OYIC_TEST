// 云函数 - Dify 对话代理
// 将 Dify API Key 安全地保存在云端，前端通过此云函数间接调用
let moduleInitError = null
let cloud
let https
let billingConfig
let db
let _

try {
  cloud = require('wx-server-sdk')
  https = require('https')
  billingConfig = require('./billingConfig')

  // 全局异常捕获，记录未捕获错误以便排查 functions execute fail
  process.on('uncaughtException', (err) => {
    console.error('UNCAUGHT_EXCEPTION:', err && err.stack ? err.stack : err)
  })
  process.on('unhandledRejection', (reason) => {
    console.error('UNHANDLED_REJECTION:', reason)
  })

  cloud.init({
    env: 'cloud1-0g88vkjh890eca50'
  })

  db = cloud.database()
  _ = db.command
} catch (e) {
  moduleInitError = e && e.stack ? e.stack : String(e)
  console.error('MODULE_INIT_ERROR:', moduleInitError)
}

// ===== 配置 =====
// Dify 配置
const DIFY_API_KEY = 'app-AgVIxZ1CKsps5s5JaiJWs14x'
const DIFY_BASE_URL = 'https://api.dify.ai/v1'
const CHAT_PROVIDER = 'dify'

const WELCOME_CONTENT = '你好！我是你的角色创作助手\n\n告诉我你的想法吧！可以是角色的外貌、性格、背景故事，或者任何零散的灵感。\n\n你也可以上传参考图片~'

exports.main = async (event, context) => {
  if (moduleInitError) {
    console.error('[main] 模块初始化失败，直接返回错误:', moduleInitError)
    return { code: -1, message: 'module_init_error', error: moduleInitError }
  }
  const wxContext = cloud.getWXContext()
  const openId = wxContext.OPENID

  const { action } = event
  const oid = openId ? openId.slice(-6) : 'unknown'
  console.log(`[main] action=${action} openId=***${oid}`)

  try {
    switch (action) {
      case 'chat':
        return await sendChatMessage(event, openId)
      case 'settleGiveResultCharge':
        return await settleGiveResultCharge(event, openId)
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
  let { query, conversationId, files, cardId } = event
  const requestId = normalizeRequestId(event.requestId)

  try {
    console.log('sendChatMessage called', {
      queryPreview: typeof query === 'string' ? query.slice(0, 200) : typeof query,
      conversationId: conversationId || '',
      cardId: cardId || '',
      filesLength: Array.isArray(files) ? files.length : 0,
    })
  } catch (e) {
    console.warn('日志打印失败', e && e.message ? e.message : e)
  }

  if (!query) {
    return { code: -1, message: '缺少 query 参数' }
  }

  const user = await getUserByOpenId(openId)
  if (!user) {
    return { code: -1, message: '用户不存在' }
  }

  const isCardGen = isCardGenRequest(query)
  const isSync = isSyncRequest(query)
  let shouldFinalizeRequest = false
  let finalizeStatus = 'failed'

  // Sync 消息不需要去重检查，直接处理
  if (!isSync && cardId && requestId) {
    const requestState = await beginConversationRequest(openId, cardId, requestId)
    if (requestState.duplicate) {
      return { code: 1, message: '请求处理中，请勿重复提交' }
    }
    shouldFinalizeRequest = true
  }

  try {
    // 规范 files：仅保留字符串 fileID，限制数量防止内存/请求异常
    if (Array.isArray(files)) {
      files = files.filter((f) => typeof f === 'string').slice(0, 6)
    } else {
      files = []
    }
    let result

    // Dify API 调用
    const requestBody = {
      inputs: event.inputs || {},
      query: query,
      response_mode: 'streaming',
      conversation_id: conversationId || '',
      user: openId,
    }

    if (files && files.length > 0) {
        // 尝试将小程序云存储 fileID 转换为临时可访问 URL，Dify 需要可被外部访问的文件地址
        try {
          if (typeof cloud.getTempFileURL === 'function') {
            const urlRes = await cloud.getTempFileURL({ fileList: files })
            const fileUrls = Array.isArray(urlRes.fileList)
              ? urlRes.fileList.map((f) => f.tempFileURL).filter(Boolean)
              : []

            console.log('getTempFileURL ->', fileUrls)

            if (fileUrls.length > 0) {
              // 构造更详尽的文件对象，包含类型与名称，提升被 Dify 使用的可能性
              const filesObj = fileUrls.map((u) => {
                try {
                  const pathname = new URL(u).pathname || ''
                  const name = pathname.split('/').pop() || ''
                  const ext = (name.split('.').pop() || '').toUpperCase()
                  // Dify expects: { type, transfer_method, url } for remote_url
                  const obj = {
                    type: 'image',
                    transfer_method: 'remote_url',
                    url: u,
                    name,
                  }
                  if (ext) obj.format = ext
                  return obj
                } catch (e) {
                  return { type: 'image', transfer_method: 'remote_url', url: u }
                }
              })

              requestBody.files = filesObj
              // 兼容：有的 Dify 接口希望 files 放在 inputs 下
              requestBody.inputs = requestBody.inputs || {}
              requestBody.inputs.files = filesObj

              // 在 query 前加提示，明确要求 AI 使用附件图片作为优先信息
              try {
                if (typeof requestBody.query === 'string' && !requestBody.query.includes('图片')) {
                  requestBody.query = `参考图片\n${requestBody.query}`
                }
              } catch (e) { /* ignore */ }

              console.log('Prepared filesObj for Dify ->', filesObj)
            } else {
              // 回退：直接传入原始 fileID 列表（兼容性兜底）
              requestBody.files = files
            }
          } else {
            console.warn('cloud.getTempFileURL 无法使用，直接传入 fileID 列表')
            requestBody.files = files
          }
        } catch (e) {
          console.warn('获取临时文件地址失败，使用原始 files 字段：', e && e.message ? e.message : e)
          requestBody.files = files
        }
      }

      try {
        // 打印简短的 requestBody 预览，避免日志泄露太多敏感信息
        try {
          const preview = {
            query: typeof requestBody.query === 'string' ? requestBody.query.slice(0, 200) : requestBody.query,
            conversation_id: requestBody.conversation_id,
            files_count: Array.isArray(requestBody.files) ? requestBody.files.length : 0,
            inputs_has_files: !!(requestBody.inputs && requestBody.inputs.files),
          }
          console.log('Dify request preview:', preview)
        } catch (e) { /* ignore */ }

        result = await httpPostSSE(
          `${DIFY_BASE_URL}/chat-messages`,
          requestBody,
          {
            'Authorization': `Bearer ${DIFY_API_KEY}`,
            'Content-Type': 'application/json',
          }
        )
      } catch (e) {
        console.error('调用 Dify httpPostSSE 失败:', e && e.message ? e.message : e)
        result = { error: e && e.message ? e.message : String(e) }
      }

    if (result.error) {
      return { code: -1, message: result.error, error: result.error }
    }

    const tokens = result.tokens || 0
    const chatCost = calcChatCost(tokens)

    if (isSync) {
      // Sync 消息：不扣费、不写入对话记录，仅同步角色卡信息到 Dify
      // 不调用 upsertConversation，不调用 applyBalanceChanges
    } else if (isCardGen) {
      if (cardId) {
        await savePendingGiveResultCharge(openId, cardId, {
          cost: chatCost,
          tokens,
          conversationId: result.conversationId || '',
          messageId: result.messageId || '',
        })
      }
      // 关键：Give_Result 不写入对话消息记录
      // return 结构不变，但不调用 upsertConversation
    } else {
      const applyResult = await applyBalanceChanges(openId, [{
        type: 'chat',
        delta: -chatCost,
        tokens,
        conversationId: result.conversationId || '',
        cardId: cardId || '',
        source: CHAT_PROVIDER,
        meta: { messageId: result.messageId || '' },
      }])
      if (!applyResult.ok) {
        return { code: -1, message: applyResult.message || '扣费失败' }
      }
      // 只有普通对话才写入消息记录
      if (cardId) {
        await upsertConversation(openId, cardId, query, result.answer || '', requestId, files)
      }
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
        cost: isCardGen ? 0 : chatCost,
      }
    }
  } finally {
    if (shouldFinalizeRequest) {
      await finishConversationRequest(openId, cardId, requestId, finalizeStatus)
    }
  }
}

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

function isSyncRequest(query) {
  if (!query) return false
  return query.trim() === 'Sync'
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

  // Dify API 测试目标
  const testConfig = { host: 'api.dify.ai', path: '/v1/parameters', token: DIFY_API_KEY }

  // 1. DNS 解析测试
  const dns = require('dns')
  let dnsOk = false
  let dnsIp = ''
  try {
    const addresses = await new Promise((resolve, reject) => {
      dns.resolve4(testConfig.host, (err, addrs) => {
        if (err) reject(err)
        else resolve(addrs)
      })
    })
    dnsOk = true
    dnsIp = addresses[0] || ''
  } catch (e) {
    dnsIp = `DNS解析失败: ${e.message}`
  }

  // 2. HTTPS 连接测试
  let httpsOk = false
  let httpsMsg = ''
  try {
    const result = await new Promise((resolve) => {
      const options = {
        hostname: testConfig.host,
        path: testConfig.path + '?user=test',
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${testConfig.token}`,
          'Content-Type': 'application/json',
        },
        timeout: 15000,
      }
      const req = https.request(options, (res) => {
        let data = ''
        res.on('data', chunk => { data += chunk })
        res.on('end', () => {
          resolve({ status: res.statusCode, body: data.substring(0, 200) })
        })
      })
      req.on('error', (err) => resolve({ status: 0, body: `连接失败: ${err.message}` }))
      req.on('timeout', () => { req.destroy(); resolve({ status: 0, body: '连接超时(15s)' }) })
      // 发送空 body 的 POST 请求
      req.write('{}')
      req.end()
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
      provider: 'Dify',
      dns: { ok: dnsOk, ip: dnsIp },
      https: { ok: httpsOk, detail: httpsMsg },
      elapsed: `${elapsed}ms`,
      conclusion: dnsOk && httpsOk
        ? `✅ 云函数可以访问 Dify API`
        : !dnsOk
          ? `❌ DNS解析失败，${testConfig.host} 无法解析`
          : '❌ DNS正常但HTTPS连接失败，可能是网络不通或被防火墙拦截'
    }
  }
}
