const { call } = require('../../../utils/api')
const { CLOUD_FUNCTIONS } = require('../../../utils/constants')
const { requireLogin } = require('../../../utils/auth')

Page({
  data: { list: [] },

  onLoad() {
    if (!requireLogin({ message: '请先登录' })) return
    this.loadData()
  },

  onShow() { this.loadData() },

  async loadData() {
    try {
      const res = await call(CLOUD_FUNCTIONS.CHECKIN, 'listMine', { page: 1, pageSize: 50 })
      this.setData({ list: (res && res.list) || [] })
    } catch (err) {
      console.error('[checkins] load error', err)
    }
  },

  formatTime(t) {
    if (!t) return ''
    const d = new Date(t)
    return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`
  }
})
