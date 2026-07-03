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

function ensureCompanyAdmin(account) {
  if (!account) {
    return fail('请先登录企业账号')
  }

  if (!hasRole(account, 'company_admin')) {
    return fail('当前微信还未绑定企业身份，请先登录企业端')
  }

  return null
}

function buildJobId(title = '', companyName = '') {
  const normalize = (value, fallback) => {
    const text = String(value || '')
      .trim()
      .replace(/\s+/g, '-')
      .replace(/[^\w\u4e00-\u9fa5-]/g, '')
      .slice(0, 24)

    return text || fallback
  }

  const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '')
  return `${dateStr}-${Date.now()}-${normalize(companyName, 'company')}-${normalize(title, 'job')}`
}

exports.main = async (event) => {
  const { action, data = {} } = event

  if (!action) {
    return fail('action is required')
  }

  try {
    switch (action) {
      case 'createJob':
        return await createJob(data)
      case 'updateJob':
        return await updateJob(data)
      case 'deleteJob':
        return await deleteJob(data)
      case 'getMyJobs':
        return await getMyJobs(data)
      case 'getMyJobDetail':
        return await getMyJobDetail(data)
      case 'getCompanyInfo':
        return await getCompanyInfo()
      default:
        return success({ action, ready: false }, 'company cloud function is ready')
    }
  } catch (err) {
    console.error('[company]', err)
    return fail(err.message || 'company cloud function failed')
  }
}

async function getCompanyAccount() {
  const { OPENID } = cloud.getWXContext()
  if (!OPENID) {
    return null
  }

  try {
    const res = await db.collection('accounts').where({ openid: OPENID }).limit(1).get()
    return res.data[0] || null
  } catch (err) {
    console.warn('[company] accounts collection not ready:', err)
    return null
  }
}

async function getApplicationCountMap(jobIds) {
  if (!jobIds || !jobIds.length) {
    return {}
  }

  const countMap = {}
  let page = 0
  const pageSize = 100
  let hasMore = true

  while (hasMore) {
    const res = await db.collection('applications')
      .where({
        jobId: _.in(jobIds)
      })
      .skip(page * pageSize)
      .limit(pageSize)
      .get()

    const list = res.data || []
    list.forEach((item) => {
      if (!item || !item.jobId || item.status === 'cancelled') {
        return
      }
      countMap[item.jobId] = (countMap[item.jobId] || 0) + 1
    })

    hasMore = list.length === pageSize
    page += 1
  }

  return countMap
}

async function createJob(data) {
  const account = await getCompanyAccount()
  const authError = ensureCompanyAdmin(account)
  if (authError) {
    return authError
  }

  const {
    title,
    categoryName,
    salaryMin,
    salaryMax,
    area,
    address,
    workHours,
    requirement,
    description,
    foodCondition,
    peopleCount,
    certImages
  } = data

  if (!title) {
    return fail('请填写岗位名称')
  }

  const now = db.serverDate()
  const companyName = account.companyName || account.name || '未知企业'
  const customId = buildJobId(title, companyName)

  const salaryStr = (salaryMin || salaryMax) ? `${(salaryMin || salaryMax)}-${(salaryMax || salaryMin)}元/天` : '面议'

  const jobData = {
    _id: customId,
    companyId: account._id,
    companyName,
    companyPhone: account.phone || '',
    title: title || '',
    categoryName: categoryName || '',
    salary: salaryStr,
    salaryMin: salaryMin || 0,
    salaryMax: salaryMax || 0,
    area: area || '',
    address: address || '',
    workHours: workHours || '',
    requirement: requirement || '',
    description: description || '',
    foodCondition: foodCondition || '',
    peopleCount: peopleCount || 0,
    certImages: certImages || [],
    recruitStatus: 'recruiting',
    auditStatus: 'pending',
    auditMsg: '',
    isHot: false,
    applyCount: 0,
    viewCount: 0,
    createdAt: now,
    updatedAt: now,
    publishedAt: null
  }

  const result = await db.collection('jobs').add({ data: jobData })
  return success({ jobId: result._id }, '岗位已提交，等待管理员审核')
}

