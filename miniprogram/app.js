const { STORAGE_KEYS, DEFAULT_ENV_ID } = require('./utils/constants')
const { normalizeAccountInfo, resolvePrimaryRole } = require('./utils/auth')

App({
  onLaunch() {
    this.initCloud()
    this.initSystemInfo()
    this.restoreSession()
    this.checkUpdate()
  },

  globalData: {
    accountInfo: null,
    userRole: null,
    systemInfo: null,
    safeArea: null,
    envId: DEFAULT_ENV_ID
  },

  initCloud() {
    if (!wx.cloud) {
      console.warn('[app] wx.cloud is unavailable in current runtime')
      return
    }

    const envId = DEFAULT_ENV_ID
    this.globalData.envId = envId

    wx.cloud.init({
      env: envId,
      traceUser: true
    })
  },

  initSystemInfo() {
    const deviceInfo = wx.getDeviceInfo ? wx.getDeviceInfo() : {}
    const windowInfo = wx.getWindowInfo ? wx.getWindowInfo() : {}
    const appBaseInfo = wx.getAppBaseInfo ? wx.getAppBaseInfo() : {}
    const systemSetting = wx.getSystemSetting ? wx.getSystemSetting() : {}
    const appAuthorizeSetting = wx.getAppAuthorizeSetting ? wx.getAppAuthorizeSetting() : {}

    this.globalData.systemInfo = {
      ...deviceInfo,
      ...windowInfo,
      ...appBaseInfo,
      systemSetting,
      appAuthorizeSetting
    }
    this.globalData.safeArea = windowInfo.safeArea || null
  },

  restoreSession() {
    const accountInfo = normalizeAccountInfo(wx.getStorageSync(STORAGE_KEYS.ACCOUNT_INFO))

    if (accountInfo) {
      this.globalData.accountInfo = accountInfo
      this.globalData.userRole = resolvePrimaryRole(accountInfo, '') || null
    }
  },

  checkLogin() {
    return Promise.resolve(Boolean(this.globalData.accountInfo && this.globalData.accountInfo._id))
  },

  checkUpdate() {
    if (!wx.getUpdateManager) {
      return
    }

    const updateManager = wx.getUpdateManager()

    updateManager.onUpdateReady(() => {
      wx.showModal({
        title: '更新提示',
        content: '新版本已经准备好，是否立即重启应用？',
        success: (res) => {
          if (res.confirm) {
            updateManager.applyUpdate()
          }
        }
      })
    })

    updateManager.onUpdateFailed(() => {
      console.warn('[app] failed to download the latest release')
    })
  }
})
