const { call } = require('../../../utils/api')
const { CLOUD_FUNCTIONS } = require('../../../utils/constants')

Page({
  data: { data: {} },

  onShow() { this.loadData() },

  async loadData() {
    try {
      const res = await call(CLOUD_FUNCTIONS.STATS, 'getDashboard')
      if (res) this.setData({ data: res })
    } catch (err) { console.error('[analysis] error', err) }
  }
})
