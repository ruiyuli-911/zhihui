const { createPage } = require('../../../utils/page-factory')
const { call } = require('../../../utils/api')
const { CLOUD_FUNCTIONS } = require('../../../utils/constants')

Page(createPage({
  data: {
    stats: {}
  },

  onShow() {
    this.loadStats()
  },

  async loadStats() {
    try {
      const result = await call(CLOUD_FUNCTIONS.STATS, 'getDashboard')
      if (result) {
        this.setData({ stats: result })
      }
    } catch (err) {
      console.error('[admin] stats error', err)
    }
  },

  handleJobAudit() {
    wx.navigateTo({ url: '/pages/admin/job-audit/job-audit' })
  },

  handleUsers() {
    wx.navigateTo({ url: '/pages/admin/users/users' })
  },

  async handleExport() {
    await this.downloadExport(CLOUD_FUNCTIONS.ADMIN, 'exportJobseekers', '求职者信息')
  },

  async handleExportApply() {
    await this.downloadExport(CLOUD_FUNCTIONS.ADMIN, 'exportApplications', '报名记录')
  },

  async downloadExport(cloudFunc, action, label) {
    try {
      const result = await call(cloudFunc, action)
      if (!result || !result.fileID) {
        wx.showToast({ title: '导出失败', icon: 'none' })
        return
      }

      wx.showModal({
        title: '导出成功',
        content: `共 ${result.totalCount || 0} 条${label}\n文件：${result.fileName}\n是否立即下载并打开？`,
        success: (modalRes) => {
          if (!modalRes.confirm) {
            return
          }

          this.downloadAndOpenFile(result)
        }
      })
    } catch (err) {
      wx.hideLoading()
      wx.showToast({ title: (err && err.msg) || '导出失败', icon: 'none' })
    }
  },

  downloadAndOpenFile(fileInfo) {
    wx.showLoading({ title: '下载中...' })

    wx.cloud.downloadFile({
      fileID: fileInfo.fileID,
      success: (downloadRes) => {
        wx.openDocument({
          filePath: downloadRes.tempFilePath,
          fileType: fileInfo.fileType || 'xlsx',
          showMenu: true,
          success: () => {
            wx.hideLoading()
          },
          fail: (openErr) => {
            wx.hideLoading()
            console.error('[admin] open document fail', openErr)
            wx.showModal({
              title: '打开失败',
              content: '文件已下载成功，但当前环境无法直接预览。请在右上角菜单或下载列表中用 Excel 打开。',
              showCancel: false
            })
          }
        })
      },
      fail: (downloadErr) => {
        wx.hideLoading()
        console.error('[admin] download export fail', downloadErr)
        wx.showToast({ title: '下载失败', icon: 'none' })
      }
    })
  },

  handleBack() {
    wx.navigateBack()
  }
}))
