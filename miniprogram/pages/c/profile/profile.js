const { createPage } = require('../../../utils/page-factory')
const { callSilent } = require('../../../utils/api')
const { PAGES, CLOUD_FUNCTIONS } = require('../../../utils/constants')
const {
  getAccountInfo,
  buildLoginUrl,
  hasRole,
  normalizeAccountInfo,
  resolvePrimaryRole,
  setAccountInfo
} = require('../../../utils/auth')

const ROLE_TEXT_MAP = {
  jobseeker: '求职者',
  company_admin: '企业管理员',
  platform_admin: '平台管理员',
  gov_admin: '政府管理员'
}

function maskPhone(phone = '') {
  if (!/^1\d{10}$/.test(phone)) {
    return phone || ''
  }

  return `${phone.slice(0, 3)}****${phone.slice(-4)}`
}

Page(createPage({
  data: {
    accountInfo: null,
    userRole: '',
    roleText: '未登录',
    displayName: '未登录',
    canOpenAdmin: false
  },

  onShow() {
    this.syncAccountState(getAccountInfo())
    this.refreshAccountProfile()
  },

  async refreshAccountProfile() {
    try {
      const result = await callSilent(CLOUD_FUNCTIONS.ACCOUNT, 'getProfile')

      if (!result || result.code !== 0 || !result.data || !result.data._id) {
        return
      }

      const account = setAccountInfo(result.data) || normalizeAccountInfo(result.data)
      this.syncAccountState(account)
    } catch (err) {
      console.warn('[profile] refresh account failed', err)
    }
  },

  syncAccountState(account) {
    const normalizedAccount = normalizeAccountInfo(account)
    const role = resolvePrimaryRole(normalizedAccount, '')
    const displayName = normalizedAccount
      ? (normalizedAccount.name || maskPhone(normalizedAccount.phone) || '已登录')
      : '未登录'

    this.setData({
      accountInfo: normalizedAccount,
      userRole: role || '',
      roleText: normalizedAccount ? (ROLE_TEXT_MAP[role] || '已登录') : '未登录',
      displayName,
      canOpenAdmin: !!normalizedAccount && hasRole(normalizedAccount, 'platform_admin')
    })
  },

  handleEditProfile() {
    wx.navigateTo({ url: '/pages/c/profile-edit/profile-edit' })
  },

  handleAdmin() {
    if (!this.data.canOpenAdmin) {
      wx.showToast({
        title: '当前账号没有管理员权限',
        icon: 'none'
      })
      return
    }

    wx.navigateTo({ url: PAGES.ADMIN_DASHBOARD })
  },

  handleSwitchToCompany() {
    wx.navigateTo({ url: PAGES.B_HOME })
  },

  handleLogin() {
    wx.navigateTo({
      url: buildLoginUrl({
        url: PAGES.C_PROFILE,
        isTab: true
      })
    })
  },

  handleLogout() {
    setAccountInfo(null)

    wx.showToast({
      title: '已退出登录',
      icon: 'none'
    })

    setTimeout(() => {
      wx.reLaunch({ url: PAGES.C_HOME })
    }, 300)
  }
}))
