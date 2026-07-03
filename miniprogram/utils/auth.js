const { PAGES, STORAGE_KEYS, ROLES } = require('./constants')

const TAB_BAR_PAGES = new Set([
  PAGES.C_HOME,
  PAGES.C_JOBS,
  PAGES.C_MY_APPLICATIONS,
  PAGES.C_PROFILE
])

const ROLE_PRIORITY = [
  ROLES.PLATFORM_ADMIN,
  ROLES.GOV_ADMIN,
  ROLES.COMPANY_ADMIN,
  ROLES.JOBSEEKER
]

function getAccountRoles(accountInfo = null) {
  const account = accountInfo || getAccountInfo()
  const roleSet = new Set()

  if (account && Array.isArray(account.roles)) {
    account.roles.filter(Boolean).forEach((item) => roleSet.add(item))
  }

  if (account && account.role) {
    roleSet.add(account.role)
  }

  return Array.from(roleSet)
}

function resolvePrimaryRole(accountInfo = null, fallback = '') {
  const account = accountInfo || getAccountInfo()

  if (!account) {
    return fallback
  }

  const roles = getAccountRoles(account)

  if (account.role && roles.includes(account.role)) {
    return account.role
  }

  return ROLE_PRIORITY.find((role) => roles.includes(role)) || fallback || ''
}

function normalizeAccountInfo(accountInfo = null) {
  if (!accountInfo || !accountInfo._id) {
    return null
  }

  const roles = getAccountRoles(accountInfo)
  const role = resolvePrimaryRole(
    {
      ...accountInfo,
      roles
    },
    accountInfo.role || roles[0] || ''
  )

  return {
    ...accountInfo,
    role: role || '',
    roles
  }
}

function syncGlobalAccount(accountInfo = null) {
  const app = getApp()
  app.globalData.accountInfo = accountInfo || null
  app.globalData.userRole = accountInfo
    ? (resolvePrimaryRole(accountInfo, ROLES.JOBSEEKER) || null)
    : null
}

function setAccountInfo(accountInfo = null) {
  const normalized = normalizeAccountInfo(accountInfo)

  if (!normalized) {
    wx.removeStorageSync(STORAGE_KEYS.ACCOUNT_INFO)
    wx.removeStorageSync(STORAGE_KEYS.ROLE)
    syncGlobalAccount(null)
    return null
  }

  wx.setStorageSync(STORAGE_KEYS.ACCOUNT_INFO, normalized)
  wx.setStorageSync(STORAGE_KEYS.ROLE, normalized.role || '')
  syncGlobalAccount(normalized)
  return normalized
}

function getAccountInfo() {
  const app = getApp()
  const raw = app.globalData.accountInfo || wx.getStorageSync(STORAGE_KEYS.ACCOUNT_INFO) || null
  const cached = normalizeAccountInfo(raw)

  if (!cached) {
    return null
  }

  syncGlobalAccount(cached)

  const stored = wx.getStorageSync(STORAGE_KEYS.ACCOUNT_INFO) || {}
  const storedRoles = Array.isArray(stored.roles) ? stored.roles.join('|') : ''
  const cachedRoles = Array.isArray(cached.roles) ? cached.roles.join('|') : ''

  if (
    stored._id !== cached._id ||
    stored.role !== cached.role ||
    storedRoles !== cachedRoles ||
    stored.phone !== cached.phone ||
    stored.name !== cached.name ||
    stored.profileCompleted !== cached.profileCompleted
  ) {
    wx.setStorageSync(STORAGE_KEYS.ACCOUNT_INFO, cached)
    wx.setStorageSync(STORAGE_KEYS.ROLE, cached.role || '')
  }

  return cached
}

function hasRole(accountInfo, role) {
  return getAccountRoles(accountInfo).includes(role)
}

function isLoggedIn() {
  return Boolean(getAccountInfo())
}

function normalizePageUrl(url = '') {
  if (!url) {
    return ''
  }

  return url.startsWith('/') ? url : `/${url}`
}

function parseQueryString(query = '') {
  return query.split('&').reduce((result, segment) => {
    if (!segment) {
      return result
    }

    const [rawKey, ...rest] = segment.split('=')
    if (!rawKey) {
      return result
    }

    const key = decodeURIComponent(rawKey)
    const value = rest.length ? decodeURIComponent(rest.join('=')) : ''
    result[key] = value
    return result
  }, {})
}

function buildPageUrl(url, params = {}) {
  if (!url) {
    return ''
  }

  const [path, query = ''] = String(url).split('?')
  const mergedParams = {
    ...parseQueryString(query)
  }

  Object.keys(params || {}).forEach((key) => {
    const value = params[key]

    if (value === undefined || value === null || value === '') {
      return
    }

    mergedParams[key] = value
  })

  const queryString = Object.keys(mergedParams)
    .map((key) => `${encodeURIComponent(key)}=${encodeURIComponent(String(mergedParams[key]))}`)
    .join('&')

  const normalizedPath = normalizePageUrl(path)
  return queryString ? `${normalizedPath}?${queryString}` : normalizedPath
}

