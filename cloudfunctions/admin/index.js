const cloud = require('wx-server-sdk')
const XLSX = require('xlsx')
const { success, fail } = require('./response')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

/**
 * 智汇就业 — 管理后台云函数
 * 平台管理员操作：审核岗位、标记热门
 */
exports.main = async (event) => {
  const { action, data = {} } = event

  if (!action) {
    return fail('action is required')
  }

  try {
    switch (action) {
      // 岗位审核
      case 'getPendingJobs':
        return await getPendingJobs(data)
      case 'approveJob':
        return await approveJob(data)
      case 'rejectJob':
        return await rejectJob(data)
      // 热门标记
      case 'toggleHot':
        return await toggleHot(data)
      case 'getAllJobs':
        return await getAllJobs(data)
      case 'getJobAuditStats':
        return await getJobAuditStats()
      case 'seedTestData':
        return await seedTestData(data)
      case 'revokeJob':
        return await revokeJob(data)
      case 'setupCollections':
        return await setupCollections()
      case 'exportJobseekers':
        return await exportJobseekersWorkbook()
      case 'exportApplications':
        return await exportApplicationsWorkbook()
      case 'deleteJob':
        return await deleteJob(data)
      case 'listCompanies':
        return await listCompanies(data)
      case 'listUsers':
        return await listUsers(data)
      case 'toggleUserStatus':
        return await toggleUserStatus(data)
      case 'migrateIds':
        return await migrateIds()
      default:
        return success({ action, ready: false }, 'admin cloud function is ready')
    }
  } catch (err) {
    console.error('[admin]', err)
    return fail(err.message || 'admin cloud function failed')
  }
}

/** 验证管理员身份 */
function hasPlatformAdminRole(account = {}) {
  return account.role === 'platform_admin' ||
    (Array.isArray(account.roles) && account.roles.includes('platform_admin'))
}

async function verifyAdmin() {
  const { OPENID } = cloud.getWXContext()
  if (!OPENID) {
    throw new Error('无法获取用户身份')
  }

  const res = await db.collection('accounts').where({ openid: OPENID }).limit(1).get()
  const account = res.data[0]
  if (!account || !hasPlatformAdminRole(account)) {
    throw new Error('无权操作，仅平台管理员可执行')
  }
  return account
}

/** 获取待审核岗位列表 */
async function getPendingJobs(data) {
  await verifyAdmin()

  const { page = 1, pageSize = 20, auditStatus = 'pending' } = data
  const skip = (page - 1) * pageSize

  const whereCondition = { auditStatus }
  const totalRes = await db.collection('jobs').where(whereCondition).count()
  const jobsRes = await db.collection('jobs')
    .where(whereCondition)
    .orderBy('updatedAt', 'desc')
    .skip(skip)
    .limit(pageSize)
    .get()

  return success({
    jobs: jobsRes.data,
    total: totalRes.total,
    page,
    pageSize,
    hasMore: skip + jobsRes.data.length < totalRes.total
  })
}

/** 获取所有岗位（审核用） */
async function getAllJobs(data) {
  await verifyAdmin()

  const { page = 1, pageSize = 20, auditStatus } = data
  const skip = (page - 1) * pageSize

  const whereCondition = {}
  if (auditStatus) {
    whereCondition.auditStatus = auditStatus
  }

  const totalRes = await db.collection('jobs').where(whereCondition).count()
  const jobsRes = await db.collection('jobs')
    .where(whereCondition)
    .orderBy('updatedAt', 'desc')
    .skip(skip)
    .limit(pageSize)
    .get()

  return success({
    jobs: jobsRes.data,
    total: totalRes.total,
    page,
    pageSize,
    hasMore: skip + jobsRes.data.length < totalRes.total
  })
}

