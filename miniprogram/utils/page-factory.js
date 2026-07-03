const { PAGE_META } = require('./constants')

function resolveRoute() {
  const currentPages = getCurrentPages()
  const current = currentPages[currentPages.length - 1]
  return current ? `/${current.route}` : ''
}

function createPage(customOptions = {}) {
  return {
    data: {
      pageMeta: {
        title: '',
        role: '',
        route: ''
      },
      frameworkReady: false,
      ...customOptions.data
    },

    onLoad(options) {
      const route = resolveRoute()
      const pageMeta = PAGE_META[route] || {
        title: route || '未命名页面',
        role: 'unknown'
      }

      this.setData({
        pageMeta: {
          ...pageMeta,
          route
        },
        frameworkReady: true
      })

      if (typeof customOptions.onLoad === 'function') {
        customOptions.onLoad.call(this, options)
      }
    },

    onShow() {
      if (typeof customOptions.onShow === 'function') {
        customOptions.onShow.call(this)
      }
    },

    onPullDownRefresh() {
      if (typeof customOptions.onPullDownRefresh === 'function') {
        customOptions.onPullDownRefresh.call(this)
      }
    },

    onReachBottom() {
      if (typeof customOptions.onReachBottom === 'function') {
        customOptions.onReachBottom.call(this)
      }
    },

    onShareAppMessage() {
      if (typeof customOptions.onShareAppMessage === 'function') {
        return customOptions.onShareAppMessage.call(this)
      }

      return {
        title: this.data.pageMeta.title || '智汇就业'
      }
    },

    ...customOptions
  }
}

module.exports = {
  createPage
}
