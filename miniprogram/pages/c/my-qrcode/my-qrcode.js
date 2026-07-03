const { call } = require('../../../utils/api')
const { CLOUD_FUNCTIONS } = require('../../../utils/constants')
const { requireLogin } = require('../../../utils/auth')

Page({
  data: { list: [] },

  onLoad() {
    if (!requireLogin({ message: '请先登录后查看签到码' })) return
    this.loadData()
  },

  onShow() { this.loadData() },

  async loadData() {
    try {
      const res = await call(CLOUD_FUNCTIONS.CHECKIN, 'getMyQRData')
      if (!res || !res.length) { this.setData({ list: [] }); return }

      const list = []
      for (const item of res) {
        if (item.checkedIn) {
          list.push({ ...item, qrFileID: '' })
          continue
        }
        // 生成二维码
        try {
          const qr = await call(CLOUD_FUNCTIONS.CHECKIN, 'generateQR', { text: item.applicationId })
          list.push({ ...item, qrFileID: (qr && qr.fileID) || '' })
        } catch {
          list.push({ ...item, qrFileID: '' })
        }
      }
      this.setData({ list })
    } catch (err) {
      console.error('[my-qrcode] load error', err)
    }
  }
})
