const { createPage } = require('../../../utils/page-factory')
const { call } = require('../../../utils/api')
const { CLOUD_FUNCTIONS } = require('../../../utils/constants')

const TAB_LIST = [
  { key: 'pending', label: '待审核' },
  { key: 'approved', label: '已通过' },
  { key: 'rejected', label: '已驳回' },
  { key: 'revoked', label: '已撤回' }
]

const EMPTY_TEXT = {
  pending: '当前没有待审核岗位',
  approved: '当前没有已通过岗位',
  rejected: '当前没有已驳回岗位',
  revoked: '当前没有已撤回岗位'
}

Page(createPage({
  data: {
    currentTab: 'pending',
    tabList: TAB_LIST.map((item) => ({ ...item, count: 0 })),
    jobs: [],
    emptyText: EMPTY_TEXT.pending,
    auditStatusText: {
      draft: '草稿',
      pending: '待审核',
      approved: '已通过',
      rejected: '已驳回',
      revoked: '已撤回'
    }
  },

  onShow() {
    this.loadPageData()
  },

  async loadPageData(tabKey) {
    const currentTab = tabKey || this.data.currentTab

    try {
      const [statsRes, jobsRes] = await Promise.all([
        call(CLOUD_FUNCTIONS.ADMIN, 'getJobAuditStats'),
        call(CLOUD_FUNCTIONS.ADMIN, 'getAllJobs', {
          auditStatus: currentTab,
          page: 1,
          pageSize: 50
        })
      ])

      this.setData({
        tabList: this.buildTabList(statsRes || {}),
        jobs: this.decorateJobs((jobsRes && jobsRes.jobs) || []),
        emptyText: EMPTY_TEXT[currentTab] || '暂无数据'
      })
    } catch (err) {
      console.error('[admin-job-audit] load error', err)
      wx.showToast({ title: err.msg || '加载失败', icon: 'none' })
    }
  },

  buildTabList(stats) {
    return TAB_LIST.map((item) => ({
      ...item,
      count: stats[item.key] || 0
    }))
  },

  decorateJobs(jobs) {
    return (jobs || []).map((job) => ({
      ...job,
      certImages: Array.isArray(job.certImages) ? job.certImages : [],
      displayCompany: job.companyName || '未填写企业',
      displayArea: job.area || '未填写地区',
      displayWorkHours: job.workHours || '工时未填写',
      displaySalary: this.formatSalary(job),
      displayTime: this.formatTime(job.updatedAt || job.createdAt),
      displayStatus: this.data.auditStatusText[job.auditStatus] || job.auditStatus,
      displayReasonLabel: this.getAuditReasonLabel(job.auditStatus)
    }))
  },

  handleTabTap(e) {
    const tab = e.currentTarget.dataset.tab
    if (!tab || tab === this.data.currentTab) {
      return
    }

    this.setData({ currentTab: tab }, () => {
      this.loadPageData(tab)
    })
  },

  async handleApprove(e) {
    const jobId = e.currentTarget.dataset.id

    try {
      await call(CLOUD_FUNCTIONS.ADMIN, 'approveJob', { jobId })
      wx.showToast({ title: '已审核通过' })
      this.loadPageData()
    } catch (err) {
      wx.showToast({ title: err.msg || '操作失败', icon: 'none' })
    }
  },

  handleReject(e) {
    const jobId = e.currentTarget.dataset.id

    wx.showModal({
      title: '驳回岗位',
      editable: true,
      placeholderText: '请填写驳回原因',
      success: async (res) => {
        if (!res.confirm) {
          return
        }

        const reason = res.content || '不符合平台发布规范'

        try {
          await call(CLOUD_FUNCTIONS.ADMIN, 'rejectJob', { jobId, reason })
          wx.showToast({ title: '已驳回' })
          this.loadPageData()
        } catch (err) {
          wx.showToast({ title: err.msg || '操作失败', icon: 'none' })
        }
      }
    })
  },

  handleRevoke(e) {
    const jobId = e.currentTarget.dataset.id
    const title = e.currentTarget.dataset.title

    wx.showModal({
      title: '撤回发布',
      content: `确定要撤回“${title}”吗？撤回后该岗位会从前端隐藏，企业修改后可重新提交。`,
      editable: true,
      placeholderText: '请填写撤回原因（选填）',
      success: async (res) => {
        if (!res.confirm) {
          return
        }

        const reason = res.content || '管理员撤回发布'

        try {
          await call(CLOUD_FUNCTIONS.ADMIN, 'revokeJob', { jobId, reason })
          wx.showToast({ title: '已撤回' })
          this.loadPageData()
        } catch (err) {
          wx.showToast({ title: err.msg || '操作失败', icon: 'none' })
        }
      }
    })
  },

  handleDelete(e) {
    const jobId = e.currentTarget.dataset.id
    const title = e.currentTarget.dataset.title

    wx.showModal({
      title: '删除岗位',
      content: `确定永久删除“${title}”吗？删除后不可恢复。`,
      success: async (res) => {
        if (!res.confirm) {
          return
        }

        try {
          await call(CLOUD_FUNCTIONS.ADMIN, 'deleteJob', { jobId })
          wx.showToast({ title: '已删除' })
          this.loadPageData()
        } catch (err) {
          wx.showToast({ title: err.msg || '删除失败', icon: 'none' })
        }
      }
    })
  },

  handlePreviewCert(e) {
    const url = e.currentTarget.dataset.url
    const job = this.data.jobs.find((item) => item.certImages && item.certImages.includes(url))

    wx.previewImage({
      current: url,
      urls: (job && job.certImages) || [url]
    })
  },

  async handleHotToggle(e) {
    const jobId = e.currentTarget.dataset.id
    const isHot = !!e.detail.value

    try {
      await call(CLOUD_FUNCTIONS.ADMIN, 'toggleHot', { jobId, isHot })
      wx.showToast({ title: isHot ? '已标记热门' : '已取消热门' })
      this.loadPageData()
    } catch (err) {
      wx.showToast({ title: err.msg || '操作失败', icon: 'none' })
    }
  },

  formatSalary(job) {
    if (job.salary) {
      return job.salary
    }

    if (job.salaryMin || job.salaryMax) {
      const min = job.salaryMin || job.salaryMax
      const max = job.salaryMax || job.salaryMin
      return `${min}-${max}元/天`
    }

    return '面议'
  },

  formatTime(date) {
    if (!date) {
      return '时间未记录'
    }

    const d = new Date(date)
    if (Number.isNaN(d.getTime())) {
      return '时间未记录'
    }

    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  },

  getAuditReasonLabel(auditStatus) {
    if (auditStatus === 'revoked') {
      return '撤回原因'
    }

    if (auditStatus === 'rejected') {
      return '驳回原因'
    }

    return ''
  }
}))
