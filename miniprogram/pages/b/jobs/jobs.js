const { createPage } = require('../../../utils/page-factory')
const { call } = require('../../../utils/api')
const { CLOUD_FUNCTIONS } = require('../../../utils/constants')
const { requireCompanyAccess } = require('../../../utils/auth')

Page(createPage({
  data: {
    jobs: [],
    total: 0,
    auditStatusText: {
      draft: '草稿',
      pending: '待审核',
      approved: '已通过',
      rejected: '已驳回',
      revoked: '已撤回'
    }
  },

  onShow() {
    if (!requireCompanyAccess({ message: '请先登录企业账号' })) {
      return
    }
    this.loadMyJobs()
  },

  async loadMyJobs() {
    try {
      const res = await call(CLOUD_FUNCTIONS.COMPANY, 'getMyJobs', { page: 1, pageSize: 50 })
      if (res) {
        this.setData({
          jobs: res.jobs || [],
          total: res.total || 0
        })
      }
    } catch (err) {
      console.error('[b-jobs] load error', err)
      wx.showToast({
        title: (err && err.msg) || '加载岗位失败',
        icon: 'none'
      })
    }
  },

  handlePublish() {
    wx.navigateTo({ url: '/pages/b/job-publish/job-publish' })
  },

  handleEdit(e) {
    const jobId = e.currentTarget.dataset.id
    wx.navigateTo({ url: `/pages/b/job-publish/job-publish?jobId=${jobId}` })
  },

  handleDelete(e) {
    const jobId = e.currentTarget.dataset.id
    wx.showModal({
      title: '确认删除',
      content: '删除后无法恢复，确定要删除该岗位吗？',
      success: async (res) => {
        if (!res.confirm) {
          return
        }

        try {
          await call(CLOUD_FUNCTIONS.COMPANY, 'deleteJob', { jobId })
          wx.showToast({ title: '已删除' })
          this.loadMyJobs()
        } catch (err) {
          wx.showToast({
            title: (err && err.msg) || '删除失败',
            icon: 'none'
          })
        }
      }
    })
  },

  formatSalary(job) {
    if (job.salary) return job.salary
    if (job.salaryMin || job.salaryMax) {
      const min = job.salaryMin || job.salaryMax
      const max = job.salaryMax || job.salaryMin
      return `${min}-${max}元/天`
    }
    return '面议'
  },

  getAuditReasonLabel(auditStatus) {
    if (auditStatus === 'revoked') {
      return '撤回原因：'
    }
    if (auditStatus === 'rejected') {
      return '驳回原因：'
    }
    return ''
  }
}))
