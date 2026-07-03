const { createPage } = require('../../../utils/page-factory')
const { call } = require('../../../utils/api')
const { CLOUD_FUNCTIONS, PAGES, STORAGE_KEYS } = require('../../../utils/constants')
const { setAccountInfo } = require('../../../utils/auth')

Page(createPage({
  data: {
    form: {
      phone: '',
      code: ''
    },
    logging: false,
    sendingCode: false,
    codeText: '获取验证码'
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

  async handleSendCode() {
    const { phone } = this.data.form

    if (!/^1\d{10}$/.test(phone)) {
      wx.showToast({ title: '请输入正确的手机号', icon: 'none' })
      return
    }

    if (this.data.sendingCode) return

    this.setData({ sendingCode: true, codeText: '发送中...' })

    try {
      const res = await call(CLOUD_FUNCTIONS.ACCOUNT, 'sendLoginCode', { phone })

      if (res && res.debugCode) {
        console.log(`[调试] 管理员验证码 ${res.debugCode} 发送至 ${phone}`)
        wx.showToast({ title: `验证码已发送（调试: ${res.debugCode}）`, icon: 'none', duration: 3000 })
      } else {
        wx.showToast({ title: '验证码已发送', icon: 'none' })
      }

      let s = 60
      this.codeTimer = setInterval(() => {
        s -= 1
        if (s <= 0) {
          clearInterval(this.codeTimer)
          this.codeTimer = null
          this.setData({ sendingCode: false, codeText: '重新获取' })
          return
        }
        this.setData({ codeText: `${s}s后重试` })
      }, 1000)
    } catch (err) {
      this.setData({ sendingCode: false, codeText: '获取验证码' })
      console.error('[admin-login] sendCode error', err)
    }
  },

  async handleLogin() {
    const { phone, code } = this.data.form

    if (!/^1\d{10}$/.test(phone)) {
      wx.showToast({ title: '请输入正确的手机号', icon: 'none' })
      return
    }

    if (!code || code.length < 4) {
      wx.showToast({ title: '请输入验证码', icon: 'none' })
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

      const account = res.account
      const roles = account.roles || []
      const isPlatformAdmin =
        account.role === 'platform_admin' || roles.includes('platform_admin')

      if (!isPlatformAdmin) {
        wx.showToast({
          title: '当前账号无管理员权限',
          icon: 'none',
          duration: 2000
        })
        return
      }

      setAccountInfo(account)
      wx.showToast({ title: '登录成功' })

      setTimeout(() => {
        wx.redirectTo({ url: '/pages/admin/dashboard/dashboard' })
      }, 600)
    } catch (err) {
      console.error('[admin-login] login error', err)
      wx.showToast({
        title: (err && err.msg) || '登录失败，请重试',
        icon: 'none'
      })
    } finally {
      this.setData({ logging: false })
    }
  },

  onUnload() {
    if (this.codeTimer) {
      clearInterval(this.codeTimer)
      this.codeTimer = null
    }
  }
}))
