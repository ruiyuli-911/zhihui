const { call } = require('../../../utils/api')
const { CLOUD_FUNCTIONS } = require('../../../utils/constants')

Page({
  data: { list: [] },

  onShow() { this.loadList() },

  async loadList() {
    try {
      const res = await call(CLOUD_FUNCTIONS.ADMIN, 'listCompanies', { page: 1, pageSize: 50 })
      this.setData({ list: (res && res.list) || [] })
    } catch (err) {
      console.error('[enterprises] load error', err)
    }
  },

  formatTime(t) {
    if (!t) return ''; const d = new Date(t)
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
  }
})
