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
      // ---- 异步任务模式（解决 60 秒超时问题）----
      case 'startChat':
        return await startChatJob(event, openId)
      case 'runJob':
        return await runChatJobById(event, openId)
      case 'pollChat':
        return await pollChatJobById(event, openId)
      // ---- end ----
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

// ================================
// 工具：自动建集合后写入文档
// 微信云数据库不会自动创建集合，首次使用需 createCollection 或在控制台手动建
// ================================
async function ensureCollectionAndAdd(collectionName, data) {
  try {
    return await db.collection(collectionName).add({ data })
  } catch (e) {
    const msg = e && e.message ? e.message : String(e)
    // 集合不存在时自动创建后重试
    if (msg.includes('collection not exists') || msg.includes('Table not exist') || msg.includes('-502005')) {
      console.warn(`[ensureCollectionAndAdd] 集合 "${collectionName}" 不存在，尝试自动创建...`)
      try {
        await db.createCollection(collectionName)
        console.log(`[ensureCollectionAndAdd] 集合 "${collectionName}" 创建成功，重试写入`)
      } catch (createErr) {
        // 并发场景下可能已被其他实例创建，忽略"已存在"错误
        const createMsg = createErr && createErr.message ? createErr.message : String(createErr)
        if (!createMsg.includes('already exists') && !createMsg.includes('existed')) {
          console.error(`[ensureCollectionAndAdd] 创建集合失败:`, createMsg)
          throw createErr
        }
        console.log(`[ensureCollectionAndAdd] 集合已存在（并发创建），继续重试写入`)
      }
      return await db.collection(collectionName).add({ data })
    }
    throw e
  }
}

// ================================
// 异步任务三件套：startChat / runJob / pollChat
// ================================

/**
 * [startChat] 快速创建异步聊天任务并立刻返回 jobId
 * 耗时 < 1 秒，不阻塞前端
 */
async function startChatJob(event, openId) {
  const { query, conversationId, files, cardId, requestId: rawRequestId } = event
  const requestId = normalizeRequestId(rawRequestId)

  console.log('[startChatJob] 入参:', {
    queryPreview: typeof query === 'string' ? query.slice(0, 100) : typeof query,
    conversationId: conversationId || '',
    cardId: cardId || '',
    requestId,
    filesCount: Array.isArray(files) ? files.length : 0,
  })

  if (!query) {
    console.warn('[startChatJob] 缺少 query 参数，拒绝请求')
    return { code: -1, message: '缺少 query 参数' }
  }

  const user = await getUserByOpenId(openId)
  if (!user) {
    console.warn('[startChatJob] 用户不存在:', openId)
    return { code: -1, message: '用户不存在' }
  }
  console.log('[startChatJob] 用户余额:', user.balance)

  // 去重检查（同 sendChatMessage）
  const isSync = isSyncRequest(query)
  if (!isSync && cardId && requestId) {
    const requestState = await beginConversationRequest(openId, cardId, requestId)
    if (requestState.duplicate) {
      console.warn('[startChatJob] 重复请求，拒绝:', { cardId, requestId })
      return { code: 1, message: '请求处理中，请勿重复提交' }
    }
    console.log('[startChatJob] 去重检查通过')
  }

  // 生成任务 ID
  const jobId = `job_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`

  // 规范 files
  const normalizedFiles = Array.isArray(files)
    ? files.filter((f) => typeof f === 'string').slice(0, 6)
    : []

  await ensureCollectionAndAdd('chatJobs', {
    _openid: openId,
    jobId,
    status: 'pending',
    query,
    conversationId: conversationId || '',
    files: normalizedFiles,
    cardId: cardId || '',
    requestId: requestId || '',
    createdAt: db.serverDate(),
    updatedAt: db.serverDate(),
  })

  console.log('[startChatJob] 任务创建成功:', { jobId, cardId, requestId, isSync })
  return { code: 0, message: 'ok', data: { jobId } }
}

/**
 * [runJob] 执行异步聊天任务（由前端 fire-and-forget 触发）
 * 在独立的云函数实例中运行，享有完整 60 秒，httpPostSSE 超时已设为 55 秒
 */
