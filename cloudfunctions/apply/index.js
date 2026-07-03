const cloud = require('wx-server-sdk')
const { success, fail } = require('./response')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

function hasRole(account, role) {
  if (!account) {
    return false
  }

  if (account.role === role) {
    return true
  }

  return Array.isArray(account.roles) && account.roles.includes(role)
}

function buildApplicationId(jobId, jobseekerId) {
  const random = Math.random().toString(36).slice(2, 8)
  return `${Date.now()}-${random}-${jobId}-${jobseekerId}`
}

function isDuplicateKeyError(error) {
  const message = String(
    (error && (error.message || error.errMsg || error.msg)) || ''
  )

  return (
    message.includes('E11000') ||
    message.includes('duplicate key error') ||
    message.includes('_id_ dup key')
  )
}

exports.main = async (event) => {
  const { action, data = {} } = event

  if (!action) {
    return fail('action is required')
  }

  try {
    switch (action) {
      case 'create':
        return await create(data)
      case 'listMine':
        return await listMine(data)
      case 'cancel':
        return await cancel(data)
      case 'listByCompany':
        return await listByCompany(data)
      case 'accept':
        return await accept(data)
      case 'reject':
        return await reject(data)
      case 'exportAll':
        return await exportAll()
      default:
        return success({ action, ready: false }, 'unknown action')
    }
  } catch (err) {
    console.error('[apply]', err)
    return fail(err.message || 'apply cloud function failed')
  }
}

async function getCurrentAccount() {
  const { OPENID } = cloud.getWXContext()
  if (!OPENID) {
    return null
  }

  const res = await db.collection('accounts').where({ openid: OPENID }).limit(1).get()
  return res.data[0] || null
}

async function getJobseeker(accountId) {
  if (!accountId) {
    return null
  }

  const res = await db.collection('jobseekers').where({ accountId }).limit(1).get()
  return res.data[0] || null
}

async function getCompanyJobIds(companyId) {
  if (!companyId) {
    return []
  }

  const ids = []
  let page = 0
  const pageSize = 100
  let hasMore = true

  while (hasMore) {
    const res = await db.collection('jobs')
      .where({ companyId })
      .skip(page * pageSize)
      .limit(pageSize)
      .get()

    const list = res.data || []
    list.forEach((item) => {
      if (item && item._id) {
        ids.push(item._id)
      }
    })

    hasMore = list.length === pageSize
    page += 1
  }

  return ids
}

async function getOwnedJob(accountId, jobId) {
  if (!accountId || !jobId) {
    return null
  }

  const res = await db.collection('jobs').doc(jobId).get()
  const job = res.data || null

  if (!job || job.companyId !== accountId) {
    return null
  }

  return job
}

function buildPagedResult(list, total, page, pageSize) {
  return success({
    list,
    total,
    page,
    pageSize,
    hasMore: page * pageSize < total
  })
}

async function create(data) {
  const account = await getCurrentAccount()
  if (!account) {
    return fail('请先登录')
  }

  const { jobId } = data
  if (!jobId) {
    return fail('缺少岗位ID')
  }

  const jobRes = await db.collection('jobs').doc(jobId).get()
  const job = jobRes.data

  if (!job) {
    return fail('岗位不存在')
  }

  if (job.auditStatus !== 'approved' || job.recruitStatus !== 'recruiting') {
    return fail('该岗位当前不可报名')
  }

  const jobseeker = await getJobseeker(account._id)
  const jobseekerId = (jobseeker && jobseeker._id) || account._id
  const name = (jobseeker && jobseeker.name) || account.name || ''
  const phone = (jobseeker && jobseeker.phone) || account.phone || ''

  if (!name) {
    return fail('请先完善个人资料')
  }

  const existing = await db.collection('applications')
    .where({
      jobId,
      jobseekerId,
      status: 'submitted'
    })
    .limit(1)
    .get()

  if (existing.data && existing.data.length > 0) {
    return fail('您已经报名过该岗位')
  }

  const now = db.serverDate()
  const customId = buildApplicationId(jobId, jobseekerId)

  let applyRes = null
  try {
    applyRes = await db.collection('applications').add({
      data: {
        _id: customId,
        jobId,
        jobseekerId,
        companyId: job.companyId || '',
        jobTitle: job.title || '',
        companyName: job.companyName || '',
        jobseekerName: name,
        jobseekerPhone: phone,
        status: 'submitted',
        applyTime: now,
        processTime: null,
        remarks: '',
        createdAt: now,
        updatedAt: now
      }
    })
  } catch (err) {
    if (isDuplicateKeyError(err)) {
      const latest = await db.collection('applications')
        .where({ jobId, jobseekerId })
        .limit(1)
        .get()
        .catch(() => ({ data: [] }))

      const existingApplication = latest.data && latest.data[0]
      if (existingApplication && ['submitted', 'accepted', 'completed'].includes(existingApplication.status)) {
        return fail('您已经报名过该岗位，请到我的报名查看')
      }

      return fail('报名请求重复，请稍后刷新后重试')
    }

    throw err
  }

  await db.collection('jobs').doc(jobId).update({
    data: {
      applyCount: _.inc(1)
    }
  }).catch((err) => {
    console.error('[apply] inc applyCount error', err)
  })

  return success({ applicationId: applyRes._id }, '报名成功')
}

