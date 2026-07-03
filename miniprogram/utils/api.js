/**
 * 智汇就业 — 云函数调用封装
 * 统一调用方式，统一错误处理
 */
const CLOUD_FUNCTIONS = require('./constants').CLOUD_FUNCTIONS

/**
 * 调用云函数
 * @param {string} name   云函数名（用 constants 里的常量）
 * @param {string} action 操作名
 * @param {object} data   参数
 * @returns {Promise<object>} 返回数据
 */
function call(name, action, data = {}) {
  return new Promise((resolve, reject) => {
    // 显示加载提示
    wx.showLoading({ title: '加载中...', mask: true })

    wx.cloud.callFunction({
      name: name,
      data: { action, data }
    }).then(res => {
      wx.hideLoading()
      const result = res.result

      if (result.code === 0) {
        resolve(result.data)
      } else {
        wx.showToast({
          title: result.msg || '操作失败',
          icon: 'none',
          duration: 2000
        })
        reject(result)
      }
    }).catch(err => {
      wx.hideLoading()
      console.error('[云函数调用失败]', name, action, err)

      // 网络错误友好提示
      if (err.errMsg && err.errMsg.includes('cloud.callFunction:fail')) {
        wx.showToast({
          title: '网络连接失败，请检查网络后重试',
          icon: 'none',
          duration: 3000
        })
      } else {
        wx.showToast({
          title: '服务异常，请稍后重试',
          icon: 'none',
          duration: 2000
        })
      }
      reject(err)
    })
  })
}

/**
 * 简写：不需要 loading 的调用（如后台定时刷新）
 */
function callSilent(name, action, data = {}) {
  return wx.cloud.callFunction({
    name: name,
    data: { action, data }
  }).then(res => res.result)
}

module.exports = { call, callSilent }
