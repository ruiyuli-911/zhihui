const { createPage } = require('../../../utils/page-factory')
const { call } = require('../../../utils/api')
const { CLOUD_FUNCTIONS } = require('../../../utils/constants')
const { requireLogin, isLoggedIn } = require('../../../utils/auth')

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

function normalizeJob(job = {}) {
  return {
    ...job,
    displaySalary: buildSalaryText(job)
  }
}

Page(createPage({
  data: {
    job: null,
    jobId: null,
    isFavorited: false,
    favoritedLoading: false
  },

  onLoad(options) {
    const jobId = options.jobId || options.id

    if (!jobId) {
      wx.showToast({ title: '缺少岗位信息', icon: 'none' })
      return
    }

    this.setData({ jobId })
    this.loadJobDetail(jobId)
    this.checkFavorited(jobId)
  },

  async loadJobDetail(jobId) {
    try {
      const result = await call(CLOUD_FUNCTIONS.JOB, 'getJobDetail', { jobId })
      if (result) {
        this.setData({ job: normalizeJob(result) })
      }
    } catch (err) {
      console.error('[job-detail] load error', err)
      wx.showToast({ title: '加载失败', icon: 'none' })
    }
  },

  async checkFavorited(jobId) {
    if (!isLoggedIn()) {
      this.setData({ isFavorited: false })
      return
    }

    try {
      const result = await call(CLOUD_FUNCTIONS.JOB, 'checkFavorited', { jobId })
      this.setData({ isFavorited: !!(result && result.favorited) })
    } catch (err) {
      console.error('[job-detail] check favorite error', err)
    }
  },

  async handleToggleFavorite() {
    if (this.data.favoritedLoading) {
      return
    }

    if (!requireLogin({ message: '请先登录后再收藏' })) {
      return
    }

    this.setData({ favoritedLoading: true })

    try {
      await call(CLOUD_FUNCTIONS.JOB, 'toggleFavorite', { jobId: this.data.jobId })
      const nextFavorited = !this.data.isFavorited

      this.setData({ isFavorited: nextFavorited })
      wx.showToast({
        title: nextFavorited ? '已收藏' : '已取消收藏',
        icon: 'none'
      })
    } catch (err) {
      wx.showToast({ title: (err && err.msg) || '操作失败', icon: 'none' })
    } finally {
      this.setData({ favoritedLoading: false })
    }
  },

  handleApply() {
    const { job } = this.data

    if (!job) {
      return
    }

    const applyUrl = `/pages/c/apply/apply?jobId=${job._id}&title=${encodeURIComponent(job.title || '')}&companyName=${encodeURIComponent(job.companyName || '')}`

    if (!requireLogin({
      message: '请先登录后再报名',
      redirectUrl: applyUrl
    })) {
      return
    }

    wx.navigateTo({ url: applyUrl })
  }
}))