async function updateJob(data) {
  const account = await getCompanyAccount()
  const authError = ensureCompanyAdmin(account)
  if (authError) {
    return authError
  }

  const { jobId, ...fields } = data
  if (!jobId) {
    return fail('缺少岗位ID')
  }

  const jobRes = await db.collection('jobs').doc(jobId).get()
  const job = jobRes.data

  if (!job || job.companyId !== account._id) {
    return fail('无权操作该岗位')
  }

  if (!['pending', 'rejected', 'revoked', 'draft'].includes(job.auditStatus)) {
    return fail('该岗位当前不可编辑')
  }

  const allowFields = [
    'title',
    'categoryName',
    'salaryMin',
    'salaryMax',
    'area',
    'address',
    'workHours',
    'requirement',
    'description',
    'foodCondition',
    'peopleCount',
    'recruitStatus',
    'certImages'
  ]

  const updateData = {}
  allowFields.forEach((key) => {
    if (fields[key] !== undefined) {
      updateData[key] = fields[key]
    }
  })

  updateData.auditStatus = 'pending'
  updateData.auditMsg = ''
  updateData.updatedAt = db.serverDate()

  await db.collection('jobs').doc(jobId).update({ data: updateData })
  return success(null, '岗位已更新，请等待管理员重新审核')
}

async function deleteJob(data) {
  const account = await getCompanyAccount()
  const authError = ensureCompanyAdmin(account)
  if (authError) {
    return authError
  }

  const { jobId } = data
  if (!jobId) {
    return fail('缺少岗位ID')
  }

  const jobRes = await db.collection('jobs').doc(jobId).get()
  const job = jobRes.data

  if (!job || job.companyId !== account._id) {
    return fail('无权操作该岗位')
  }

  await db.collection('jobs').doc(jobId).remove()
  return success(null, '岗位已删除')
}

async function getMyJobs(data) {
  const account = await getCompanyAccount()
  const authError = ensureCompanyAdmin(account)
  if (authError) {
    return authError
  }

  const { page = 1, pageSize = 20 } = data
  const skip = (page - 1) * pageSize
  const whereCondition = { companyId: account._id }

  const totalRes = await db.collection('jobs').where(whereCondition).count()
  const jobsRes = await db.collection('jobs')
    .where(whereCondition)
    .orderBy('updatedAt', 'desc')
    .skip(skip)
    .limit(pageSize)
    .get()

  const jobs = jobsRes.data || []
  const countMap = await getApplicationCountMap(
    jobs.map((item) => item && item._id).filter(Boolean)
  )

  const mergedJobs = jobs.map((job) => ({
    ...job,
    applyCount: countMap[job._id] !== undefined ? countMap[job._id] : (job.applyCount || 0)
  }))

  return success({
    jobs: mergedJobs,
    total: totalRes.total || 0,
    page,
    pageSize
  })
}

async function getMyJobDetail(data) {
  const account = await getCompanyAccount()
  const authError = ensureCompanyAdmin(account)
  if (authError) {
    return authError
  }

  const { jobId } = data
  if (!jobId) {
    return fail('缺少岗位ID')
  }

  const jobRes = await db.collection('jobs').doc(jobId).get()
  const job = jobRes.data

  if (!job || job.companyId !== account._id) {
    return fail('无权访问该岗位')
  }

  const countMap = await getApplicationCountMap([jobId])
  return success({
    ...job,
    applyCount: countMap[jobId] !== undefined ? countMap[jobId] : (job.applyCount || 0)
  })
}

async function getCompanyInfo() {
  const account = await getCompanyAccount()
  const authError = ensureCompanyAdmin(account)
  if (authError) {
    return authError
  }

  return success(account)
}
