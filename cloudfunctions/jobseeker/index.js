const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()

function success(data = null, msg = 'success') {
  return {
    code: 0,
    msg,
    data
  }
}

function fail(msg = 'fail', code = -1, data = null) {
  return {
    code,
    msg,
    data
  }
}

exports.main = async (event) => {
  const { action } = event || {}

  if (!action) {
    return fail('action is required')
  }

  try {
    switch (action) {
      case 'getHome':
        return success(await getHomeData(), 'jobseeker home data loaded')
      case 'getProfile':
        return success(await getJobseekerProfile())
      case 'updateProfile':
        return await updateJobseekerProfile(event.data)
      default:
        return success(
          {
            action,
            ready: false
          },
          'jobseeker cloud function scaffold is ready'
        )
    }
  } catch (err) {
    console.error('[jobseeker]', err)
    return fail(err.message || 'jobseeker cloud function failed')
  }
}

async function getHomeData() {
  const { OPENID } = cloud.getWXContext()

  try {
    const account = await getAccountByOpenid(OPENID)
    const jobseeker = account ? await getJobseekerByAccountId(account._id) : null
    const jobseekerId = jobseeker ? jobseeker._id : ''

    const [applications, wages, checkins, jobs, policies] = await Promise.all([
      safeGetCollection('applications', 50, jobseekerId ? { jobseekerId } : null),
      safeGetCollection('wage_statements', 50, jobseekerId ? { jobseekerId } : null),
      safeGetCollection('checkins', 50, jobseekerId ? { jobseekerId } : null),
      getRecommendJobs(),
      safeGetCollection('policies', 3)
    ])

    const profile = buildProfile(jobseeker)
    const summary = buildSummary(applications, wages, checkins)

    return {
      profile,
      voiceHints: ['找工作', '看报名', '查工资', '签到'],
      quickActions: buildQuickActions(summary),
      statusCards: buildStatusCards(summary),
      recommendJobs: buildRecommendJobs(jobs),
      categories: buildCategories(),
      notices: buildNotices(policies)
    }
  } catch (err) {
    console.error('[jobseeker] getHomeData error', err)
    return {
      profile: { name: '', completionText: '', expectJob: '', expectArea: '' },
      voiceHints: [],
      quickActions: [],
      statusCards: [],
      recommendJobs: [],
      categories: [],
      notices: []
    }
  }
}

async function getAccountByOpenid(openid) {
  if (!openid) {
    return null
  }

  try {
    const res = await db.collection('accounts').where({ openid }).limit(1).get()
    return (res.data && res.data[0]) || null
  } catch (err) {
    return null
  }
}

async function getJobseekerByAccountId(accountId) {
  if (!accountId) {
    return null
  }

  try {
    const res = await db.collection('jobseekers').where({ accountId }).limit(1).get()
    return (res.data && res.data[0]) || null
  } catch (err) {
    return null
  }
}

async function safeGetCollection(name, limit, where = null) {
  try {
    let query = db.collection(name)
    if (where) {
      query = query.where(where)
    }
    const res = await query.limit(limit).get()
    return res.data || []
  } catch (err) {
    return []
  }
}

/** 获取推荐岗位（已审核通过，按热门排序） */
async function getRecommendJobs() {
  try {
    const res = await db.collection('jobs')
      .where({
        auditStatus: 'approved',
        recruitStatus: 'recruiting'
      })
      .orderBy('isHot', 'desc')
      .orderBy('applyCount', 'desc')
      .limit(6)
      .get()
    return res.data || []
  } catch (err) {
    return []
  }
}

/** 获取求职者完整档案 */
async function getJobseekerProfile() {
  const { OPENID } = cloud.getWXContext()
  if (!OPENID) return null

  const account = await getAccountByOpenid(OPENID)
  if (!account) return null

  const jobseeker = await getJobseekerByAccountId(account._id)
  return jobseeker || { accountId: account._id, name: account.name || '', phone: account.phone || '' }
}

/** 更新求职者档案 */
async function updateJobseekerProfile(data = {}) {
  const { OPENID } = cloud.getWXContext()
  if (!OPENID) return fail('无法获取用户身份')

  const account = await getAccountByOpenid(OPENID)
  if (!account) return fail('请先登录')

  const {
    name, phone, gender, birthYear, relation, skills,
    expectJob, expectArea, idNumber, idCardAddress,
    idCardFront, idCardBack, isPoor, poorDescription, profileCompleted
  } = data || {}

  const now = db.serverDate()
  const existing = await getJobseekerByAccountId(account._id)

  const profileData = {
    accountId: account._id,
    name: name || account.name || '',
    phone: phone || account.phone || '',
    gender: gender || '',
    birthYear: birthYear || '',
    relation: relation || '本人',
    skills: Array.isArray(skills) ? skills : [],
    expectJob: expectJob || '',
    expectArea: expectArea || '',
    idNumber: idNumber || '',
    idCardAddress: idCardAddress || '',
    idCardFront: idCardFront || '',
    idCardBack: idCardBack || '',
    isPoor: !!isPoor,
    poorDescription: poorDescription || '',
    profileCompleted: !!profileCompleted,
    updatedAt: now
  }

  await db.collection('accounts').doc(account._id).update({
    data: {
      name: profileData.name,
      phone: profileData.phone,
      updateTime: now
    }
  }).catch((err) => {
    console.warn('[jobseeker] sync account profile failed', err)
  })

  if (existing) {
    await db.collection('jobseekers').doc(existing._id).update({ data: profileData })
    const updated = await db.collection('jobseekers').doc(existing._id).get()
    return success(updated.data)
  } else {
    profileData.createdAt = now
    // Use the account id as the jobseeker profile id so repeated saves never collide by name/date.
    profileData._id = account._id
    const result = await db.collection('jobseekers').add({ data: profileData })
    const created = await db.collection('jobseekers').doc(result._id).get()
    return success(created.data)
  }
}

