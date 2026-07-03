/**
 * 智慧小职 — AI 就业助手页面
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

/** 后端 API 地址（开发时用本地地址，微信开发者工具须勾选"不校验合法域名"） */
const API_BASE = 'http://127.0.0.1:8000'

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
        content: { text: '你好，我是智慧小职！你可以直接说需求，比如："找附近保安工作"、"报名第一个"、"查报名进度"。' },
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
          this._renderMockReply(text)
        }
      },
      fail: () => {
        // API 不可用时 fallback 到 mock
        console.log('API 不可用，使用 mock 回复')
        this._renderMockReply(text)
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

  /** 纯文本回复（后端不可用时的降级） */
  _renderTextReply(text) {
    const msg = {
      id: msgId++,
      role: 'assistant',
      type: 'text',
      content: { text },
      actions: [],
    }
    this.setData({ loading: false, messages: [...this.data.messages, msg] })
    this.scrollToBottom()
  },

  // ═══════════════════════════════════════════════════════════
  // Mock 回复（后端不可用时回退）
  // ═══════════════════════════════════════════════════════════

  _renderMockReply(text) {
    let msg

    if (text.includes('附近') || text.includes('保安') || text.includes('工作') || text.includes('岗位')) {
      msg = {
        id: msgId++,
        role: 'assistant',
        type: 'job_list',
        content: {
          summary: '找到了 3 个岗位，您看看哪个合适？',
          jobs: [
            { job_id: 'J1001', title: '小区保安', company_name: 'XX物业', salary: '4200-5200元/月', distance: '2.3公里', location: '高新区科技路', benefits: ['包住', '五险', '月休4天'] },
            { job_id: 'J1002', title: '物流园区夜班保安', company_name: 'YY物流', salary: '4500-5500元/月', distance: '3.8公里', location: '经开区物流大道', benefits: ['包吃住', '五险', '月休2天'] },
            { job_id: 'J1003', title: '商场内保', company_name: 'ZZ商业', salary: '4000-4800元/月', distance: '1.5公里', location: '雁塔区小寨', benefits: ['五险一金', '餐补'] },
          ],
        },
        actions: [
          { text: '报名第一个', type: 'confirm', data: { index: 1 } },
          { text: '报名第二个', type: 'confirm', data: { index: 2 } },
          { text: '报名第三个', type: 'confirm', data: { index: 3 } },
        ],
      }
    } else if (text.includes('报名') && text.includes('确认')) {
      msg = {
        id: msgId++,
        role: 'assistant',
        type: 'result',
        content: { status: 'success', title: '报名成功！', description: '【小区保安】报名成功！企业会在1个工作日内联系您。' },
        actions: [
          { text: '查看我的报名', type: 'navigate', data: { url: '/pages/c/my-applications/my-applications' } },
          { text: '继续找工作', type: 'cancel', data: {} },
        ],
      }
    } else if (text.includes('报名')) {
      msg = {
        id: msgId++,
        role: 'assistant',
        type: 'confirm_apply',
        content: {
          text: '您选的是【小区保安】，4200-5200元/月，包住五险。确定报名吗？',
          job: { title: '小区保安', salary: '4200-5200元/月', benefits: ['包住', '五险', '月休4天'] },
        },
        actions: [
          { text: '确认报名', type: 'confirm', data: { action: 'apply' } },
          { text: '取消', type: 'cancel', data: {} },
        ],
      }
    } else if (text.includes('信息') || text.includes('姓名') || text.includes('电话') || text.includes('年龄')) {
      msg = {
        id: msgId++,
        role: 'assistant',
        type: 'collect_info',
        content: {
          text: '还差姓名、电话和年龄。您可以一次说完，比如：我叫王建国，今年53岁，电话13800138000',
          missing_fields: ['姓名', '联系电话', '年龄'],
        },
      }
    } else if (text.includes('查看') || text.includes('进度') || text.includes('状态')) {
      msg = {
        id: msgId++,
        role: 'assistant',
        type: 'text',
        content: { text: '您有 2 条报名记录：\n· 小区保安（XX物业）— 已报名，待企业查看\n· 物流园保安（YY物流）— 已录取' },
      }
    } else {
      msg = {
        id: msgId++,
        role: 'assistant',
        type: 'text',
        content: { text: '您好！我是智慧小职。想找什么样的工作？可以直接告诉我。' },
      }
    }

    this.setData({ loading: false, messages: [...this.data.messages, msg] })
    this.scrollToBottom()
  },

  // ═══════════════════════════════════════════════════════════
  // 操作按钮处理
  // ═══════════════════════════════════════════════════════════

  /** 点击操作按钮（报名、查看详情等） */
  handleAction(e) {
    const action = e.currentTarget.dataset.action
    if (!action) return

    const type = action.type || ''
    const data = action.data || {}

    if (type === 'confirm' || type === 'apply') {
      // 报名按钮 → 发送"报名第X个"
      const index = data.index || ''
      if (index) {
        const cn = ['一', '二', '三', '四', '五'][index - 1] || index
        this.sendMessage(`报名第${cn}个`)
      } else {
        this.sendMessage('确认报名')
      }
    } else if (type === 'navigate') {
      const url = data.url || ''
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