async function getJobAuditStats() {
  await verifyAdmin()

  const statuses = ['pending', 'approved', 'rejected', 'revoked']
  const counts = await Promise.all(
    statuses.map((status) => db.collection('jobs').where({ auditStatus: status }).count())
  )

  return success({
    pending: counts[0].total || 0,
    approved: counts[1].total || 0,
    rejected: counts[2].total || 0,
    revoked: counts[3].total || 0
  })
}

/** 审核通过岗位 */
async function approveJob(data) {
  await verifyAdmin()

  const { jobId } = data
  if (!jobId) {
    return fail('缺少岗位ID')
  }

  const now = db.serverDate()
  await db.collection('jobs').doc(jobId).update({
    data: {
      auditStatus: 'approved',
      auditMsg: '',
      updatedAt: now,
      publishedAt: now
    }
  })

  return success(null, '岗位审核通过，已发布')
}

/** 驳回岗位 */
async function rejectJob(data) {
  await verifyAdmin()

  const { jobId, reason = '不符合平台发布规范' } = data
  if (!jobId) {
    return fail('缺少岗位ID')
  }

  await db.collection('jobs').doc(jobId).update({
    data: {
      auditStatus: 'rejected',
      auditMsg: reason,
      recruitStatus: 'closed',
      updatedAt: db.serverDate()
    }
  })

  return success(null, '岗位已驳回')
}

/** 切换热门标记 */
async function toggleHot(data) {
  await verifyAdmin()

  const { jobId, isHot } = data
  if (!jobId) {
    return fail('缺少岗位ID')
  }

  await db.collection('jobs').doc(jobId).update({
    data: {
      isHot: !!isHot,
      updatedAt: db.serverDate()
    }
  })

  return success(null, isHot ? '已标记为热门岗位' : '已取消热门标记')
}

/** 管理员删除岗位 */
async function deleteJob(data) {
  await verifyAdmin()
  const { jobId } = data
  if (!jobId) return fail('缺少岗位ID')

  const job = await db.collection('jobs').doc(jobId).get()
  if (!job.data) return fail('岗位不存在')

  await db.collection('jobs').doc(jobId).remove()
  return success(null, `岗位「${job.data.title}」已删除`)
}

/** 获取企业列表 */
async function listCompanies(data) {
  await verifyAdmin()
  const { page = 1, pageSize = 50 } = data
  const where = _.or([{ role: 'company_admin' }, { roles: 'company_admin' }])
  const total = await db.collection('accounts').where(where).count()
  const list = await db.collection('accounts').where(where)
    .orderBy('createTime', 'desc').skip((page - 1) * pageSize).limit(pageSize).get()
  return success({ list: list.data || [], total: total.total, page, pageSize })
}

/** 获取用户列表 */
async function listUsers(data) {
  await verifyAdmin()
  const { page = 1, pageSize = 50, role } = data
  const where = {}
  if (role) where.role = role
  const total = await db.collection('accounts').where(where).count()
  const list = await db.collection('accounts').where(where)
    .orderBy('createTime', 'desc').skip((page - 1) * pageSize).limit(pageSize).get()
  return success({ list: list.data || [], total: total.total, page, pageSize })
}

/** 切换用户状态（启用/禁用） */
async function toggleUserStatus(data) {
  await verifyAdmin()
  const { userId, status } = data
  if (!userId || !status) return fail('缺少参数')
  await db.collection('accounts').doc(userId).update({
    data: { status, updateTime: db.serverDate() }
  })
  return success(null, status === 'disabled' ? '已禁用' : '已启用')
}