async function listMine(data) {
  const account = await getCurrentAccount()
  if (!account) {
    return fail('请先登录')
  }

  const jobseeker = await getJobseeker(account._id)
  const jobseekerId = (jobseeker && jobseeker._id) || account._id
  const { page = 1, pageSize = 20 } = data
  const skip = (page - 1) * pageSize

  const totalRes = await db.collection('applications').where({ jobseekerId }).count()
  const listRes = await db.collection('applications')
    .where({ jobseekerId })
    .orderBy('applyTime', 'desc')
    .skip(skip)
    .limit(pageSize)
    .get()

  return buildPagedResult(listRes.data || [], totalRes.total || 0, page, pageSize)
}

async function cancel(data) {
  const account = await getCurrentAccount()
  if (!account) {
    return fail('请先登录')
  }

  const { applicationId } = data
  if (!applicationId) {
    return fail('缺少报名ID')
  }

  const appRes = await db.collection('applications').doc(applicationId).get()
  const application = appRes.data

  if (!application) {
    return fail('报名记录不存在')
  }

  const jobseeker = await getJobseeker(account._id)
  const jobseekerId = (jobseeker && jobseeker._id) || account._id
  if (application.jobseekerId !== jobseekerId) {
    return fail('无权操作这条报名记录')
  }

  if (application.status !== 'submitted') {
    return fail('当前状态不可取消')
  }

  await db.collection('applications').doc(applicationId).update({
    data: {
      status: 'cancelled',
      updatedAt: db.serverDate()
    }
  })

  await db.collection('jobs').doc(application.jobId).update({
    data: {
      applyCount: _.inc(-1)
    }
  }).catch((err) => {
    console.error('[apply] dec applyCount error', err)
  })

  return success(null, '已取消报名')
}

async function listByCompany(data) {
  const account = await getCurrentAccount()
  if (!account) {
    return fail('请先登录企业账号')
  }
  if (!hasRole(account, 'company_admin')) {
    return fail('当前微信还未绑定企业身份，请先登录企业端')
  }

  const { jobId, status, page = 1, pageSize = 50 } = data
  const skip = (page - 1) * pageSize
  const whereCondition = {}

  if (jobId) {
    const job = await getOwnedJob(account._id, jobId)
    if (!job) {
      return fail('无权访问该岗位')
    }
    whereCondition.jobId = jobId
  } else {
    const jobIds = await getCompanyJobIds(account._id)
    if (!jobIds.length) {
      return buildPagedResult([], 0, page, pageSize)
    }
    whereCondition.jobId = _.in(jobIds)
  }

  if (status) {
    whereCondition.status = status
  }

  const totalRes = await db.collection('applications').where(whereCondition).count()
  const listRes = await db.collection('applications')
    .where(whereCondition)
    .orderBy('applyTime', 'desc')
    .skip(skip)
    .limit(pageSize)
    .get()

  return buildPagedResult(listRes.data || [], totalRes.total || 0, page, pageSize)
}