async function runChatJobById(event, openId) {
  const { jobId } = event
  const t0 = Date.now()
  console.log('[runChatJobById] 开始执行:', { jobId })

  if (!jobId) {
    console.warn('[runChatJobById] 缺少 jobId')
    return { code: -1, message: '缺少 jobId' }
  }

  // 查询任务（限定 _openid 防止越权）
  const res = await db.collection('chatJobs').where({ jobId, _openid: openId }).limit(1).get()
  const job = res.data && res.data.length > 0 ? res.data[0] : null
  if (!job) {
    console.warn('[runChatJobById] 任务不存在:', { jobId })
    return { code: -1, message: '任务不存在' }
  }
  if (job.status !== 'pending') {
    console.log('[runChatJobById] 任务已处理，跳过:', { jobId, status: job.status })
    return { code: 0, message: '任务已处理' }
  }

  console.log('[runChatJobById] 任务信息:', {
    jobId,
    cardId: job.cardId || '',
    requestId: job.requestId || '',
    queryPreview: typeof job.query === 'string' ? job.query.slice(0, 100) : '',
    filesCount: Array.isArray(job.files) ? job.files.length : 0,
    conversationId: job.conversationId || '',
  })

  // 标记为 running
  await db.collection('chatJobs').doc(job._id).update({
    data: { status: 'running', updatedAt: db.serverDate() }
  })
  console.log('[runChatJobById] 已标记 running，准备调用 Dify')

  const { query, conversationId, files: rawFiles, cardId, requestId } = job
  const isCardGen = isCardGenRequest(query)
  const isSync = isSyncRequest(query)
  let finalizeStatus = 'failed'
  const shouldFinalizeRequest = !isSync && cardId && requestId

  try {
    let files = Array.isArray(rawFiles) ? rawFiles.filter((f) => typeof f === 'string').slice(0, 6) : []

    // 构造 Dify 请求体
    const requestBody = {
      inputs: {},
      query,
      response_mode: 'streaming',
      conversation_id: conversationId || '',
      user: openId,
    }

    if (files.length > 0) {
      try {
        if (typeof cloud.getTempFileURL === 'function') {
          const urlRes = await cloud.getTempFileURL({ fileList: files })
          const fileUrls = Array.isArray(urlRes.fileList)
            ? urlRes.fileList.map((f) => f.tempFileURL).filter(Boolean)
            : []
          if (fileUrls.length > 0) {
            const filesObj = fileUrls.map((u) => {
              try {
                const pathname = new URL(u).pathname || ''
                const name = pathname.split('/').pop() || ''
                const ext = (name.split('.').pop() || '').toUpperCase()
                const obj = { type: 'image', transfer_method: 'remote_url', url: u, name }
                if (ext) obj.format = ext
                return obj
              } catch (e) {
                return { type: 'image', transfer_method: 'remote_url', url: u }
              }
            })
            requestBody.files = filesObj
            requestBody.inputs.files = filesObj
            if (typeof requestBody.query === 'string' && !requestBody.query.includes('图片')) {
              requestBody.query = `参考图片\n${requestBody.query}`
            }
          } else {
            requestBody.files = files
          }
        } else {
          requestBody.files = files
        }
      } catch (e) {
        console.warn('runChatJobById: getTempFileURL 失败', e && e.message ? e.message : e)
        requestBody.files = files
      }
    }

    let result
    const difyT0 = Date.now()
    console.log('[runChatJobById] 发起 Dify httpPostSSE 请求...')
    try {
      result = await httpPostSSE(
        `${DIFY_BASE_URL}/chat-messages`,
        requestBody,
        { 'Authorization': `Bearer ${DIFY_API_KEY}`, 'Content-Type': 'application/json' }
      )
    } catch (e) {
      result = { error: e && e.message ? e.message : String(e) }
    }
    const difyElapsed = Date.now() - difyT0
    console.log(`[runChatJobById] Dify 请求完成，耗时 ${difyElapsed}ms`, {
      hasError: !!result.error,
      answerLen: typeof result.answer === 'string' ? result.answer.length : 0,
      tokens: result.tokens || 0,
      conversationId: result.conversationId || '',
      messageId: result.messageId || '',
      error: result.error || '',
    })

    if (result.error) {
      console.error('[runChatJobById] Dify 返回错误:', result.error)
      await db.collection('chatJobs').doc(job._id).update({
        data: { status: 'failed', error: result.error, updatedAt: db.serverDate() }
      })
      return { code: -1, message: result.error }
    }

    const tokens = result.tokens || 0
    const chatCost = calcChatCost(tokens)
    console.log('[runChatJobById] 计费:', { tokens, chatCost })

    // 计费 & 对话持久化（与 sendChatMessage 相同逻辑）
    if (!isSync) {
      if (isCardGen) {
        if (cardId) {
          console.log('[runChatJobById] isCardGen=true，保存待结算费用')
          await savePendingGiveResultCharge(openId, cardId, {
            cost: chatCost,
            tokens,
            conversationId: result.conversationId || '',
            messageId: result.messageId || '',
          })
        }
      } else {
        console.log('[runChatJobById] 普通对话，开始扣费')
        const applyResult = await applyBalanceChanges(openId, [{
          type: 'chat',
          delta: -chatCost,
          tokens,
          conversationId: result.conversationId || '',
          cardId: cardId || '',
          source: CHAT_PROVIDER,
          meta: { messageId: result.messageId || '' },
        }])
        console.log('[runChatJobById] 扣费结果:', applyResult)
        if (!applyResult.ok) {
          console.error('[runChatJobById] 扣费失败:', applyResult.message)
          await db.collection('chatJobs').doc(job._id).update({
            data: { status: 'failed', error: applyResult.message || '扣费失败', updatedAt: db.serverDate() }
          })
          return { code: -1, message: applyResult.message || '扣费失败' }
        }
        if (cardId) {
          console.log('[runChatJobById] 写入对话记录:', { cardId, requestId })
          await upsertConversation(openId, cardId, query, result.answer || '', requestId, files)
        }
      }
    } else {
      console.log('[runChatJobById] isSync=true，跳过计费与对话记录')
    }

    // 写回结果
    await db.collection('chatJobs').doc(job._id).update({
      data: {
        status: 'done',
        answer: result.answer || '',
        conversationId: result.conversationId || '',
        messageId: result.messageId || '',
        tokens,
        cost: isCardGen ? 0 : chatCost,
        updatedAt: db.serverDate(),
      }
    })

    const totalElapsed = Date.now() - t0
    console.log(`[runChatJobById] 任务成功完成，总耗时 ${totalElapsed}ms`, { jobId, tokens, chatCost })
    finalizeStatus = 'done'
    return { code: 0, message: '成功' }
  } catch (err) {
    console.error('[runChatJobById] 未捕获异常:', err && err.stack ? err.stack : err)
    try {
      await db.collection('chatJobs').doc(job._id).update({
        data: { status: 'failed', error: err.message || String(err), updatedAt: db.serverDate() }
      })
    } catch (e) { /* ignore */ }
    return { code: -1, message: err.message || String(err) }
  } finally {
    if (shouldFinalizeRequest) {
      await finishConversationRequest(openId, cardId, requestId, finalizeStatus)
    }
  }
}

