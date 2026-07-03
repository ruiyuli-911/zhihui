const cloud = require('wx-server-sdk')
const https = require('https')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

// DeepSeek API Key — 优先从云开发环境变量读取（安全），其次 fallback
// ⚠️ 部署前请在云开发控制台 → 环境 → 云函数 → ai-chat → 环境变量 中设置：
//    DEEPSEEK_API_KEY=sk-xxx
//    或在 cloudfunctions/ai-chat/ 目录下创建 .env.json 文件
const API_KEY = process.env.DEEPSEEK_API_KEY || 'sk-d931622cf4e34458a175c21021f56e0e'

const API_URL = 'https://api.deepseek.com/chat/completions'

exports.main = async (event) => {
  const { action, data = {} } = event
  if (!action) return { code: -1, msg: 'action is required' }

  try {
    switch (action) {
      case 'chat': return await chat(data)
      case 'getHistory': return await getHistory(data)
      default: return { code: 0, data: { action, ready: false } }
    }
  } catch (err) {
    console.error('[ai-chat]', err)
    return { code: -1, msg: err.message }
  }
}

function s(d = null, m = 'ok') { return { code: 0, msg: m, data: d } }
function f(m = 'fail') { return { code: -1, msg: m } }

/** HTTP POST 请求封装 */
function httpsPost(url, data, headers) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(data)
    const urlObj = new URL(url)
    const opts = {
      hostname: urlObj.hostname, path: urlObj.pathname,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body), ...headers }
    }
    const req = https.request(opts, (res) => {
      let chunks = []
      res.on('data', (chunk) => chunks.push(chunk))
      res.on('end', () => {
        try { resolve(JSON.parse(Buffer.concat(chunks).toString())) }
        catch (e) { reject(e) }
      })
    })
    req.on('error', reject)
    req.write(body)
    req.end()
  })
}

/** AI 对话 */
async function chat(data) {
  const { OPENID } = cloud.getWXContext()
  if (!OPENID) return f('请先登录')
  const { message, history = [] } = data
  if (!message) return f('请输入消息')

  const msgs = [
    { role: 'system', content: '你是智慧就业平台的智能助手，帮助求职者找工作、解答就业相关问题。请用亲切、简洁的语气回复。' },
    ...history.slice(-20),
    { role: 'user', content: message }
  ]

  // 未配置 Key 时返回提示
  if (API_KEY === 'your-deepseek-api-key-here') {
    const reply = 'DeepSeek API Key 还未配置。请将 cloudfunctions/ai-chat/index.js 中的 `your-deepseek-api-key-here` 替换为你的 Key。'
    await saveHistory(OPENID, message, reply)
    return s({ reply })
  }

  try {
    const result = await httpsPost(API_URL, {
      model: 'deepseek-chat', messages: msgs,
      temperature: 0.7, max_tokens: 1000
    }, { 'Authorization': `Bearer ${API_KEY}` })

    const reply = (result.choices && result.choices[0] && result.choices[0].message && result.choices[0].message.content)
      || '抱歉，我没有理解您的意思，请重新描述一下。'

    await saveHistory(OPENID, message, reply)
    return s({ reply })
  } catch (err) {
    console.error('[ai-chat] API error', err)
    const reply = 'AI 服务暂时不可用，请稍后再试。'
    await saveHistory(OPENID, message, reply)
    return s({ reply })
  }
}

/** 保存聊天记录 */
async function saveHistory(openid, userMsg, aiReply) {
  try {
    await db.collection('chat_history').add({
      data: {
        openid, userMsg, aiReply,
        time: db.serverDate(), createdAt: db.serverDate()
      }
    })
  } catch (e) { console.error('[ai-chat] save history error', e) }
}

/** 获取聊天历史 */
async function getHistory(data) {
  const { OPENID } = cloud.getWXContext()
  if (!OPENID) return f('请先登录')
  const { page = 1, pageSize = 20 } = data
  const total = await db.collection('chat_history').where({ openid: OPENID }).count()
  const list = await db.collection('chat_history').where({ openid: OPENID })
    .orderBy('time', 'desc').skip((page - 1) * pageSize).limit(pageSize).get()
  return s({ list: list.data || [], total: total.total, page, pageSize })
}
