const { call } = require('../../../utils/api')
const { CLOUD_FUNCTIONS } = require('../../../utils/constants')

Page({
  data: { result: null },

  async handleScan() {
    try {
      const res = await wx.scanCode({ onlyFromCamera: true })
      const applicationId = res.result || ''
      if (!applicationId) {
        this.setData({ result: { success: false, msg: '未识别到二维码' } })
        return
      }

      wx.showLoading({ title: '核销中...', mask: true })
      const r = await call(CLOUD_FUNCTIONS.CHECKIN, 'create', { applicationId })
      wx.hideLoading()
      this.setData({ result: { success: true, msg: r ? '签到成功' : '核销失败' } })
    } catch (err) {
      wx.hideLoading()
      this.setData({ result: { success: false, msg: err.msg || err.errMsg || '核销失败' } })
    }
  },

  handleReset() {
    this.setData({ result: null })
  }
})