/** 一键初始化测试岗位数据 */
async function seedTestData() {
  await verifyAdmin()

  // 尝试查找企业账号，找不到就用默认值
  let companyId = 'company_default'
  let companyName = '山阳建工集团'
  let companyPhone = ''

  try {
    const companyRes = await db.collection('accounts').where({ role: 'company_admin' }).limit(1).get()
    if (companyRes.data && companyRes.data[0]) {
      const c = companyRes.data[0]
      companyId = c._id
      companyName = c.companyName || c.name || '山阳建工集团'
      companyPhone = c.phone || ''
    }
  } catch (e) {
    console.warn('[seed] accounts collection not found, using default company')
  }

  const now = db.serverDate()
  const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '')
  // 中文企业名用于 ID
  const makeId = (title, cname) => `${dateStr}-${title}-${cname}`

  const testJobs = [
    {
      _id: makeId('建筑小工', '山阳建工集团'),
      companyId, companyName, companyPhone,
      title: '建筑小工',
      categoryName: '建筑工',
      salaryMin: 260, salaryMax: 320,
      area: '山阳县城', address: '山阳县城东工业园',
      workHours: '8小时左右', foodCondition: '包午饭', peopleCount: 10,
      requirement: '年龄18-55岁，身体健康，能吃苦耐劳',
      description: '负责工地现场基础建设工作，工作稳定，工资月结。',
      recruitStatus: 'recruiting', auditStatus: 'approved', auditMsg: '',
      isHot: true, applyCount: 18, viewCount: 156,
      createdAt: now, updatedAt: now, publishedAt: now
    },
    {
      _id: makeId('小区保洁员', '安居物业'),
      companyId, companyName: '安居物业', companyPhone: '',
      title: '小区保洁员',
      categoryName: '保洁',
      salaryMin: 150, salaryMax: 180,
      area: '城东社区', address: '山阳县城东街道安居小区',
      workHours: '白班8小时', foodCondition: '不包吃', peopleCount: 5,
      requirement: '年龄30-55岁，细心负责',
      description: '负责小区公共区域卫生清洁工作，工作轻松。',
      recruitStatus: 'recruiting', auditStatus: 'approved', auditMsg: '',
      isHot: false, applyCount: 12, viewCount: 98,
      createdAt: now, updatedAt: now, publishedAt: now
    },
    {
      _id: makeId('搬运工', '顺达物流'),
      companyId, companyName: '顺达物流', companyPhone: '',
      title: '搬运工',
      categoryName: '搬运工',
      salaryMin: 220, salaryMax: 280,
      area: '物流园', address: '山阳县城南物流园A区',
      workHours: '计件制', foodCondition: '提供住宿', peopleCount: 8,
      requirement: '年龄20-50岁，能适应体力劳动',
      description: '负责货物装卸、搬运，计件工资多劳多得。',
      recruitStatus: 'recruiting', auditStatus: 'approved', auditMsg: '',
      isHot: true, applyCount: 25, viewCount: 203,
      createdAt: now, updatedAt: now, publishedAt: now
    },
    {
      _id: makeId('家政保姆', '家政服务中心'),
      companyId, companyName: '家政服务中心', companyPhone: '',
      title: '家政保姆',
      categoryName: '家政',
      salaryMin: 180, salaryMax: 250,
      area: '山阳县城', address: '客户家中',
      workHours: '灵活排班', foodCondition: '包吃', peopleCount: 6,
      requirement: '女性，年龄25-50岁，干净利落',
      description: '为客户提供家庭清洁、做饭等服务，时间灵活。',
      recruitStatus: 'recruiting', auditStatus: 'approved', auditMsg: '',
      isHot: false, applyCount: 9, viewCount: 67,
      createdAt: now, updatedAt: now, publishedAt: now
    },
    {
      _id: makeId('小区保安', '保安服务公司'),
      companyId, companyName: '保安服务公司', companyPhone: '',
      title: '小区保安',
      categoryName: '保安',
      salaryMin: 160, salaryMax: 200,
      area: '山阳县城', address: '各合作小区',
      workHours: '12小时轮班', foodCondition: '包住', peopleCount: 4,
      requirement: '年龄18-55岁，身体健康，无不良记录',
      description: '负责小区门岗值守、巡逻、车辆管理。',
      recruitStatus: 'recruiting', auditStatus: 'approved', auditMsg: '',
      isHot: false, applyCount: 6, viewCount: 45,
      createdAt: now, updatedAt: now, publishedAt: now
    },
    {
      _id: makeId('绿化养护工', '绿意园林'),
      companyId, companyName: '绿意园林', companyPhone: '',
      title: '绿化养护工',
      categoryName: '绿化',
      salaryMin: 140, salaryMax: 180,
      area: '山阳县城', address: '城区绿化带',
      workHours: '8小时白班', foodCondition: '包午饭', peopleCount: 3,
      requirement: '年龄30-60岁，能适应户外工作',
      description: '负责城区绿化带修剪、浇水、除草等养护工作。',
      recruitStatus: 'recruiting', auditStatus: 'approved', auditMsg: '',
      isHot: false, applyCount: 4, viewCount: 32,
      createdAt: now, updatedAt: now, publishedAt: now
    }
  ]

  // 先清空已有测试数据（如果存在）
  try {
    const existing = await db.collection('jobs').where({ isTestData: true }).count()
    if (existing.total > 0) {
      await db.collection('jobs').where({ isTestData: true }).remove()
    }
  } catch (e) {
    // jobs 集合可能还不存在，首次运行忽略
    console.warn('[seed] no existing test data to clean')
  }

  const results = []
  for (const job of testJobs) {
    const res = await db.collection('jobs').add({ data: { ...job, isTestData: true } })
    results.push(res._id)
  }

  return success({
    insertedCount: results.length,
    companyName
  }, `成功创建 ${results.length} 条测试岗位数据`)
}