function getCurrentPageUrl() {
  const pages = getCurrentPages()
  const currentPage = pages[pages.length - 1]

  if (!currentPage || !currentPage.route) {
    return ''
  }

  return buildPageUrl(currentPage.route, currentPage.options || {})
}

function buildProfileEditUrl(redirectOptions = {}) {
  const params = ['mode=onboarding']

  if (redirectOptions.phone) {
    params.push(`phone=${encodeURIComponent(redirectOptions.phone)}`)
  }

  if (redirectOptions.url) {
    params.push(`redirect=${encodeURIComponent(redirectOptions.url)}`)
  }

  if (redirectOptions.isTab) {
    params.push('redirectTab=1')
  }

  return `/pages/c/profile-edit/profile-edit?${params.join('&')}`
}

function buildLoginUrl(redirectOptions = {}) {
  const params = []

  if (redirectOptions.url) {
    params.push(`redirect=${encodeURIComponent(redirectOptions.url)}`)
  }

  if (redirectOptions.isTab) {
    params.push('redirectTab=1')
  }

  return `/pages/c/login/login?mode=register${params.length ? `&${params.join('&')}` : ''}`
}

function buildCompanyLoginUrl(redirectOptions = {}) {
  const params = []

  if (redirectOptions.url) {
    params.push(`redirect=${encodeURIComponent(redirectOptions.url)}`)
  }

  return `/pages/b/login/login${params.length ? `?${params.join('&')}` : ''}`
}

function isTabBarUrl(url = '') {
  if (!url) {
    return false
  }

  const pagePath = normalizePageUrl(String(url).split('?')[0])
  return TAB_BAR_PAGES.has(pagePath)
}

function requireLogin(options = {}) {
  const accountInfo = getAccountInfo()

  if (accountInfo && accountInfo._id) {
    if (accountInfo.profileCompleted === false) {
      const resolved = typeof options === 'string' ? { message: options } : options
      const redirectUrl = resolved.redirectUrl || getCurrentPageUrl()

      wx.showToast({
        title: resolved.profileMessage || '请先完善资料',
        icon: 'none'
      })

      setTimeout(() => {
        wx.navigateTo({
          url: buildProfileEditUrl({
            phone: accountInfo.phone || '',
            url: redirectUrl,
            isTab: !!resolved.isTab
          })
        })
      }, 250)

      return false
    }

    return true
  }

  const resolved = typeof options === 'string' ? { message: options } : options
  const message = resolved.message || '请先登录后再操作'
  const redirectUrl = resolved.redirectUrl || getCurrentPageUrl()

  wx.showToast({
    title: message,
    icon: 'none'
  })

  setTimeout(() => {
    wx.navigateTo({
      url: buildLoginUrl({
        url: redirectUrl,
        isTab: !!resolved.isTab
      })
    })
  }, 250)

  return false
}

function requireCompanyAccess(options = {}) {
  const accountInfo = getAccountInfo()
  if (accountInfo && hasRole(accountInfo, ROLES.COMPANY_ADMIN)) {
    return true
  }

  const resolved = typeof options === 'string' ? { message: options } : options
  const redirectUrl = resolved.redirectUrl || getCurrentPageUrl()
  const message = accountInfo && accountInfo._id
    ? (resolved.message || '当前微信账号还没有企业权限')
    : (resolved.message || '请先登录企业端')

  wx.showToast({
    title: message,
    icon: 'none'
  })

  setTimeout(() => {
    wx.navigateTo({
      url: buildCompanyLoginUrl({
        url: redirectUrl
      })
    })
  }, 250)

  return false
}

function redirectAfterLogin(redirectUrl, isTab) {
  if (!redirectUrl) {
    return false
  }

  const normalizedUrl = String(redirectUrl)
  const tabTarget = normalizePageUrl(normalizedUrl.split('?')[0])

  if (isTab || isTabBarUrl(normalizedUrl)) {
    wx.switchTab({ url: tabTarget })
    return true
  }

  wx.redirectTo({ url: normalizedUrl })
  return true
}

module.exports = {
  getAccountInfo,
  getAccountRoles,
  hasRole,
  isLoggedIn,
  resolvePrimaryRole,
  normalizeAccountInfo,
  setAccountInfo,
  normalizePageUrl,
  buildPageUrl,
  getCurrentPageUrl,
  buildProfileEditUrl,
  requireLogin,
  requireCompanyAccess,
  buildLoginUrl,
  buildCompanyLoginUrl,
  redirectAfterLogin
}
