/**
 * 智汇就业 — 通用工具函数
 */

/**
 * 手机号脱敏
 * "13812345678" → "138****5678"
 */
function maskPhone(phone) {
  if (!phone || phone.length !== 11) return phone || ''
  return phone.substring(0, 3) + '****' + phone.substring(7)
}

/**
 * 格式化日期
 * new Date() → "2026-07-01"
 */
function formatDate(date) {
  if (!date) return ''
  const d = typeof date === 'string' ? new Date(date) : date
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/**
 * 格式化日期时间
 * new Date() → "2026-07-01 14:30"
 */
function formatDateTime(date) {
  if (!date) return ''
  const d = typeof date === 'string' ? new Date(date) : date
  return formatDate(d) + ' ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0')
}

/**
 * 格式化薪资范围
 * (200, 260) → "200-260元/天"
 */
function formatSalary(min, max) {
  if (min && max) return `${min}-${max}元/天`
  if (min) return `${min}元起/天`
  if (max) return `最高${max}元/天`
  return '面议'
}

/**
 * 格式化距离
 * 3500 → "3.5km"
 */
function formatDistance(meters) {
  if (!meters && meters !== 0) return ''
  if (meters < 1000) return `${meters}m`
  return (meters / 1000).toFixed(1) + 'km'
}

/**
 * 判断是否是今天
 */
function isToday(date) {
  const d = typeof date === 'string' ? new Date(date) : date
  const now = new Date()
  return d.getFullYear() === now.getFullYear()
    && d.getMonth() === now.getMonth()
    && d.getDate() === now.getDate()
}

/**
 * 简单防抖
 */
function debounce(fn, delay = 500) {
  let timer = null
  return function (...args) {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      fn.apply(this, args)
      timer = null
    }, delay)
  }
}

/**
 * 显示成功提示
 */
function showSuccess(msg = '操作成功') {
  wx.showToast({ title: msg, icon: 'success', duration: 1500 })
}

/**
 * 显示错误提示
 */
function showError(msg = '操作失败') {
  wx.showToast({ title: msg, icon: 'none', duration: 2000 })
}

/**
 * 确认对话框
 */
function showConfirm(title, content) {
  return new Promise((resolve) => {
    wx.showModal({
      title: title || '提示',
      content: content || '确定要执行此操作吗？',
      success: (res) => resolve(res.confirm)
    })
  })
}

module.exports = {
  maskPhone,
  formatDate,
  formatDateTime,
  formatSalary,
  formatDistance,
  isToday,
  debounce,
  showSuccess,
  showError,
  showConfirm
}