/** 撤销已审核通过的岗位（管理员审错了可纠正） */
async function revokeJob(data) {
  await verifyAdmin()

  const { jobId, reason = '管理员撤销' } = data
  if (!jobId) {
    return fail('缺少岗位ID')
  }

  const job = await db.collection('jobs').doc(jobId).get()
  if (!job.data) {
    return fail('岗位不存在')
  }

  await db.collection('jobs').doc(jobId).update({
    data: {
      auditStatus: 'revoked',
      auditMsg: reason,
      recruitStatus: 'closed',
      updatedAt: db.serverDate()
    }
  })

  return success(null, `岗位「${job.data.title}」已撤销，企业可编辑后重新提交`)
}

/** 自动创建所有需要的数据库集合 */
async function setupCollections() {
  await verifyAdmin()
  const collections = ['accounts', 'jobs', 'applications', 'wage_statements', 'checkins', 'policies', 'favorites', 'chat_history']
  const results = []

  for (const name of collections) {
    try {
      // 尝试查询，如果集合不存在会抛异常
      await db.collection(name).limit(1).get()
      results.push({ name, status: '已存在' })
    } catch (e) {
      try {
        // 集合不存在，添加一个文档自动创建集合
        const res = await db.collection(name).add({ data: { _init: true, _createdAt: db.serverDate() } })
        // 删除临时文档
        if (res._id) {
          await db.collection(name).doc(res._id).remove()
        }
        results.push({ name, status: '已创建' })
      } catch (e2) {
        results.push({ name, status: '创建失败', error: e2.message })
      }
    }
  }

  return success(results, '数据库初始化完成')
}

