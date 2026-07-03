const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

exports.main = async (event) => {
  const { action, data = {} } = event
  if (!action) return { code: -1, msg: 'action is required' }

  try {
    switch (action) {
      case 'create': return await create(data)
      case 'listMine': return await listMine(data)
      case 'markRead': return await markRead(data)
      case 'unreadCount': return await unreadCount()
      default: return { code: 0, data: { action, ready: false } }
    }
  } catch (err) {
    console.error('[notification]', err)
    return { code: -1, msg: err.message }
  }
}

function s(d = null, m = 'ok') { return { code: 0, msg: m, data: d } }
function f(m = 'fail') { return { code: -1, msg: m, data: null } }

async function getAccount() {
  const { OPENID } = cloud.getWXContext()
  if (!OPENID) return null
  const r = await db.collection('accounts').where({ openid: OPENID }).limit(1).get()
  return r.data[0] || null
}

/** 创建通知（仅平台管理员或系统内部可调用） */
async function create(data) {
  // 校验调用者权限
  const ac = await getAccount()
  const isAdmin = ac && (ac.role === 'platform_admin' ||
    (Array.isArray(ac.roles) && ac.roles.includes('platform_admin')))
  if (!isAdmin) {
    return f('无权操作，仅平台管理员可发送系统通知')
  }

  const { userId, title, content, type = 'system' } = data
  if (!userId || !title) return f('缺少参数')
  await db.collection('notifications').add({
    data: { userId, title, content: content || '', type, read: false, createdAt: db.serverDate() }
  })
  return s(null, '通知已创建')
}

/** 获取我的通知 */
async function listMine(data) {
  const ac = await getAccount()
  if (!ac) return f('请先登录')
  const { page = 1, pageSize = 20 } = data
  const total = await db.collection('notifications').where({ userId: ac._id }).count()
  const list = await db.collection('notifications').where({ userId: ac._id })
    .orderBy('createdAt', 'desc').skip((page - 1) * pageSize).limit(pageSize).get()
  return s({ list: list.data || [], total: total.total })
}

/** 标记已读 */
async function markRead(data) {
  const ac = await getAccount()
  if (!ac) return f('请先登录')
  const { id } = data
  if (id) {
    await db.collection('notifications').doc(id).update({ data: { read: true } })
  } else {
    await db.collection('notifications').where({ userId: ac._id, read: false }).update({ data: { read: true } })
  }
  return s(null, '已标记已读')
}

/** 未读数 */
async function unreadCount() {
  const ac = await getAccount()
  if (!ac) return s({ count: 0 })
  const r = await db.collection('notifications').where({ userId: ac._id, read: false }).count()
  return s({ count: r.total || 0 })
}