function buildProfile(profile) {
  if (!profile) return null

  const completionRate = calcCompletionRate(profile)

  return {
    name: profile.name || '',
    expectJob: profile.expectJob || '',
    expectArea: profile.expectArea || '',
    completionRate,
    completionText:
      completionRate >= 80
        ? '资料较完整，正在优先为您推荐合适岗位'
        : '请完善资料，方便我们更准确地推荐工作'
  }
}

function calcCompletionRate(profile) {
  const fields = ['name', 'gender', 'birthYear', 'skills', 'expectJob', 'expectArea']
  let filled = 0

  fields.forEach((key) => {
    const value = profile[key]
    if (Array.isArray(value)) {
      if (value.length) {
        filled += 1
      }
      return
    }

    if (value !== undefined && value !== null && value !== '') {
      filled += 1
    }
  })

  return Math.max(20, Math.round((filled / fields.length) * 100))
}

function buildSummary(applications, wages, checkins) {
  const appliedCount = countByStatus(applications, ['submitted', 'accepted', 'completed'])
  const pendingWageConfirmCount = countByConfirmStatus(wages, ['pending'])
  const disputeCount = countByConfirmStatus(wages, ['disputed'])
  const pendingCheckinCount = countPendingCheckins(applications, checkins)

  return {
    appliedCount,
    acceptedCount: countByStatus(applications, ['accepted']),
    pendingCheckinCount,
    pendingWageConfirmCount,
    disputeCount
  }
}

function countByStatus(items, statuses) {
  return (items || []).filter((item) => statuses.includes(item.status)).length
}

function countByConfirmStatus(items, statuses) {
  return (items || []).filter((item) => statuses.includes(item.confirmStatus)).length
}

function countPendingCheckins(applications, checkins) {
  const checkedInApplicationIds = new Set(
    (checkins || []).map((item) => item.applicationId).filter(Boolean)
  )

  return (applications || []).filter((item) => {
    if (item.status !== 'accepted') {
      return false
    }

    if (item.checkinStatus) {
      return item.checkinStatus === 'pending'
    }

    return !checkedInApplicationIds.has(item._id)
  }).length
}

function buildQuickActions(summary) {
  return [
    { key: 'qrcode', text: '签到码', icon: '码', url: '/pages/c/my-qrcode/my-qrcode' },
    { key: 'wages', text: '查工资', icon: '薪', url: '/pages/c/wages/wages' },
    { key: 'policies', text: '查政策', icon: '政', url: '/pages/c/policies/policies' },
    { key: 'favorites', text: '我的收藏', icon: '藏', url: '/pages/c/favorites/favorites' }
  ]
}

function buildStatusCards(summary) {
  return [
    {
      key: 'applications',
      title: '已报名岗位',
      desc: '看看企业有没有联系您',
      value: `${summary.appliedCount || 0}个`,
      url: '/pages/c/my-applications/my-applications'
    },
    {
      key: 'checkin',
      title: '待签到',
      desc: '录取后到岗请出示签到码',
      value: `${summary.pendingCheckinCount || 0}次`,
      url: '/pages/c/my-qrcode/my-qrcode'
    },
    {
      key: 'wage',
      title: '待确认工资',
      desc: '收到工资后请及时确认',
      value: `${summary.pendingWageConfirmCount || 0}笔`,
      url: '/pages/c/wages/wages'
    },
    {
      key: 'dispute',
      title: '工资争议',
      desc: '有异议可在工资页面查看进度',
      value: `${summary.disputeCount || 0}笔`,
      url: '/pages/c/dispute/dispute'
    }
  ]
}

function buildRecommendJobs(items) {
  return (items || []).slice(0, 4).map((item, index) => ({
    id: item._id || item.id || `job-${index + 1}`,
    title: item.title || '工地普工',
    salary: formatSalary(item),
    companyName: item.companyName || '推荐企业',
    area: item.area || item.address || '就近安排',
    workHours: item.workHours || '8小时左右',
    tags: normalizeTags(item),
    isHot: !!item.isHot,
    applyCount: item.applyCount || 0
  }))
}

function formatSalary(item) {
  if (item.salary) {
    return item.salary
  }

  if (item.salaryMin || item.salaryMax) {
    const min = item.salaryMin || item.salaryMax
    const max = item.salaryMax || item.salaryMin
    return `${min}-${max}元`
  }

  return '面议'
}

function normalizeTags(item) {
  const tags = []
  if (item.categoryName) tags.push(item.categoryName)
  if (item.foodCondition) tags.push(item.foodCondition)
  if (item.requirement) tags.push('可咨询')
  return tags.length ? tags.slice(0, 3) : ['包吃住', '就近安排']
}

function buildNotices(items) {
  return (items || []).slice(0, 3).map((item, index) => ({
    id: item._id || item.id || `notice-${index + 1}`,
    title: item.title || '平台提醒',
    desc: item.content || item.desc || '找工作时请认准平台审核通过的岗位信息'
  }))
}

function buildCategories() {
  return [
    { name: '采摘工' }, { name: '家政' }, { name: '工厂流水线' },
    { name: '物品配送员' }, { name: '汽配工' }, { name: '草编工' },
    { name: '餐馆服务' }, { name: '康养' }, { name: '建筑工' }
  ]
}
