/**
 * 语音识别封装
 * 基于微信同声传译插件，前端本地关键字匹配
 */

const INTENT_MAP = [
  { keywords: ['找工作', '找活', '找岗位', '看工作'], action: 'navigate', url: '/pages/c/jobs/jobs' },
  { keywords: ['建筑工', '建筑'], action: 'navigate', url: '/pages/c/jobs/jobs?category=建筑工' },
  { keywords: ['保洁', '打扫'], action: 'navigate', url: '/pages/c/jobs/jobs?category=保洁' },
  { keywords: ['搬运', '搬运工'], action: 'navigate', url: '/pages/c/jobs/jobs?category=搬运工' },
  { keywords: ['家政'], action: 'navigate', url: '/pages/c/jobs/jobs?category=家政' },
  { keywords: ['保安', '看门'], action: 'navigate', url: '/pages/c/jobs/jobs?category=保安' },
  { keywords: ['我的报名', '报名记录'], action: 'navigate', url: '/pages/c/my-applications/my-applications' },
  { keywords: ['签到'], action: 'navigate', url: '/pages/c/my-qrcode/my-qrcode' },
  { keywords: ['工资', '看工资'], action: 'navigate', url: '/pages/c/wages/wages' },
  { keywords: ['个人中心', '我的', '个人'], action: 'navigate', url: '/pages/c/profile/profile' },
  { keywords: ['收藏', '我的收藏'], action: 'navigate', url: '/pages/c/favorites/favorites' },
  { keywords: ['返回', '上一页', '回去'], action: 'back' }
]

const TAB_PAGES = [
  '/pages/c/home/home',
  '/pages/c/jobs/jobs',
  '/pages/c/profile/profile'
]
const JOB_CATEGORY_STORAGE_KEY = 'c_jobs_category'

let manager = null
let onResultCallback = null
let onErrorCallback = null

function init() {
  try {
    const plugin = requirePlugin('WechatSI')
    manager = plugin.getRecordRecognitionManager()

    manager.onRecognize = function () {}

    manager.onStop = function (res) {
      const text = res.result || ''
      if (onResultCallback) {
        onResultCallback(text)
      }
    }

    manager.onError = function (res) {
      if (onErrorCallback) {
        onErrorCallback(res)
      }
    }
  } catch (e) {
    if (onErrorCallback) {
      onErrorCallback({ msg: '语音插件未加载', detail: e })
    }
  }
}

function onResult(callback) {
  onResultCallback = callback
}

function onError(callback) {
  onErrorCallback = callback
}

function start() {
  if (!manager) {
    if (onErrorCallback) onErrorCallback({ msg: '语音插件未初始化' })
    return
  }

  manager.start({
    lang: 'zh_CN',
    duration: 10000,
    numberOfUtterances: 1
  })
}

function stop() {
  if (!manager) return
  manager.stop()
}

function matchIntent(text) {
  if (!text) return null

  for (const item of INTENT_MAP) {
    for (const keyword of item.keywords) {
      if (text.includes(keyword)) {
        return {
          action: item.action,
          url: item.url
        }
      }
    }
  }

  return null
}

function executeIntent(intent) {
  if (!intent) {
    wx.showToast({
      title: '没听懂，您也可以点击按钮操作',
      icon: 'none',
      duration: 2000
    })
    showGuide()
    return
  }

  if (intent.action === 'back') {
    wx.navigateBack()
    return
  }

  if (intent.action === 'navigate') {
    navigate(intent.url)
  }
}

function navigate(url) {
  if (!url) return

  const baseUrl = url.split('?')[0]
  if (baseUrl === '/pages/c/jobs/jobs') {
    const categoryMatch = url.match(/[?&]category=([^&]+)/)
    if (categoryMatch && categoryMatch[1]) {
      wx.setStorageSync(JOB_CATEGORY_STORAGE_KEY, decodeURIComponent(categoryMatch[1]))
    }
    wx.switchTab({ url: baseUrl })
    return
  }

  if (TAB_PAGES.includes(baseUrl) && !url.includes('?')) {
    wx.switchTab({ url: baseUrl })
    return
  }

  wx.navigateTo({ url })
}

function showGuide() {
  wx.showActionSheet({
    itemList: ['找工作', '我的报名', '签到', '看工资', '个人中心'],
    success: (res) => {
      const pages = [
        '/pages/c/jobs/jobs',
        '/pages/c/my-applications/my-applications',
        '/pages/c/my-qrcode/my-qrcode',
        '/pages/c/wages/wages',
        '/pages/c/profile/profile'
      ]

      if (pages[res.tapIndex]) {
        navigate(pages[res.tapIndex])
      }
    }
  })
}

module.exports = {
  init,
  start,
  stop,
  onResult,
  onError,
  matchIntent,
  executeIntent,
  showGuide,
  navigate
}
