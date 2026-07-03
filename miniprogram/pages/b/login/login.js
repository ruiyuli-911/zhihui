const { createPage } = require('../../../utils/page-factory')
const { call } = require('../../../utils/api')
const { CLOUD_FUNCTIONS, PAGES } = require('../../../utils/constants')
const { getAccountInfo, hasRole, redirectAfterLogin, setAccountInfo } = require('../../../utils/auth')

Page(createPage({
  data: {
    form: {
      companyName: '',
      phone: '',
      contactName: '',
      code: ''
    },
    logging: false,
    sendingCode: false,
    codeText: '获取验证码',
    redirect: ''
  },

  onLoad(options = {}) {
    const accountInfo = getAccountInfo()

    this.setData({
      redirect: decodeURIComponent(options.redirect || ''),
      form: {
        companyName: (accountInfo && accountInfo.companyName) || '',
        phone: (accountInfo && accountInfo.phone) || '',
        contactName: (accountInfo && accountInfo.name) || '',
        code: ''
      }
    })

    if (accountInfo && hasRole(accountInfo, 'company_admin')) {
      this.finishLogin(accountInfo)
    }
  },

  onCompanyNameInput(e) {
    this.setData({
      'form.companyName': (e.detail.value || '').trim()
    })
  },

  onPhoneInput(e) {
    this.setData({
      'form.phone': (e.detail.value || '').replace(/\D/g, '').slice(0, 11)
    })
  },

  onContactNameInput(e) {
    this.setData({
      'form.contactName': (e.detail.value || '').trim()
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
        console.log(`[调试] 企业端验证码 ${res.debugCode} 发送至 ${phone}`)
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
      console.error('[b-login] sendCode error', err)
    }
  },

  async handleLogin() {
    const { companyName, phone, contactName, code } = this.data.form

    if (!companyName) {
      wx.showToast({
        title: '请填写企业名称',
        icon: 'none'
      })
      return
    }

    if (!/^1\d{10}$/.test(phone)) {
      wx.showToast({
        title: '请输入正确的联系电话',
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
      const res = await call(CLOUD_FUNCTIONS.ACCOUNT, 'loginCompany', {
        companyName,
        phone,
        contactName,
        code
      })

      if (!res || !res.account || !res.account._id) {
        wx.showToast({
          title: '企业登录结果异常',
          icon: 'none'
        })
        return
      }

      this.finishLogin(res.account, true)
    } catch (err) {
      console.error('[b-login] login error', err)
      wx.showToast({
        title: (err && err.msg) || '企业登录失败，请重试',
        icon: 'none'
      })
    } finally {
      this.setData({ logging: false })
    }
  },

  finishLogin(account, showToast = false) {
    setAccountInfo(account)

    if (showToast) {
      wx.showToast({ title: '企业登录成功' })
    }

    setTimeout(() => {
      if (!redirectAfterLogin(this.data.redirect, false)) {
        wx.redirectTo({ url: PAGES.B_HOME })
      }
    }, showToast ? 600 : 0)
  },

  onUnload() {
    if (this.codeTimer) {
      clearInterval(this.codeTimer)
      this.codeTimer = null
    }
  }
}))
