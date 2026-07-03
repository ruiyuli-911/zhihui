const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

/** 获取当前调用者账号 */
async function getAccount() {
  const { OPENID } = cloud.getWXContext()
  if (!OPENID) return null
  const r = await db.collection('accounts').where({ openid: OPENID }).limit(1).get()
  return r.data[0] || null
}

/** 校验是否为管理员（平台管理员 或 政府管理员） */
function isAdmin(account) {
  if (!account) return false
  return account.role === 'platform_admin' || account.role === 'gov_admin' ||
    (Array.isArray(account.roles) && (account.roles.includes('platform_admin') || account.roles.includes('gov_admin')))
}

exports.main = async (event) => {
  const { action, data = {} } = event
  if (!action) return { code: -1, msg: 'action is required' }

  try {
    switch (action) {
      case 'create':
      case 'update':
      case 'delete': {
        // 写操作仅管理员可执行
        const account = await getAccount()
        if (!isAdmin(account)) return { code: -1, msg: '无权操作，仅管理员可管理政策', data: null }
        if (action === 'create') return await create(data)
        if (action === 'update') return await update(data)
        return await deleteData(data)
      }
      case 'list': return await listData(data)
      default: return { code: 0, data: { action, ready: false } }
    }
  } catch (err) {
    console.error('[policy]', err)
    return { code: -1, msg: err.message }
  }
}

function s(d = null, m = 'ok') { return { code: 0, msg: m, data: d } }
function f(m = 'fail') { return { code: -1, msg: m, data: null } }

/** 发布政策 */
async function create(data) {
  const { title, content } = data
  if (!title) return f('请输入标题')
  const ds = new Date().toISOString().slice(0, 10).replace(/-/g, '')
  await db.collection('policies').add({
    data: {
      _id: `${ds}-${title.trim()}`,
      title: title.trim(), content: content || '',
      createdAt: db.serverDate(), updatedAt: db.serverDate()
    }
  })
  return s(null, '政策已发布')
}

/** 政策列表 */
async function listData(data) {
  const { page = 1, pageSize = 20 } = data
  const total = await db.collection('policies').count()
  const list = await db.collection('policies')
    .orderBy('createdAt', 'desc').skip((page - 1) * pageSize).limit(pageSize).get()
  return s({ list: list.data || [], total: total.total, page, pageSize })
}

/** 更新政策 */
async function update(data) {
  const { _id, title, content } = data
  if (!_id) return f('缺少ID')
  const up = {}
  if (title) up.title = title
  if (content !== undefined) up.content = content
  up.updatedAt = db.serverDate()
  await db.collection('policies').doc(_id).update({ data: up })
  return s(null, '已更新')
}

/** 删除政策 */
async function deleteData(data) {
  const { _id } = data
  if (!_id) return f('缺少ID')
  await db.collection('policies').doc(_id).remove()
  return s(null, '已删除')
}
