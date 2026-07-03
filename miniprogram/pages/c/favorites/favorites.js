const { createPage } = require('../../../utils/page-factory')
const { call } = require('../../../utils/api')
const { CLOUD_FUNCTIONS, PAGES } = require('../../../utils/constants')
const { requireLogin } = require('../../../utils/auth')

Page(createPage({
  data: {
    list: []
  },

  onLoad() {
    if (!requireLogin({ message: '请先登录后查看收藏岗位' })) {
      return
    }

    this.loadList()
  },

  onShow() {
    this.loadList()
  },

  async loadList() {
    try {
      const result = await call(CLOUD_FUNCTIONS.JOB, 'getMyFavorites', { page: 1, pageSize: 50 })
      this.setData({ list: (result && result.list) || [] })
    } catch (err) {
      console.error('[favorites] load error', err)
    }
  },

  handleTap(event) {
    const jobId = event.currentTarget.dataset.id
    if (!jobId) {
      return
    }

    wx.navigateTo({ url: `${PAGES.C_JOB_DETAIL}?jobId=${jobId}` })
  },

  handleRemove(event) {
    const jobId = event.currentTarget.dataset.jobId
    const title = event.currentTarget.dataset.title

    if (!jobId) {
      return
    }

    wx.showModal({
      title: '取消收藏',
      content: `确定取消收藏“${title || '该岗位'}”吗？`,
      success: async (res) => {
        if (!res.confirm) {
          return
        }

        try {
          await call(CLOUD_FUNCTIONS.JOB, 'toggleFavorite', { jobId })
          wx.showToast({ title: '已取消收藏', icon: 'none' })
          this.loadList()
        } catch (err) {
          wx.showToast({ title: (err && err.msg) || '操作失败', icon: 'none' })
        }
      }
    })
  }
}))
