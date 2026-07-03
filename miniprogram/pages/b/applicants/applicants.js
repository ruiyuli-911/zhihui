const { call } = require('../../../utils/api')
const { CLOUD_FUNCTIONS } = require('../../../utils/constants')
const { requireCompanyAccess } = require('../../../utils/auth')

Page({
  data: {
    list: [],
    jobOptions: ['全部岗位'],
    jobIds: [''],
    selectedJobIndex: 0,
    selectedJobName: '全部岗位',
    initialized: false,
    statusText: {
      submitted: '已报名',
      accepted: '已录取',
      rejected: '未通过',
      cancelled: '已取消',
      completed: '已完成'
    }
  },

  onShow() {
    if (!requireCompanyAccess({ message: '请先登录企业账号' })) {
      return
    }

    if (!this.data.initialized) {
      this.setData({ initialized: true })
      this.loadMyJobs()
    }

    this.loadList()
  },

  async loadMyJobs() {
    try {
      const res = await call(CLOUD_FUNCTIONS.COMPANY, 'getMyJobs', { page: 1, pageSize: 50 })
      if (res && res.jobs) {
        const names = ['全部岗位']
        const ids = ['']

        res.jobs.forEach((job) => {
          names.push(job.title)
          ids.push(job._id)
        })

        this.setData({
          jobOptions: names,
          jobIds: ids
        })
      }
    } catch (err) {
      console.error('[applicants] load jobs error', err)
      wx.showToast({
        title: (err && err.msg) || '加载岗位失败',
        icon: 'none'
      })
    }
  },

  onJobChange(e) {
    const index = Number(e.detail.value || 0)
    this.setData({
      selectedJobIndex: index,
      selectedJobName: this.data.jobOptions[index] || '全部岗位'
    })
    this.loadList()
  },

  async loadList() {
    try {
      const jobId = this.data.jobIds[this.data.selectedJobIndex]
      const res = await call(CLOUD_FUNCTIONS.APPLY, 'listByCompany', {
        jobId: jobId || undefined
      })

      if (res) {
        this.setData({ list: res.list || [] })
      }
    } catch (err) {
      console.error('[applicants] load error', err)
      wx.showToast({
        title: (err && err.msg) || '加载报名失败',
        icon: 'none'
      })
    }
  },

  async handleAccept(e) {
    const id = e.currentTarget.dataset.id
    try {
      await call(CLOUD_FUNCTIONS.APPLY, 'accept', { applicationId: id })
      wx.showToast({ title: '已录取' })
      this.loadList()
    } catch (err) {
      wx.showToast({
        title: (err && err.msg) || '操作失败',
        icon: 'none'
      })
    }
  },

  handleReject(e) {
    const id = e.currentTarget.dataset.id
    wx.showModal({
      title: '拒绝报名',
      editable: true,
      placeholderText: '填写拒绝原因（选填）',
      success: async (res) => {
        if (!res.confirm) {
          return
        }

        try {
          await call(CLOUD_FUNCTIONS.APPLY, 'reject', {
            applicationId: id,
            remarks: res.content || ''
          })
          wx.showToast({ title: '已拒绝' })
          this.loadList()
        } catch (err) {
          wx.showToast({
            title: (err && err.msg) || '操作失败',
            icon: 'none'
          })
        }
      }
    })
  },

  formatTime(date) {
    if (!date) return ''
    const d = new Date(date)
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  }
})