async function accept(data) {
  const account = await getCurrentAccount()
  if (!account) {
    return fail('请先登录企业账号')
  }
  if (!hasRole(account, 'company_admin')) {
    return fail('当前微信还未绑定企业身份，请先登录企业端')
  }

  const { applicationId, remarks } = data
  if (!applicationId) {
    return fail('缺少报名ID')
  }

  const appRes = await db.collection('applications').doc(applicationId).get()
  const application = appRes.data

  if (!application) {
    return fail('报名不存在')
  }

  if (application.status !== 'submitted') {
    return fail('当前状态不可操作')
  }

  const job = await getOwnedJob(account._id, application.jobId)
  if (!job) {
    return fail('无权操作该报名')
  }

  await db.collection('applications').doc(applicationId).update({
    data: {
      status: 'accepted',
      processTime: db.serverDate(),
      remarks: remarks || '',
      updatedAt: db.serverDate()
    }
  })

  return success(null, '已录取')
}

async function reject(data) {
  const account = await getCurrentAccount()
  if (!account) {
    return fail('请先登录企业账号')
  }
  if (!hasRole(account, 'company_admin')) {
    return fail('当前微信还未绑定企业身份，请先登录企业端')
  }

  const { applicationId, remarks } = data
  if (!applicationId) {
    return fail('缺少报名ID')
  }

  const appRes = await db.collection('applications').doc(applicationId).get()
  const application = appRes.data

  if (!application) {
    return fail('报名不存在')
  }

  if (application.status !== 'submitted') {
    return fail('当前状态不可操作')
  }

  const job = await getOwnedJob(account._id, application.jobId)
  if (!job) {
    return fail('无权操作该报名')
  }

  await db.collection('applications').doc(applicationId).update({
    data: {
      status: 'rejected',
      processTime: db.serverDate(),
      remarks: remarks || '',
      updatedAt: db.serverDate()
    }
  })

  return success(null, '已拒绝')
}

async function exportAll() {
  // 仅平台管理员可导出全量数据
  const account = await getCurrentAccount()
  if (!account) {
    return fail('请先登录')
  }
  const isAdmin = account.role === 'platform_admin' ||
    (Array.isArray(account.roles) && account.roles.includes('platform_admin'))
  if (!isAdmin) {
    return fail('仅平台管理员可执行导出操作')
  }

  const allData = []
  let page = 0
  const pageSize = 100
  let hasMore = true

  while (hasMore) {
    const res = await db.collection('applications')
      .skip(page * pageSize)
      .limit(pageSize)
      .get()

    const list = res.data || []
    allData.push(...list)
    hasMore = list.length === pageSize
    page += 1
  }

  const statusMap = {
    submitted: '已报名',
    accepted: '已录取',
    rejected: '未通过',
    cancelled: '已取消',
    completed: '已完成'
  }

  const escapeCsv = (value) => {
    const text = String(value || '')
    return text.includes(',') || text.includes('"') ? `"${text.replace(/"/g, '""')}"` : text
  }

  const header = '岗位名称,企业名称,求职者姓名,手机号,状态,报名时间,处理时间,备注'
  const rows = allData.map((item) => [
    escapeCsv(item.jobTitle),
    escapeCsv(item.companyName),
    escapeCsv(item.jobseekerName),
    escapeCsv(item.jobseekerPhone),
    statusMap[item.status] || item.status,
    item.applyTime ? new Date(item.applyTime).toLocaleString('zh-CN') : '',
    item.processTime ? new Date(item.processTime).toLocaleString('zh-CN') : '',
    escapeCsv(item.remarks)
  ].join(',')).join('\n')

  const csv = '\uFEFF' + header + '\n' + rows
  const fileName = `导出_报名表_${new Date().toISOString().slice(0, 10).replace(/-/g, '')}.csv`

  const uploadRes = await cloud.uploadFile({
    cloudPath: `export/${fileName}`,
    fileContent: Buffer.from(csv, 'utf8')
  })

  return success({
    fileID: uploadRes.fileID,
    fileName,
    totalCount: allData.length
  }, `成功导出 ${allData.length} 条报名记录`)
}