/** 导出所有求职者信息为CSV */
async function legacyExportJobseekersCsv() {
  await verifyAdmin()

  const allData = []
  let page = 1
  let hasMore = true

  // 分页查询所有 jobseekers 数据
  while (hasMore) {
    const res = await db.collection('jobseekers').skip((page - 1) * 100).limit(100).get()
    allData.push(...res.data)
    hasMore = res.data.length === 100
    page++
  }

  // 构建 CSV
  const header = '姓名,手机号,身份证号,身份证地址,是否贫困,贫困说明,期望工作,期望区域,创建时间'
  const rows = allData.map(p => {
    const isPoor = p.isPoor ? '是' : '否'
    const created = p.createdAt ? new Date(p.createdAt).toLocaleDateString('zh-CN') : ''
    // CSV 转义：含逗号或引号的字段用引号包裹
    const esc = v => {
      const s = String(v || '')
      return s.includes(',') || s.includes('"') ? `"${s.replace(/"/g, '""')}"` : s
    }
    return [
      esc(p.name), esc(p.phone), esc(p.idNumber), esc(p.idCardAddress),
      isPoor, esc(p.poorDescription), esc(p.expectJob), esc(p.expectArea), esc(created)
    ].join(',')
  }).join('\n')

  const csv = '﻿' + header + '\n' + rows  // BOM for Excel to recognize UTF-8

  // 上传到云存储
  const fileName = `导出_求职者信息_${new Date().toISOString().slice(0, 10).replace(/-/g, '')}.csv`
  const cloudPath = `export/${fileName}`
  const buffer = Buffer.from(csv, 'utf8')

  const uploadRes = await cloud.uploadFile({
    cloudPath: cloudPath,
    fileContent: buffer
  })

  return success({
    fileID: uploadRes.fileID,
    fileName: fileName,
    totalCount: allData.length
  }, `成功导出 ${allData.length} 条求职者信息`)
}

/** 导出报名表 */
async function legacyExportApplicationsCsv() {
  await verifyAdmin()

  const allData = []
  let page = 1
  let hasMore = true

  while (hasMore) {
    const res = await db.collection('applications').skip((page - 1) * 100).limit(100).get()
    allData.push(...res.data)
    hasMore = res.data.length === 100
    page++
  }

  const statusMap = { submitted: '已报名', accepted: '已录取', rejected: '未通过', cancelled: '已取消', completed: '已完成' }
  const esc = v => {
    const s = String(v || '')
    return s.includes(',') || s.includes('"') ? `"${s.replace(/"/g, '""')}"` : s
  }

  const header = '岗位名称,企业名称,求职者姓名,手机号,状态,报名时间,处理时间,备注'
  const rows = allData.map(a => [
    esc(a.jobTitle), esc(a.companyName), esc(a.jobseekerName),
    esc(a.jobseekerPhone), statusMap[a.status] || a.status,
    a.applyTime ? new Date(a.applyTime).toLocaleString('zh-CN') : '',
    a.processTime ? new Date(a.processTime).toLocaleString('zh-CN') : '',
    esc(a.remarks)
  ].join(',')).join('\n')

  const csv = '﻿' + header + '\n' + rows
  const fileName = `导出_报名表_${new Date().toISOString().slice(0, 10).replace(/-/g, '')}.csv`

  const uploadRes = await cloud.uploadFile({
    cloudPath: 'export/' + fileName,
    fileContent: Buffer.from(csv, 'utf8')
  })

  return success({ fileID: uploadRes.fileID, fileName, totalCount: allData.length },
    `成功导出 ${allData.length} 条报名记录`)
}

