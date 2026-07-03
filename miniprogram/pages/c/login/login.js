const { call } = require('../../../utils/api')
const { CLOUD_FUNCTIONS, STORAGE_KEYS, PAGES } = require('../../../utils/constants')
const {
  redirectAfterLogin,
  normalizeAccountInfo,
  resolvePrimaryRole,
  setAccountInfo
} = require('../../../utils/auth')

Page({
  data: {
    mode: 'register',
    redirect: '',
    redirectTab: false,
    form: {
      phone: '',
      code: ''
    },
    agreed: true,
    logging: false,
    sendingCode: false,
    codeText: '获取验证码'
  },

  onLoad(options = {}) {
    this.setData({
      mode: options.mode || 'register',
      redirect: decodeURIComponent(options.redirect || ''),
      redirectTab: options.redirectTab === '1'
    })
    this.checkLogin()
  },

  checkLogin() {
    const app = getApp()
    const stored = normalizeAccountInfo(wx.getStorageSync(STORAGE_KEYS.ACCOUNT_INFO))

    if (!app.globalData.accountInfo && stored && stored._id) {
      app.globalData.accountInfo = stored
      app.globalData.userRole = resolvePrimaryRole(stored, 'jobseeker') || 'jobseeker'
    }

    if (app.globalData.accountInfo && app.globalData.accountInfo._id) {
      this.syncProfileAndRedirect()
    }
  },

  async syncProfileAndRedirect() {
    try {
      const res = await call(CLOUD_FUNCTIONS.ACCOUNT, 'login')

      if (res && res.account && res.account._id) {
        setAccountInfo({
          ...res.account,
          profileCompleted: !!res.profileCompleted
        })
      }

      if (res && res.profileCompleted) {
        if (!redirectAfterLogin(this.data.redirect, this.data.redirectTab)) {
          wx.switchTab({ url: PAGES.C_HOME })
        }
        return
      }

      this.redirectToProfileEdit((res && res.account && res.account.phone) || '')
    } catch (err) {
      console.error('[login] sync profile error', err)
      if (!redirectAfterLogin(this.data.redirect, this.data.redirectTab)) {
        wx.switchTab({ url: PAGES.C_HOME })
      }
    }
  },

  onPhoneInput(e) {
    this.setData({
      'form.phone': (e.detail.value || '').replace(/\D/g, '').slice(0, 11)
    })
  },

  onCodeInput(e) {
    this.setData({
      'form.code': (e.detail.value || '').replace(/\D/g, '').slice(0, 6)
    })
  },

  toggleAgreement() {
    this.setData({
      agreed: !this.data.agreed
    })
  },

  handleBack() {
    const pages = getCurrentPages()
    if (pages.length > 1) {
      wx.navigateBack({ delta: 1 })
      return
    }

    wx.switchTab({
      url: PAGES.C_HOME
    })
  },

  async handleSendCode() {
    const { phone } = this.data.form

    if (!/^1\d{10}$/.test(phone)) {
      wx.showToast({
        title: '请输入正确手机号',
        icon: 'none'
      })
      return
    }

    if (this.data.sendingCode) {
      return
    }

    this.setData({
      sendingCode: true,
      codeText: '发送中...'
    })

    try {
      const res = await call(CLOUD_FUNCTIONS.ACCOUNT, 'sendLoginCode', { phone })

      if (res && res.debugCode) {
        // MVP 调试阶段：在控制台和Toast显示验证码（正式运营时移除）
        console.log(`[调试] 验证码 ${res.debugCode} 已发送至 ${phone}`)
        wx.showToast({
          title: `验证码已发送（调试: ${res.debugCode}）`,
          icon: 'none',
          duration: 3000
        })
      } else {
        wx.showToast({
          title: '验证码已发送',
          icon: 'none'
        })
      }

      let seconds = 60
      this.codeTimer = setInterval(() => {
        seconds -= 1

        if (seconds <= 0) {
          clearInterval(this.codeTimer)
          this.codeTimer = null
          this.setData({
            sendingCode: false,
            codeText: '重新获取'
          })
          return
        }

        this.setData({
          codeText: `${seconds}s后重试`
        })
      }, 1000)
    } catch (err) {
      this.setData({
        sendingCode: false,
        codeText: '获取验证码'
      })
      console.error('[login] sendCode error', err)
    }
  },

  async handleLogin() {
    const { phone, code } = this.data.form

    if (!this.data.agreed) {
      wx.showToast({
        title: '请先勾选协议',
        icon: 'none'
      })
      return
    }

    if (!/^1\d{10}$/.test(phone)) {
      wx.showToast({
        title: '请输入正确手机号',
        icon: 'none'
      })
      return
    }

    if (!code || code.length < 4) {
      wx.showToast({
        title: '请先获取验证码',
        icon: 'none'
      })
      return
    }

    this.setData({ logging: true })

    try {
      const res = await call(CLOUD_FUNCTIONS.ACCOUNT, 'login', { phone, code })

      if (!res || !res.account || !res.account._id) {
        wx.showToast({
          title: '登录结果异常',
          icon: 'none'
        })
        return
      }

      setAccountInfo({
        ...res.account,
        profileCompleted: !!res.profileCompleted
      })

      if (res.profileCompleted) {
        if (!redirectAfterLogin(this.data.redirect, this.data.redirectTab)) {
          wx.switchTab({ url: PAGES.C_HOME })
        }
        return
      }

      this.redirectToProfileEdit(phone)
    } catch (err) {
      console.error('[login] error', err)
      wx.showToast({
        title: '登录失败，请重试',
        icon: 'none'
      })
    } finally {
      this.setData({ logging: false })
    }
  },

  redirectToProfileEdit(phone = '') {
    const redirectParams = []

    if (this.data.redirect) {
      redirectParams.push(`redirect=${encodeURIComponent(this.data.redirect)}`)
    }

    if (this.data.redirectTab) {
      redirectParams.push('redirectTab=1')
    }

    wx.redirectTo({
      url: `/pages/c/profile-edit/profile-edit?mode=onboarding&phone=${encodeURIComponent(phone)}${redirectParams.length ? `&${redirectParams.join('&')}` : ''}`
    })
  },

  onUnload() {
    if (this.codeTimer) {
      clearInterval(this.codeTimer)
      this.codeTimer = null
    }
  }
})
