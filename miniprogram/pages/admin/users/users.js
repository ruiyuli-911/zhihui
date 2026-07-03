const { call } = require('../../../utils/api')
const { CLOUD_FUNCTIONS } = require('../../../utils/constants')

Page({
  data: {
    list: [], filterRole: '',
    currentUserId: '',
    roleText: {
      jobseeker: '求职者', company_admin: '企业',
      platform_admin: '管理员', gov_admin: '政府'
    }
  },

  onLoad() {
    const app = getApp()
    this.setData({ currentUserId: (app.globalData.accountInfo && app.globalData.accountInfo._id) || '' })
    this.loadList()
  },

  onShow() { this.loadList() },

  handleFilter(e) {
    const role = e.currentTarget.dataset.role
    this.setData({ filterRole: role })
    this.loadList()
  },

  async loadList() {
    try {
      const params = { page: 1, pageSize: 50 }
      if (this.data.filterRole) params.role = this.data.filterRole
      const res = await call(CLOUD_FUNCTIONS.ADMIN, 'listUsers', params)
      this.setData({ list: (res && res.list) || [] })
    } catch (err) {
      console.error('[users] load error', err)
    }
  },

  async handleToggle(e) {
    const { id, status } = e.currentTarget.dataset
    try {
      await call(CLOUD_FUNCTIONS.ADMIN, 'toggleUserStatus', { userId: id, status })
      wx.showToast({ title: status === 'disabled' ? '已禁用' : '已启用', icon: 'none' })
      this.loadList()
    } catch (err) {
      wx.showToast({ title: err.msg || '操作失败', icon: 'none' })
    }
  },

  formatTime(t) {
    if (!t) return ''
    const d = new Date(t)
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
  }
})
