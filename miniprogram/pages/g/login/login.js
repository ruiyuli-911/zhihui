const { call } = require('../../../utils/api')
const { CLOUD_FUNCTIONS, STORAGE_KEYS } = require('../../../utils/constants')

Page({
  data: {
    form: { phone: '', code: '' },
    logging: false, sendingCode: false, codeText: '获取验证码'
  },

  onPhoneInput(e) {
    this.setData({ 'form.phone': (e.detail.value || '').replace(/\D/g, '').slice(0, 11) })
  },

  onCodeInput(e) {
    this.setData({ 'form.code': (e.detail.value || '').replace(/\D/g, '').slice(0, 6) })
  },

  async handleSendCode() {
    const { phone } = this.data.form
    if (!/^1\d{10}$/.test(phone)) {
      wx.showToast({ title: '请输入正确手机号', icon: 'none' })
      return
    }
    if (this.data.sendingCode) return

    this.setData({ sendingCode: true, codeText: '发送中...' })

    try {
      const res = await call(CLOUD_FUNCTIONS.ACCOUNT, 'sendLoginCode', { phone })
      if (res && res.debugCode) {
        console.log(`[调试] 政府端验证码 ${res.debugCode} 发送至 ${phone}`)
        wx.showToast({ title: `验证码已发送（调试: ${res.debugCode}）`, icon: 'none', duration: 3000 })
      } else {
        wx.showToast({ title: '验证码已发送', icon: 'none' })
      }

      let s = 60
      this.timer = setInterval(() => {
        s -= 1
        if (s <= 0) {
          clearInterval(this.timer)
          this.setData({ sendingCode: false, codeText: '重新获取' })
          return
        }
        this.setData({ codeText: s + 's后重试' })
      }, 1000)
    } catch (err) {
      this.setData({ sendingCode: false, codeText: '获取验证码' })
      console.error('[g-login] sendCode error', err)
    }
  },

  async handleLogin() {
    const { phone, code } = this.data.form
    if (!/^1\d{10}$/.test(phone)) {
      wx.showToast({ title: '请输入正确手机号', icon: 'none' })
      return
    }
    if (!code || code.length < 4) {
      wx.showToast({ title: '请先获取验证码', icon: 'none' })
      return
    }

    this.setData({ logging: true })
    try {
      // 使用验证码登录
      const res = await call(CLOUD_FUNCTIONS.ACCOUNT, 'login', { phone, code })
      if (res && res.account && res.account._id) {
        // 使用安全授权绑定政府角色（必须已在 admins 白名单中）
        const bindRes = await call(CLOUD_FUNCTIONS.ACCOUNT, 'bindGovRole', { phone })
        if (bindRes && bindRes.role === 'gov_admin') {
          wx.setStorageSync(STORAGE_KEYS.ACCOUNT_INFO, bindRes)
          getApp().globalData.accountInfo = bindRes
          getApp().globalData.userRole = 'gov_admin'
          wx.redirectTo({ url: '/pages/g/dashboard/dashboard' })
        } else {
          wx.showToast({ title: '当前手机号无政府管理员权限', icon: 'none' })
        }
      }
    } catch (err) {
      console.error('[g-login] error', err)
      wx.showToast({ title: err.msg || '登录失败', icon: 'none' })
    } finally {
      this.setData({ logging: false })
    }
  },

  onUnload() {
    if (this.timer) clearInterval(this.timer)
  }
})
