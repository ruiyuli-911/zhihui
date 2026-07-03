const { call } = require('../../../utils/api')
const { CLOUD_FUNCTIONS } = require('../../../utils/constants')

Page({
  data: { list: [] },

  onShow() { this.loadData() },

  async loadData() {
    try {
      const res = await call(CLOUD_FUNCTIONS.CHECKIN, 'listByCompany', { page: 1, pageSize: 50 })
      this.setData({ list: (res && res.list) || [] })
    } catch (err) {
      console.error('[attendance] load error', err)
    }
  },

  formatTime(t) {
    if (!t) return ''
    const d = new Date(t)
    return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`
  }
})
