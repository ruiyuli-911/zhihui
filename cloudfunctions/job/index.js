const cloud = require('wx-server-sdk')
const { success, fail } = require('./response')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()
const _ = db.command
const FAVORITES_COLLECTION = 'favorites'

exports.main = async (event) => {
  const { action, data = {} } = event

  if (!action) {
    return fail('action is required')
  }

  try {
    switch (action) {
      case 'getJobList':
        return await getJobList(data)
      case 'getHotJobs':
        return await getHotJobs(data)
      case 'getJobDetail':
        return await getJobDetail(data)
      case 'searchJobs':
        return await searchJobs(data)
      case 'toggleFavorite':
        return await toggleFavorite(data)
      case 'getMyFavorites':
        return await getMyFavorites(data)
      case 'checkFavorited':
        return await checkFavorited(data)
      default:
        return success({ action, ready: false }, 'unknown action')
    }
  } catch (err) {
    console.error('[job]', err)
    return fail(err.message || 'job cloud function failed')
  }
}

function isCollectionNotExistsError(err) {
  const text = String(
    (err && (err.message || err.errMsg || err.msg || err.errorMessage)) || ''
  ).toLowerCase()

  return text.includes('collection.get:fail -502005') ||
    text.includes('database collection not exists') ||
    text.includes('db or table not exist') ||
    text.includes('collection not exist')
}

function buildSalaryText(job = {}) {
  if (job.salary) {
    return job.salary
  }

  if (job.salaryMin || job.salaryMax) {
    const min = job.salaryMin || job.salaryMax || ''
    const max = job.salaryMax || job.salaryMin || ''
    return `${min}-${max}元/天`
  }

  return '面议'
}

async function getJobList(data) {
  const { page = 1, pageSize = 10, categoryName, area, sortBy } = data
  const skip = (page - 1) * pageSize
  const where = { auditStatus: 'approved', recruitStatus: 'recruiting' }

  if (categoryName) where.categoryName = categoryName
  if (area) where.area = area

  const total = await db.collection('jobs').where(where).count()
  let query = db.collection('jobs').where(where)

  if (sortBy === 'applyCount') {
    query = query.orderBy('applyCount', 'desc')
  } else if (sortBy === 'newest') {
    query = query.orderBy('publishedAt', 'desc')
  } else {
    query = query.orderBy('isHot', 'desc').orderBy('applyCount', 'desc')
  }

  const jobs = await query.skip(skip).limit(pageSize).get()

  return success({
    jobs: jobs.data || [],
    total: total.total || 0,
    page,
    pageSize,
    hasMore: skip + (jobs.data || []).length < (total.total || 0)
  })
}

async function getHotJobs(data) {
  const { limit = 6 } = data
  const jobs = await db.collection('jobs')
    .where({ auditStatus: 'approved', recruitStatus: 'recruiting' })
    .orderBy('isHot', 'desc')
    .orderBy('applyCount', 'desc')
    .limit(limit)
    .get()

  return success({
    jobs: jobs.data || [],
    total: (jobs.data || []).length
  })
}

async function getJobDetail(data) {
  const { jobId } = data

  if (!jobId) {
    return fail('缺少岗位ID')
  }

  const job = await db.collection('jobs').doc(jobId).get()

  if (!job.data) {
    return fail('岗位不存在')
  }

  db.collection('jobs').doc(jobId).update({
    data: {
      viewCount: _.inc(1)
    }
  }).catch(() => {})

  return success(job.data)
}

async function searchJobs(data) {
  const { keyword, page = 1, pageSize = 10 } = data

  if (!keyword || !String(keyword).trim()) {
    return fail('请输入搜索关键词')
  }

  const skip = (page - 1) * pageSize
  const re = new RegExp(String(keyword).trim(), 'i')
  const where = {
    auditStatus: 'approved',
    recruitStatus: 'recruiting',
    $or: [
      { title: re },
      { companyName: re },
      { area: re },
      { categoryName: re },
      { description: re },
      { requirement: re }
    ]
  }

  const total = await db.collection('jobs').where(where).count()
  const jobs = await db.collection('jobs')
    .where(where)
    .orderBy('isHot', 'desc')
    .orderBy('applyCount', 'desc')
    .skip(skip)
    .limit(pageSize)
    .get()

  return success({
    jobs: jobs.data || [],
    total: total.total || 0,
    page,
    pageSize,
    hasMore: skip + (jobs.data || []).length < (total.total || 0)
  })
}

async function toggleFavorite(data) {
  const { OPENID } = cloud.getWXContext()

  if (!OPENID) {
    return fail('请先登录')
  }

  const { jobId } = data

  if (!jobId) {
    return fail('缺少岗位ID')
  }

  let existing = []

  try {
    const result = await db.collection(FAVORITES_COLLECTION)
      .where({ accountId: OPENID, jobId })
      .limit(1)
      .get()
    existing = result.data || []
  } catch (err) {
    if (!isCollectionNotExistsError(err)) {
      throw err
    }
  }

  if (existing.length > 0) {
    await db.collection(FAVORITES_COLLECTION).doc(existing[0]._id).remove()
    return success(null, '已取消收藏')
  }

  const job = await db.collection('jobs').doc(jobId).get()

  if (!job.data) {
    return fail('岗位不存在')
  }

  const dateStamp = new Date().toISOString().slice(0, 10).replace(/-/g, '')

  await db.collection(FAVORITES_COLLECTION).add({
    data: {
      _id: `${dateStamp}-${String(job.data.title || '').trim()}-${OPENID.slice(-4)}`,
      accountId: OPENID,
      jobId,
      jobTitle: job.data.title || '',
      companyName: job.data.companyName || '',
      salary: buildSalaryText(job.data),
      createdAt: db.serverDate()
    }
  })

  return success(null, '已收藏')
}

async function getMyFavorites(data) {
  const { OPENID } = cloud.getWXContext()

  if (!OPENID) {
    return fail('请先登录')
  }

  const { page = 1, pageSize = 20 } = data

  try {
    const total = await db.collection(FAVORITES_COLLECTION)
      .where({ accountId: OPENID })
      .count()

    const list = await db.collection(FAVORITES_COLLECTION)
      .where({ accountId: OPENID })
      .orderBy('createdAt', 'desc')
      .skip((page - 1) * pageSize)
      .limit(pageSize)
      .get()

    return success({
      list: list.data || [],
      total: total.total || 0,
      page,
      pageSize
    })
  } catch (err) {
    if (isCollectionNotExistsError(err)) {
      return success({
        list: [],
        total: 0,
        page,
        pageSize
      })
    }

    throw err
  }
}

async function checkFavorited(data) {
  const { OPENID } = cloud.getWXContext()

  if (!OPENID) {
    return success({ favorited: false })
  }

  const { jobId } = data

  if (!jobId) {
    return success({ favorited: false })
  }

  try {
    const result = await db.collection(FAVORITES_COLLECTION)
      .where({ accountId: OPENID, jobId })
      .limit(1)
      .get()

    return success({
      favorited: !!(result.data && result.data.length > 0)
    })
  } catch (err) {
    if (isCollectionNotExistsError(err)) {
      return success({ favorited: false })
    }

    throw err
  }
}
