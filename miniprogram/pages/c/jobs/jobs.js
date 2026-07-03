const { createPage } = require('../../../utils/page-factory')
const { call } = require('../../../utils/api')
const { CLOUD_FUNCTIONS, DEFAULT_CATEGORIES } = require('../../../utils/constants')

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
    jobs: [],
    total: 0,
    hasMore: false,
    page: 1,
    pageSize: 10,
    currentCategory: '',
    sortBy: 'default',
    categories: DEFAULT_CATEGORIES
  },

  onLoad() {
    this.loadJobs()
  },

  async loadJobs(reset = false) {
    const { page, pageSize, currentCategory, sortBy, jobs } = this.data
    const currentPage = reset ? 1 : page

    if (reset) {
      this.setData({ page: 1 })
    }

    wx.showLoading({ title: '加载中...', mask: true })

    try {
      const result = await call(CLOUD_FUNCTIONS.JOB, 'getJobList', {
        page: currentPage,
        pageSize,
        categoryName: currentCategory || undefined,
        sortBy: sortBy === 'default' ? undefined : sortBy
      })

      if (!result) {
        return
      }

      const nextJobs = (result.jobs || []).map(normalizeJob)

      this.setData({
        jobs: reset ? nextJobs : [...jobs, ...nextJobs],
        total: result.total || 0,
        hasMore: !!result.hasMore,
        page: currentPage + 1
      })
    } catch (err) {
      console.error('[c-jobs] load error', err)
    } finally {
      wx.hideLoading()
    }
  },

  handleCategoryTap(event) {
    const category = event.currentTarget.dataset.category || ''
    this.setData({ currentCategory: category })
    this.loadJobs(true)
  },

  handleSortTap(event) {
    const sortBy = event.currentTarget.dataset.sort || 'default'
    this.setData({ sortBy })
    this.loadJobs(true)
  },

  handleLoadMore() {
    if (!this.data.hasMore) {
      return
    }

    this.loadJobs()
  },

  handleJobTap(event) {
    const jobId = event.currentTarget.dataset.id
    if (!jobId) {
      return
    }

    wx.navigateTo({ url: `/pages/c/job-detail/job-detail?jobId=${jobId}` })
  },

  handleSearchTap() {
    wx.showToast({
      title: '请先使用分类和排序筛选岗位',
      icon: 'none'
    })
  }
}))
