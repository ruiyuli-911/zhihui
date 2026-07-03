const { createPage } = require('../../../utils/page-factory')
const { call } = require('../../../utils/api')
const { CLOUD_FUNCTIONS } = require('../../../utils/constants')
const { requireLogin } = require('../../../utils/auth')

function formatDateTime(value) {
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
  const hours = String(date.getHours()).padStart(2, '0')
  const minutes = String(date.getMinutes()).padStart(2, '0')

  return `${year}-${month}-${day} ${hours}:${minutes}`
}

function normalizeApplication(item = {}) {
  return {
    ...item,
    displayApplyTime: formatDateTime(item.applyTime)
  }
}

Page(createPage({
  data: {
    list: [],
    statusText: {
      submitted: '已报名',
      accepted: '已录取',
      rejected: '未通过',
      cancelled: '已取消',
      completed: '已完成'
    }
  },

  onLoad() {
    if (!requireLogin({
      message: '请先登录后查看报名记录',
      isTab: true
    })) {
      return
    }

    this.loadList()
  },

  onShow() {
    this.loadList()
  },

  async loadList() {
    wx.showLoading({ title: '加载中...', mask: true })

    try {
      const result = await call(CLOUD_FUNCTIONS.APPLY, 'listMine', { page: 1, pageSize: 50 })
      this.setData({
        list: ((result && result.list) || []).map(normalizeApplication)
      })
    } catch (err) {
      console.error('[my-applications] load error', err)
    } finally {
      wx.hideLoading()
    }
  },

  handleCancel(event) {
    const id = event.currentTarget.dataset.id

    if (!id) {
      return
    }

    wx.showModal({
      title: '取消报名',
      content: '确定要取消报名吗？',
      success: async (res) => {
        if (!res.confirm) {
          return
        }

        try {
          await call(CLOUD_FUNCTIONS.APPLY, 'cancel', { applicationId: id })
          wx.showToast({ title: '已取消', icon: 'none' })
          this.loadList()
        } catch (err) {
          wx.showToast({ title: (err && err.msg) || '取消失败', icon: 'none' })
        }
      }
    })
  }
}))
