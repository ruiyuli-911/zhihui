const { createPage } = require('../../../utils/page-factory')
const { call } = require('../../../utils/api')
const { CLOUD_FUNCTIONS } = require('../../../utils/constants')

function formatDate(value) {
  if (!value) {
    return ''
  }

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return ''
  }

  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')

  return `${year}-${month}-${day}`
}

function normalizePolicy(item = {}) {
  return {
    ...item,
    displayCreatedAt: formatDate(item.createdAt)
  }
}

Page(createPage({
  data: {
    list: []
  },

  onShow() {
    this.loadList()
  },

  async loadList() {
    try {
      const result = await call(CLOUD_FUNCTIONS.POLICY, 'list', { page: 1, pageSize: 50 })
      this.setData({
        list: ((result && result.list) || []).map(normalizePolicy)
      })
    } catch (err) {
      console.error('[c-policies] load error', err)
    }
  }
}))