/**
 * [pollChat] 前端轮询查询任务进度
 * 若任务 pending/running 超过 90 秒，自动标记为 failed（防止悬空）
 */
async function pollChatJobById(event, openId) {
  const { jobId } = event
  if (!jobId) {
    console.warn('[pollChatJobById] 缺少 jobId')
    return { code: -1, message: '缺少 jobId' }
  }

  const res = await db.collection('chatJobs').where({ jobId, _openid: openId }).limit(1).get()
  const job = res.data && res.data.length > 0 ? res.data[0] : null
  if (!job) {
    console.warn('[pollChatJobById] 任务不存在:', { jobId })
    return { code: -1, message: '任务不存在' }
  }

  // 超时保护：pending/running 超 90 秒则自动失败
  if (job.status === 'pending' || job.status === 'running') {
    const createdMs = job.createdAt ? new Date(job.createdAt).getTime() : 0
    const ageMs = createdMs ? Date.now() - createdMs : 0
    console.log(`[pollChatJobById] 任务仍在进行中: status=${job.status}, 已等待 ${ageMs}ms`, { jobId })
    if (createdMs && ageMs > 90000) {
      console.error('[pollChatJobById] 任务超时（> 90s），强制标记 failed:', { jobId, ageMs })
      try {
        await db.collection('chatJobs').doc(job._id).update({
          data: { status: 'failed', error: 'AI响应超时，请重试', updatedAt: db.serverDate() }
        })
      } catch (e) { /* ignore */ }
      return {
        code: 0,
        data: { status: 'failed', error: 'AI响应超时，请重试' }
      }
    }
  } else {
    console.log(`[pollChatJobById] 返回终态: status=${job.status}`, {
      jobId,
      answerLen: typeof job.answer === 'string' ? job.answer.length : 0,
      tokens: job.tokens || 0,
      error: job.error || '',
    })
  }

  return {
    code: 0,
    data: {
      status: job.status,
      answer: job.answer || '',
      conversationId: job.conversationId || '',
      messageId: job.messageId || '',
      tokens: job.tokens || 0,
      cost: job.cost || 0,
      error: job.error || '',
    }
  }
}

async function savePendingGiveResultCharge(openId, characterId, charge) {
  if (!openId || !characterId) return

  const record = await ensureConversationRecord(openId, characterId)
  if (!record || !record._id) return

  const state = record.requestState || {}
  await db.collection('conversations').doc(record._id).update({
    data: {
      requestState: {
        ...state,
        pendingGiveResultCharge: {
          cost: Math.max(0, Number(charge.cost) || 0),
          tokens: Math.max(0, Number(charge.tokens) || 0),
          conversationId: charge.conversationId || '',
          messageId: charge.messageId || '',
          updatedAt: db.serverDate(),
        },
      },
      updatedAt: db.serverDate(),
    }
  })
}

