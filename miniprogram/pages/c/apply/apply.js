const { call } = require('../../../utils/api')
const { CLOUD_FUNCTIONS } = require('../../../utils/constants')
const { requireLogin } = require('../../../utils/auth')

Page({
  data: {
    job: null,
    jobId: '',
    userName: '',
    userPhone: '',
    submitting: false
  },

  onLoad(options) {
    if (!requireLogin({ message: '请先登录后再报名' })) return

    if (options.jobId) {
      this.setData({ jobId: options.jobId })
      this.loadJob(options.jobId)
    }
    this.loadMyInfo()
  },

  async loadJob(jobId) {
    try {
      const res = await call(CLOUD_FUNCTIONS.JOB, 'getJobDetail', { jobId })
      if (res) this.setData({ job: res })
    } catch (err) {
      console.error('[apply] load job error', err)
    }
  },

  loadMyInfo() {
    const account = getApp().globalData.accountInfo || {}
    this.setData({ userName: account.name || '', userPhone: account.phone || '' })
    this.loadProfile()
  },

  async loadProfile() {
    try {
      const res = await call(CLOUD_FUNCTIONS.JOBSEEKER, 'getProfile')
      if (res) {
        this.setData({
          userName: res.name || this.data.userName,
          userPhone: res.phone || this.data.userPhone
        })
      }
    } catch (err) {
      console.error('[apply] load profile error', err)
    }
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

  async handleSubmit() {
    if (this.data.submitting) return
    if (!this.data.jobId) {
      wx.showToast({ title: '岗位信息异常，请返回重试', icon: 'none' })
      return
    }

    this.setData({ submitting: true })

    try {
      const res = await call(CLOUD_FUNCTIONS.APPLY, 'create', { jobId: this.data.jobId })
      if (res && res.applicationId) {
        wx.showToast({ title: '报名成功' })
        setTimeout(() => {
          wx.switchTab({ url: '/pages/c/my-applications/my-applications' })
        }, 1000)
      }
    } catch (err) {
      console.error('[apply] submit error', err)
      if (!err || !err.msg) {
        wx.showToast({ title: '报名失败，请稍后重试', icon: 'none' })
      }
    } finally {
      this.setData({ submitting: false })
    }
  }
})