/** 一键迁移现有数据为标准 ID 格式 */
async function migrateIds() {
  await verifyAdmin()
  const results = []

  const now = new Date().toISOString().slice(0, 10).replace(/-/g, '')
  const dateOf = (d) => d ? new Date(d).toISOString().slice(0, 10).replace(/-/g, '') : now
  const trySave = async (col, doc, newId) => {
    try {
      await db.collection(col).add({ data: { ...doc, _id: newId } })
      await db.collection(col).doc(doc._id).remove()
      return true
    } catch (e) {
      // 重复ID，加时间戳后缀
      const retryId = newId + '-' + Date.now()
      await db.collection(col).add({ data: { ...doc, _id: retryId } })
      await db.collection(col).doc(doc._id).remove()
      return true
    }
  }

  // 1. 迁移 jobs
  const jobs = await getAllDocs('jobs')
  let jc = 0
  for (const d of jobs) {
    const id = `${dateOf(d.createdAt || d.publishedAt)}-${(d.title || '岗位').trim()}-${(d.companyName || '企业').trim()}`
    if (d._id === id) continue
    if (await trySave('jobs', d, id)) jc++
  }
  results.push({ collection: 'jobs', count: jc })

  // 2. 迁移 applications
  const apps = await getAllDocs('applications')
  let ac = 0
  for (const d of apps) {
    const id = `${dateOf(d.applyTime)}-${(d.jobTitle || '岗位').trim()}-${(d.jobseekerName || '求职者').trim()}`
    if (d._id === id) continue
    if (await trySave('applications', d, id)) ac++
  }
  results.push({ collection: 'applications', count: ac })

  // 3. 迁移 accounts
  const accounts = await getAllDocs('accounts')
  let acc = 0
  for (const d of accounts) {
    const p = d.phone || d.openid || 'unknown'
    const name = (d.name || d.companyName || '').trim()
    const id = `${dateOf(d.createTime)}-${name || 'user'}-${p.slice(-8)}`
    if (d._id === id) continue
    if (await trySave('accounts', d, id)) acc++
  }
  results.push({ collection: 'accounts', count: acc })

  // 4. 迁移 jobseekers
  const seekers = await getAllDocs('jobseekers')
  let sc = 0
  for (const d of seekers) {
    const id = `${dateOf(d.createdAt)}-${(d.name || '求职者').trim()}`
    if (d._id === id) continue
    if (await trySave('jobseekers', d, id)) sc++
  }
  results.push({ collection: 'jobseekers', count: sc })

  return success(results, 'ID 迁移完成')
}

/** 获取集合全部文档（分页） */
async function getAllDocs(collectionName) {
  const all = []
  let page = 0
  const pageSize = 100
  let hasMore = true
  while (hasMore) {
    const res = await db.collection(collectionName).skip(page * pageSize).limit(pageSize).get()
    const data = res.data || []
    all.push(...data)
    hasMore = data.length === pageSize
    page++
  }
  return all
}

// Override the legacy CSV export handlers with real Excel exports.
async function exportJobseekers() {
  await verifyAdmin()

  const allData = await getAllDocs('jobseekers')
  const fileName = `导出_求职者信息_${new Date().toISOString().slice(0, 10).replace(/-/g, '')}.xlsx`
  const rows = allData.map((item) => ({
    姓名: item.name || '',
    手机号: item.phone || '',
    身份证号: item.idNumber || '',
    身份证地址: item.idCardAddress || '',
    是否贫困: item.isPoor ? '是' : '否',
    贫困说明: item.poorDescription || '',
    期望工作: item.expectJob || '',
    期望区域: item.expectArea || '',
    创建时间: formatDateValue(item.createdAt)
  }))

  const fileID = await uploadWorkbook(fileName, '求职者', rows)

  return success({
    fileID,
    fileName,
    fileType: 'xlsx',
    totalCount: allData.length
  }, `成功导出 ${allData.length} 条求职者信息`)
}

async function exportApplications() {
  await verifyAdmin()

  const allData = await getAllDocs('applications')
  const statusMap = {
    submitted: '已报名',
    accepted: '已录取',
    rejected: '未通过',
    cancelled: '已取消',
    completed: '已完成'
  }
  const fileName = `导出_报名表_${new Date().toISOString().slice(0, 10).replace(/-/g, '')}.xlsx`
  const rows = allData.map((item) => ({
    岗位名称: item.jobTitle || '',
    企业名称: item.companyName || '',
    求职者姓名: item.jobseekerName || '',
    手机号: item.jobseekerPhone || '',
    状态: statusMap[item.status] || item.status || '',
    报名时间: formatDateValue(item.applyTime, true),
    处理时间: formatDateValue(item.processTime, true),
    备注: item.remarks || ''
  }))

  const fileID = await uploadWorkbook(fileName, '报名表', rows)

  return success({
    fileID,
    fileName,
    fileType: 'xlsx',
    totalCount: allData.length
  }, `成功导出 ${allData.length} 条报名记录`)
}