async function settleGiveResultCharge(event, openId) {
  const { cardId } = event || {}
  if (!cardId) {
    return { code: -1, message: '缺少 cardId 参数' }
  }

  const res = await db.collection('conversations').where({
    _openid: openId,
    characterId: cardId,
  }).limit(1).get()

  const record = res.data && res.data.length > 0 ? res.data[0] : null
  const state = record?.requestState || {}
  const pending = state.pendingGiveResultCharge || {}
  const cost = Math.max(0, Number(pending.cost) || 0)

  if (cost <= 0) {
    return {
      code: 0,
      message: '无需结算',
      data: { charged: 0 }
    }
  }

  const applyResult = await applyBalanceChanges(openId, [{
    type: 'chat',
    delta: -cost,
    tokens: Math.max(0, Number(pending.tokens) || 0),
    conversationId: pending.conversationId || '',
    cardId,
    source: CHAT_PROVIDER,
    meta: {
      messageId: pending.messageId || '',
      settleBy: 'preview_onComplete',
      deferredFrom: 'give_result',
    },
  }])

  if (!applyResult.ok) {
    return { code: -1, message: applyResult.message || '结算失败' }
  }

  if (record && record._id) {
    await db.collection('conversations').doc(record._id).update({
      data: {
        requestState: {
          ...state,
          pendingGiveResultCharge: {
            cost: 0,
            tokens: 0,
            conversationId: '',
            messageId: '',
            updatedAt: db.serverDate(),
          },
        },
        updatedAt: db.serverDate(),
      }
    })
  }

  return {
    code: 0,
    message: '结算成功',
    data: { charged: cost }
  }
}

// ================================
// 对话云端持久化（后端兜底）
// ================================
async function upsertConversation(openId, characterId, userText, aiText, requestId, files) {
  if (!characterId) return

  const now = Date.now()
  const userMsgId = requestId ? `user_${requestId}` : `user_${now}`
  const aiMsgId = requestId ? `ai_${requestId}` : `ai_${now + 1}`

  const record = await ensureConversationRecord(openId, characterId)
  if (!record || !record._id) return

  const messages = Array.isArray(record.messages) ? record.messages : []

  // 检查是否已存在相同 requestId 的消息，避免重复写入
  const hasExistingUserMsg = messages.some((msg) => msg && msg.id === userMsgId)
  const hasExistingAiMsg = messages.some((msg) => msg && msg.id === aiMsgId)
  if (hasExistingUserMsg || hasExistingAiMsg) {
    console.log('[upsertConversation] Skipping duplicate messages', { requestId, hasExistingUserMsg, hasExistingAiMsg })
    return
  }

  // 计算sequence，确保消息顺序正确
  const maxSequence = messages.reduce((max, msg) => Math.max(max, msg.sequence || 0), 0)
  const userSequence = maxSequence + 1
  const aiSequence = maxSequence + 2

  const userMsg = {
    id: userMsgId,
    role: 'user',
    content: userText || '',
    timestamp: now,
    userId: openId,
    requestId: requestId || '',
    sequence: userSequence,
  }

  const aiMsg = {
    id: aiMsgId,
    role: 'ai',
    content: aiText || '',
    timestamp: now + 1,
    userId: 'ai',
    requestId: requestId || '',
    sequence: aiSequence,
  }

  // 如果前端传入 files（可能为 cloud fileID 列表或包含 url 的对象），把它们保存到 user 消息中
  try {
    if (Array.isArray(files) && files.length > 0) {
      userMsg.images = files.map((f) => {
        if (!f) return f
        if (typeof f === 'string') return f
        if (typeof f === 'object') {
          // 优先保留云端 fileID 字段（upload_file_id）或 url
          return f.upload_file_id || f.fileID || f.fileId || f.url || f.name || JSON.stringify(f)
        }
        return f
      })
    }
  } catch (e) {
    // ignore
  }

  if (!messages.some((msg) => msg && msg.id === 'welcome')) {
    await db.collection('conversations').doc(record._id).update({
      data: {
        messages: [buildWelcomeMessage(), ...messages],
        updatedAt: db.serverDate(),
      }
    })
  }

  try {
    console.log('upsertConversation -> pushing messages', { userMsgPreview: { id: userMsg.id, content: (userMsg.content||'').slice(0,200), imagesCount: Array.isArray(userMsg.images)?userMsg.images.length:0 }, aiMsgPreview: { id: aiMsg.id, content: (aiMsg.content||'').slice(0,200) } })
  } catch (e) { /* ignore */ }

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
      timeout: 55000,  // 留出 ~5 秒的云函数收尾时间，避免被 runtime 直接杀死
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
