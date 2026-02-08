// 云函数 - Dify 对话代理
// 将 Dify API Key 安全地保存在云端，前端通过此云函数间接调用 Dify API
const cloud = require('wx-server-sdk')
const http = require('http')
const https = require('https')

cloud.init({
  env: 'cloud1-0g88vkjh890eca50'
})

// ===== Dify 配置 =====
// 请在此处填入你的 Dify API Key
const DIFY_API_KEY = 'app-DSWr4bHWVbGUYObbzeHMmtvz'
const DIFY_BASE_URL = 'https://api.dify.ai/v1'

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
  const { query, conversationId, files } = event

  if (!query) {
    return { code: -1, message: '缺少 query 参数' }
  }

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

  return {
    code: 0,
    message: '成功',
    data: {
      answer: result.answer || '',
      conversationId: result.conversationId || '',
      messageId: result.messageId || '',
    }
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

        resolve({ answer: fullAnswer, conversationId, messageId })
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