function formatDateValue(value, withTime = false) {
  if (!value) {
    return ''
  }

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return ''
  }

  return withTime ? date.toLocaleString('zh-CN') : date.toLocaleDateString('zh-CN')
}

async function uploadWorkbook(fileName, sheetName, rows) {
  const worksheet = XLSX.utils.json_to_sheet(rows)
  const workbook = XLSX.utils.book_new()

  XLSX.utils.book_append_sheet(workbook, worksheet, sheetName)

  const buffer = XLSX.write(workbook, {
    type: 'buffer',
    bookType: 'xlsx'
  })

  const uploadRes = await cloud.uploadFile({
    cloudPath: `export/${fileName}`,
    fileContent: buffer
  })

  return uploadRes.fileID
}

async function exportJobseekersWorkbook() {
  await verifyAdmin()

  const allData = await getAllDocs('jobseekers')
  const fileName = `jobseekers_${new Date().toISOString().slice(0, 10).replace(/-/g, '')}.xlsx`
  const headers = ['姓名', '手机号', '身份证号', '身份证地址', '是否贫困', '贫困说明', '期望工作', '期望区域', '创建时间']
  const rows = allData.map((item) => ([
    item.name || '',
    item.phone || '',
    item.idNumber || '',
    item.idCardAddress || '',
    item.isPoor ? '是' : '否',
    item.poorDescription || '',
    item.expectJob || '',
    item.expectArea || '',
    formatExcelDate(item.createdAt)
  ]))

  const fileID = await uploadWorkbookClean(fileName, '求职者', headers, rows)

  return success({
    fileID,
    fileName,
    fileType: 'xlsx',
    totalCount: allData.length
  }, `成功导出 ${allData.length} 条求职者信息`)
}

async function exportApplicationsWorkbook() {
  await verifyAdmin()

  const allData = await getAllDocs('applications')
  const statusMap = {
    submitted: '已报名',
    accepted: '已录取',
    rejected: '未通过',
    cancelled: '已取消',
    completed: '已完成'
  }
  const fileName = `applications_${new Date().toISOString().slice(0, 10).replace(/-/g, '')}.xlsx`
  const headers = ['岗位名称', '企业名称', '求职者姓名', '手机号', '状态', '报名时间', '处理时间', '备注']
  const rows = allData.map((item) => ([
    item.jobTitle || '',
    item.companyName || '',
    item.jobseekerName || '',
    item.jobseekerPhone || '',
    statusMap[item.status] || item.status || '',
    formatExcelDate(item.applyTime, true),
    formatExcelDate(item.processTime, true),
    item.remarks || ''
  ]))

  const fileID = await uploadWorkbookClean(fileName, '报名表', headers, rows)

  return success({
    fileID,
    fileName,
    fileType: 'xlsx',
    totalCount: allData.length
  }, `成功导出 ${allData.length} 条报名记录`)
}

function formatExcelDate(value, withTime = false) {
  if (!value) {
    return ''
  }

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return ''
  }

  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')

  if (!withTime) {
    return `${year}-${month}-${day}`
  }

  const hours = String(date.getHours()).padStart(2, '0')
  const minutes = String(date.getMinutes()).padStart(2, '0')
  const seconds = String(date.getSeconds()).padStart(2, '0')
  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`
}

async function uploadWorkbookClean(fileName, sheetName, headers, rows) {
  const worksheet = XLSX.utils.aoa_to_sheet([headers, ...rows])
  const workbook = XLSX.utils.book_new()

  XLSX.utils.book_append_sheet(workbook, worksheet, sheetName)

  const buffer = XLSX.write(workbook, {
    type: 'buffer',
    bookType: 'xlsx'
  })

  const uploadRes = await cloud.uploadFile({
    cloudPath: `export_xlsx/${fileName}`,
    fileContent: buffer
  })

  return uploadRes.fileID
}
