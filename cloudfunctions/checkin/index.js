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
      case 'listByCompany': return await listByCompany(data)
      case 'getMyQRData': return await getMyQRData()
      case 'generateQR': return await generateQR(data)
      default: return { code: 0, msg: 'unknown action', data: { action, ready: false } }
    }
  } catch (err) {
    console.error('[checkin]', err)
    return { code: -1, msg: err.message }
  }
}

function success(d = null, m = 'ok') { return { code: 0, msg: m, data: d } }
function fail(m = 'fail') { return { code: -1, msg: m, data: null } }

async function getAccount() {
  const { OPENID } = cloud.getWXContext()
  if (!OPENID) return null
  const r = await db.collection('accounts').where({ openid: OPENID }).limit(1).get()
  return r.data[0] || null
}

/** 企业扫码核销签到 */
async function create(data) {
  const ac = await getAccount()
  if (!ac || ac.role !== 'company_admin') return fail('无权操作')
  const { applicationId } = data
  if (!applicationId) return fail('缺少核销码')

  const ar = await db.collection('applications').doc(applicationId).get()
  const a = ar.data
  if (!a) return fail('核销码无效')
  if (a.status !== 'accepted') return fail('该报名状态不可签到')
  if (a.companyId !== ac._id) return fail('非本企业的报名')

  const today = new Date().toISOString().slice(0, 10)
  const ex = await db.collection('checkins').where({ applicationId, date: today }).limit(1).get()
  if (ex.data && ex.data.length > 0) return fail('今天已签到')

  const ds = today.replace(/-/g, '')
  await db.collection('checkins').add({
    data: {
      _id: `${ds}-${(a.jobTitle || '').trim()}-${(a.jobseekerName || '').trim()}`,
      applicationId, jobId: a.jobId, jobseekerId: a.jobseekerId, companyId: a.companyId,
      jobTitle: a.jobTitle, jobseekerName: a.jobseekerName,
      jobseekerPhone: a.jobseekerPhone, companyName: a.companyName,
      checkinTime: db.serverDate(), date: today, createdAt: db.serverDate()
    }
  })
  return success(null, '签到成功')
}

/** 求职者获取核销码列表 */
async function getMyQRData() {
  const ac = await getAccount()
  if (!ac) return fail('请先登录')
  const jr = await db.collection('jobseekers').where({ accountId: ac._id }).limit(1).get()
  const js = jr.data[0]
  const jid = (js && js._id) || ac._id

  const apps = await db.collection('applications')
    .where({ jobseekerId: jid, status: 'accepted' })
    .orderBy('applyTime', 'desc').get()

  const today = new Date().toISOString().slice(0, 10)
  const ck = await db.collection('checkins').where({ jobseekerId: jid, date: today }).get()
  const done = new Set((ck.data || []).map(c => c.applicationId))

  return success((apps.data || []).map(a => ({
    applicationId: a._id, jobTitle: a.jobTitle,
    companyName: a.companyName, checkedIn: done.has(a._id)
  })))
}

/** 求职者签到记录 */
async function listMine(data) {
  const ac = await getAccount()
  if (!ac) return fail('请先登录')
  const jr = await db.collection('jobseekers').where({ accountId: ac._id }).limit(1).get()
  const js = jr.data[0]
  const jid = (js && js._id) || ac._id
  const { page = 1, pageSize = 20 } = data
  const total = await db.collection('checkins').where({ jobseekerId: jid }).count()
  const list = await db.collection('checkins').where({ jobseekerId: jid })
    .orderBy('checkinTime', 'desc').skip((page - 1) * pageSize).limit(pageSize).get()
  return success({ list: list.data || [], total: total.total, page, pageSize })
}

/** 企业签到记录 */
async function listByCompany(data) {
  const ac = await getAccount()
  if (!ac || ac.role !== 'company_admin') return fail('无权操作')
  const { jobId, date, page = 1, pageSize = 50 } = data
  const wh = { companyId: ac._id }
  if (jobId) wh.jobId = jobId
  if (date) wh.date = date
  const total = await db.collection('checkins').where(wh).count()
  const list = await db.collection('checkins').where(wh)
    .orderBy('checkinTime', 'desc').skip((page - 1) * pageSize).limit(pageSize).get()
  return success({ list: list.data || [], total: total.total, page, pageSize })
}

/** 生成二维码图片 */
async function generateQR(data) {
  const { text } = data
  if (!text) return fail('缺少二维码内容')
  try {
    const qrcode = require('qrcode')
    const buffer = await qrcode.toBuffer(text, { width: 400, margin: 2 })
    const fn = `qrcode/${Date.now()}.png`
    const up = await cloud.uploadFile({ cloudPath: fn, fileContent: buffer })
    return success({ fileID: up.fileID }, '二维码已生成')
  } catch (err) {
    console.error('[checkin] qrcode error', err)
    return success({ textOnly: true, text }, '文字模式')
  }
}
