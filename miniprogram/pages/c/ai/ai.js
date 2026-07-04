/**
 * 智汇小玉 — AI 就业助手页面
 *
 * 消息类型:
 *   text          — 纯文本对话气泡
 *   job_list      — 岗位卡片列表（含快捷操作按钮）
 *   job_detail    — 单个岗位详情卡片
 *   confirmation  — 确认弹窗（报名确认等）
 *   result        — 操作结果（成功/失败）
 *   error         — 错误提示
 */

let msgId = 100

/**
 * 后端 API 地址
 * 开发时： http://192.168.x.x:8002（改成你电脑的局域网 IP）
 * 上线后： https://your-domain.com
 * 通过全局配置切换，避免改代码
 */
const app = getApp()
const API_BASE = app.globalData?.API_BASE || 'http://127.0.0.1:8002'

Page({
  data: {
    // 输入
    inputText: '',
    loading: false,
    scrollToId: 'bottom-anchor',

    // 语音
    recording: false,
    voiceText: '',
    voiceTip: '按住说话',

    // 快捷问题
    showQuickQuestions: true,
    quickQuestions: ['找附近保安工作', '查看我的报名', '有哪些工作'],

    // 消息列表
    messages: [
      {
        id: msgId++,
        role: 'assistant',
        type: 'text',
        content: { text: '你好，我是智汇小玉！你可以直接说需求，比如："找附近保安工作"、"报名第一个"、"查报名进度"。' },
      },
    ],

    // 会话
    sessionId: '',
  },

  onLoad() {
    const app = getApp()
    const sessionId = `session_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    this.setData({ sessionId })
    // 初始化语音
    this._initVoiceManager()
  },

  // ═══════════════════════════════════════════════════════════
  // 输入处理
  // ═══════════════════════════════════════════════════════════

  handleInput(e) {
    this.setData({ inputText: e.detail.value })
  },

  handleSend() {
    const text = this.data.inputText.trim()
    if (!text) {
      wx.showToast({ title: '请输入内容', icon: 'none' })
      return
    }
    this.sendMessage(text)
  },

  handleQuickQuestion(e) {
    const text = e.currentTarget.dataset.text
    this.sendMessage(text)
  },

  // ═══════════════════════════════════════════════════════════
  // 核心：发送消息 → 调用后端 → 渲染回复
  // ═══════════════════════════════════════════════════════════

  sendMessage(text) {
    // 添加用户消息
    const userMsg = {
      id: msgId++,
      role: 'user',
      type: 'text',
      content: { text },
    }

    this.setData({
      inputText: '',
      loading: true,
      showQuickQuestions: false,
      messages: [...this.data.messages, userMsg],
    })
    this.scrollToBottom()

    // 调用后端 API
    this._callAgentAPI(text)
  },

  /** 调用后端 Agent API */
  _callAgentAPI(text) {
    const app = getApp()
    const userInfo = app.globalData?.userInfo || {}
    const userId = userInfo.openid || `user_${Date.now()}`

    wx.request({
      url: `${API_BASE}/api/agent/chat`,
      method: 'POST',
      header: { 'Content-Type': 'application/json' },
      data: {
        user_id: userId,
        session_id: this.data.sessionId,
        message: text,
      },
      success: (res) => {
        const data = res.data
        if (data && data.type) {
          this._renderReply(data)
        } else {
          this._renderReply({ type: 'text', reply: '服务返回了无效数据，请稍后再试。' })
        }
      },
      fail: () => {
        console.log('后端 API 不可用')
        this._renderReply({ type: 'text', reply: '服务暂时不可用，请确认后端已启动。' })
      },
      complete: () => {
        this.setData({ loading: false })
        this.scrollToBottom()
      },
    })
  },

  /** 渲染后端返回的结构化消息 */
  _renderReply(data) {
    const msg = {
      id: msgId++,
      role: 'assistant',
      type: data.type || 'text',
      content: data.content || { text: data.reply || '' },
      actions: data.actions || [],
    }

    this.setData({ messages: [...this.data.messages, msg] })
    setTimeout(() => this.scrollToBottom(), 200)
  },

  // ═══════════════════════════════════════════════════════════
  // 操作按钮处理
  // ═══════════════════════════════════════════════════════════

  /** 点击操作按钮（报名、查看详情等） */
  handleAction(e) {
    const ds = e.currentTarget.dataset
    // 优先用 data-action 完整对象，fallback 到独立 data-type/data-url
    const action = ds.action
    const type = (action && action.type) || ds.type || ''
    const data = (action && action.data) || {}
    const url = data.url || ds.url || ''

    if (type === 'confirm' || type === 'apply') {
      // 报名按钮 → 发送"报名第X个"
      const index = data.index || ''
      if (index) {
        const cn = ['一', '二', '三', '四', '五'][index - 1] || index
        this.sendMessage(`报名第${cn}个`)
      } else {
        this.sendMessage('确认报名')
      }
    } else if (type === 'submit_application') {
      // 提交报名（带 confirm_token）→ 调用确认接口
      const confirmToken = data.confirm_token || ''
      this.submitApplication(confirmToken)
    } else if (type === 'navigate') {
      if (url) {
        wx.navigateTo({ url })
      }
    } else if (type === 'cancel') {
      this.sendMessage('取消')
    }
  },

  /** 确认报名按钮 */
  handleConfirm(e) {
    this.sendMessage('确认')
  },

  /** 取消按钮 */
  handleCancel() {
    this.sendMessage('取消')
  },

  /** 提交报名（带 confirm_token） */
  submitApplication(confirmToken) {
    const app = getApp()
    const userInfo = app.globalData?.userInfo || {}
    const userId = userInfo.openid || `user_${Date.now()}`

    wx.request({
      url: `${API_BASE}/api/agent/confirm`,
      method: 'POST',
      header: { 'Content-Type': 'application/json' },
      data: {
        user_id: userId,
        confirm_token: confirmToken,
      },
      success: (res) => {
        const data = res.data
        if (data && data.type) {
          this._renderReply(data)
        } else {
          this._renderReply({ type: 'text', reply: '报名提交失败，请稍后再试。' })
        }
      },
      fail: () => {
        this._renderReply({ type: 'text', reply: '服务暂时不可用，请稍后再试。' })
      },
    })
  },

  /** 点击岗位卡片 → 查看详情 */
  handleViewJob(e) {
    const job = e.currentTarget.dataset.job
    if (!job || !job.job_id) return
    // 发送查看详情消息
    this.sendMessage(`查看岗位详情 ${job.job_id}`)
  },

  // ═══════════════════════════════════════════════════════════
  // 语音 — 支持 WechatSI 插件 + Mock 回退
  // ═══════════════════════════════════════════════════════════

  /** 初始化语音识别管理器 */
  _initVoiceManager() {
    if (this._voiceManager) return

    try {
      const plugin = requirePlugin('WechatSI')
      const manager = plugin.getRecordRecognitionManager()
      this._voiceManager = manager

      manager.onStop = (res) => {
        const text = (res && res.result) || ''
        this._onVoiceResult(text)
      }

      manager.onError = (res) => {
        console.warn('[语音] 识别出错', res)
        this._onVoiceResult('')
      }
    } catch (e) {
      console.log('[语音] WechatSI 插件未加载，使用 mock 模式', e)
      this._voiceManager = null
    }
  },

  /** 开始录音 */
  startVoice() {
    this.setData({ recording: true, voiceTip: '录音中，松开发送' })
    wx.vibrateShort({ type: 'light' })

    if (this._voiceManager) {
      // 真实 WechatSI 录音
      this._voiceManager.start({
        lang: 'zh_CN',
        duration: 10000,
      })
    } else {
      // Mock 模式：模拟录音
      setTimeout(() => {
        if (this.data.recording) {
          this.setData({ voiceText: '识别中...', voiceTip: '识别中' })
        }
      }, 1200)
    }
  },

  /** 停止录音 */
  stopVoice() {
    if (!this.data.recording) return
    this.setData({ recording: false, voiceTip: '' })

    if (this._voiceManager) {
      this._voiceManager.stop()
    } else {
      // Mock 模式：随机生成一条查询
      const mockResults = ['帮我找附近保安工作', '报名第一个', '查看我的报名进度']
      const text = mockResults[Math.floor(Math.random() * mockResults.length)]
      this._onVoiceResult(text)
    }
  },

  /** 语音结果回调 */
  _onVoiceResult(text) {
    if (!text || !text.trim()) {
      wx.showToast({ title: '没听清，请再说一遍', icon: 'none' })
      this.setData({ voiceText: '' })
      return
    }

    this.setData({
      voiceText: text,
      voiceTip: '',
    })

    // 自动发送给 Agent
    setTimeout(() => {
      this.sendMessage(text)
      this.setData({ voiceText: '' })
    }, 300)
  },

  // ═══════════════════════════════════════════════════════════
  // 工具
  // ═══════════════════════════════════════════════════════════

  scrollToBottom() {
    setTimeout(() => {
      this.setData({ scrollToId: 'bottom-anchor' })
    }, 150)
  },
})
