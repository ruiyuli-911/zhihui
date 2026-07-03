const { createPage } = require('../../../utils/page-factory')
const { call } = require('../../../utils/api')
const { CLOUD_FUNCTIONS, WAGE_STATUS_TEXT } = require('../../../utils/constants')

function formatDate(value) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function formatDateTime(value) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  const hours = String(date.getHours()).padStart(2, '0')
  const minutes = String(date.getMinutes()).padStart(2, '0')
  return `${year}-${month}-${day} ${hours}:${minutes}`
}

Page(createPage({
  data: {
    wageId: '',
    wage: null,
    loading: true,
    cloudReady: true,
    statusText: WAGE_STATUS_TEXT
  },

  onLoad(options) {
    const wageId = options.wageId || ''
    this.setData({ wageId })

    if (!wageId) {
      wx.showToast({ title: '参数错误', icon: 'none' })
      return
    }

    this.loadDetail()
  },

  onShow() {
    if (this.data.wageId) {
      this.loadDetail()
    }
  },

  async loadDetail() {
    this.setData({ loading: true })

    try {
      const result = await call(CLOUD_FUNCTIONS.WAGE, 'getDetail', { wageId: this.data.wageId })

      if (result && result.ready === false) {
        this.setData({ cloudReady: false, loading: false })
        return
      }

      const wage = result && result.wage ? {
        ...result.wage,
        statusText: WAGE_STATUS_TEXT[result.wage.status] || result.wage.status || '待确认',
        displayAmount: result.wage.amount ? `¥${Number(result.wage.amount).toFixed(2)}` : '—',
        displayPeriod: result.wage.period || '',
        displayWorkDays: result.wage.workDays || '—',
        displayWorkHours: result.wage.workHours || '—',
        displayCreateTime: formatDateTime(result.wage.createTime),
        displayUpdateTime: formatDateTime(result.wage.updateTime),
        displayCheckinDate: formatDate(result.wage.checkinDate),
        displayDueDate: formatDate(result.wage.dueDate)
      } : null

      this.setData({
        wage,
        cloudReady: true,
        loading: false
      })
    } catch (err) {
      console.error('[wage-detail] load error', err)
      this.setData({
        cloudReady: false,
        loading: false
      })
    }
  },

  handleConfirm() {
    if (!this.data.wage || this.data.wage.status === 'confirmed') {
      return
    }

    wx.showModal({
      title: '确认工资',
      content: `确认收到 ${this.data.wage.displayAmount} 的工资吗？确认后如有异议需联系企业协商。`,
      success: async (res) => {
        if (!res.confirm) return

        try {
          await call(CLOUD_FUNCTIONS.WAGE, 'confirm', { wageId: this.data.wageId })
          wx.showToast({ title: '已确认', icon: 'success' })
          this.loadDetail()
        } catch (err) {
          wx.showToast({ title: (err && err.msg) || '操作失败', icon: 'none' })
        }
      }
    })
  },

  handleDispute() {
    if (!this.data.wage || this.data.wage.status === 'disputed') {
      return
    }

    wx.navigateTo({
      url: `/pages/c/dispute/dispute?wageId=${this.data.wageId}`
    })
  }
}))
