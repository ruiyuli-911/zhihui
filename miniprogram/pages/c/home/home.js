const { createPage } = require('../../../utils/page-factory')
const { call } = require('../../../utils/api')
const { CLOUD_FUNCTIONS, PAGES } = require('../../../utils/constants')
const { getAccountInfo, requireLogin, buildLoginUrl } = require('../../../utils/auth')
const voice = require('../../../utils/voice')

const NEED_LOGIN_ACTIONS = ['qrcode', 'wages', 'policies', 'favorites']

const DEFAULT_HERO_PROFILE = {
  name: '用户',
  completionText: '欢迎使用智慧就业，今天也一起找一份合适的工作',
}

Page(createPage({
  data: {
    voiceState: 'idle',
    voiceText: '',
    voiceTip: '按一下开始说话，我帮您找工作',
    homeData: null,
    heroProfile: DEFAULT_HERO_PROFILE,
    accountInfo: null,
    loggedIn: false
  },

  onLoad() {
    voice.init()
    voice.onResult(this.handleVoiceResult.bind(this))
    voice.onError(this.handleVoiceError.bind(this))
    this.syncLoginState()
    this.loadHomeData()
  },

  onShow() {
    this.syncLoginState()
  },

  onPullDownRefresh() {
    this.loadHomeData()
  },

  syncLoginState() {
    const accountInfo = getAccountInfo()
    this.setData({
      accountInfo,
      loggedIn: Boolean(accountInfo && accountInfo._id)
    })
  },

  async loadHomeData() {
    try {
      const homeData = await call(CLOUD_FUNCTIONS.JOBSEEKER, 'getHome')
      if (homeData) {
        this.setData({
          homeData: {
            profile: homeData.profile || null,
            quickActions: (homeData.quickActions || []).slice(0, 4),
            recommendJobs: (homeData.recommendJobs || []).slice(0, 3)
          }
        })
        if (homeData.profile) {
          this.setData({ heroProfile: homeData.profile })
        }
      }
    } catch (err) {
      console.error('[c-home] load fail', err)
      this.setData({ homeData: null })
    } finally {
      wx.stopPullDownRefresh()
    }
  },

  handleVoiceTap() {
    if (this.data.voiceState === 'listening') {
      voice.stop()
      this.setData({ voiceState: 'recognizing', voiceTip: '正在识别，请稍等' })
      return
    }
    this.setData({ voiceState: 'listening', voiceText: '', voiceTip: '正在听您说话，请慢一点说' })
    voice.start()
  },

  handleVoiceResult(text) {
    const intent = voice.matchIntent(text)
    this.setData({
      voiceState: 'done',
      voiceText: text || '没有识别到内容',
      voiceTip: intent ? '已帮您找到对应功能' : '没有听清楚，您也可以点击下面按钮'
    })
    setTimeout(() => voice.executeIntent(intent), 300)
  },

  handleVoiceError(err) {
    console.error('[c-home] voice error', err)
    this.setData({ voiceState: 'error', voiceTip: '语音暂时不可用，您也可以手动点击页面按钮' })
  },

  handleSearchTap() {
    wx.switchTab({ url: PAGES.C_JOBS })
  },

  handleLoginEntry() {
    wx.navigateTo({ url: buildLoginUrl({ url: PAGES.C_HOME, isTab: true }) })
  },

  handleQuickActionTap(event) {
    const { url, isTab, key } = event.currentTarget.dataset
    if (!url) return

    if (NEED_LOGIN_ACTIONS.includes(key) && !requireLogin({
      message: '请先登录后再操作', redirectUrl: url, isTab: !!isTab
    })) return

    isTab ? wx.switchTab({ url }) : wx.navigateTo({ url })
  },

  handleJobTap(event) {
    const { id } = event.currentTarget.dataset
    if (!id) return
    wx.navigateTo({ url: `${PAGES.C_JOB_DETAIL}?jobId=${id}` })
  }
}))
