const { createPage } = require('../../../utils/page-factory')
const { requireCompanyAccess } = require('../../../utils/auth')

Page(createPage({
  data: {},

  onShow() {
    requireCompanyAccess({ message: '请先登录企业账号' })
  },

  handleToJobs() {
    wx.navigateTo({ url: '/pages/b/jobs/jobs' })
  },

  handlePublish() {
    wx.navigateTo({ url: '/pages/b/job-publish/job-publish' })
  },

  handleToApplicants() {
    wx.navigateTo({ url: '/pages/b/applicants/applicants' })
  },

  handleScan() {
    wx.navigateTo({ url: '/pages/b/scan/scan' })
  },

  handleAttendance() {
    wx.navigateTo({ url: '/pages/b/attendance/attendance' })
  },

  handleBackToC() {
    wx.navigateBack()
  }
}))
