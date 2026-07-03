const { createPage } = require('../../../utils/page-factory')
const { call } = require('../../../utils/api')
const { CLOUD_FUNCTIONS, PAGES, WAGE_STATUS_TEXT } = require('../../../utils/constants')
const { requireLogin } = require('../../../utils/auth')

function formatDateTime(value) {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  const hours = String(date.getHours()).padStart(2, '0')
  const minutes = String(date.getMinutes()).padStart(2, '0')
  return `${year}-${month}-${day} ${hours}:${minutes}`
}

function normalizeWage(item = {}) {
  return {
    ...item,
    statusText: WAGE_STATUS_TEXT[item.status] || item.status || '待确认',
    displayAmount: item.amount ? `¥${Number(item.amount).toFixed(2)}` : '—',
    displayPeriod: item.period || '',
    displayCreateTime: formatDateTime(item.createTime),
    displayUpdateTime: formatDateTime(item.updateTime)
  }
}

Page(createPage({
  data: {
    list: [],
    loading: true,
    cloudReady: true
  },

  onLoad() {
    if (!requireLogin({
      message: '请先登录后查看工资记录'
    })) {
      return
    }

    this.loadList()
  },

  onShow() {
    if (requireLogin({ silent: true })) {
      this.loadList()
    }
  },

  async loadList() {
    this.setData({ loading: true })

    try {
      const result = await call(CLOUD_FUNCTIONS.WAGE, 'listMine', { page: 1, pageSize: 50 })

      if (result && result.ready === false) {
        this.setData({ cloudReady: false, loading: false, list: [] })
        return
      }

      this.setData({
        list: ((result && result.list) || []).map(normalizeWage),
        cloudReady: true,
        loading: false
      })
    } catch (err) {
      console.error('[wages] load error', err)
      this.setData({
        cloudReady: false,
        loading: false,
        list: []
      })
    }
  },

  handleWageTap(event) {
    const id = event.currentTarget.dataset.id
    if (!id) return

    wx.navigateTo({
      url: `${PAGES.C_WAGE_DETAIL}?wageId=${id}`
    })
  }
}))
