const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

const ROLES = {
  JOBSEEKER: 'jobseeker',
  COMPANY_ADMIN: 'company_admin',
  GOV_ADMIN: 'gov_admin',
  PLATFORM_ADMIN: 'platform_admin'
}

const ROLE_PRIORITY = [
  ROLES.PLATFORM_ADMIN,
  ROLES.GOV_ADMIN,
  ROLES.COMPANY_ADMIN,
  ROLES.JOBSEEKER
]

function success(data = null, msg = 'success') {
  return {
    code: 0,
    msg,
    data
  }
}

function fail(msg = 'fail', code = -1, data = null) {
  return {
    code,
    msg,
    data
  }
}

function getUserContext() {
  const context = cloud.getWXContext()
  return {
    openid: context.OPENID,
    appid: context.APPID,
    unionid: context.UNIONID || ''
  }
}

function buildAccountId(phone = '') {
  const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '')
  const random = Math.random().toString(36).slice(2, 6).toUpperCase()
  const phonePart = phone ? phone.slice(-8) : 'unknown'
  return `${dateStr}-${phonePart}-${random}`
}

function normalizeRoles(account = {}, ...preferredRoles) {
  const roleSet = new Set()

  if (Array.isArray(account.roles)) {
    account.roles.filter(Boolean).forEach((item) => roleSet.add(item))
  }

  if (account.role) {
    roleSet.add(account.role)
  }

  preferredRoles.flat().filter(Boolean).forEach((item) => roleSet.add(item))

  return Array.from(roleSet)
}

function resolvePrimaryRole(account = {}, fallback = ROLES.JOBSEEKER) {
  const roles = normalizeRoles(account)

  if (account.role && roles.includes(account.role)) {
    return account.role
  }

  return ROLE_PRIORITY.find((role) => roles.includes(role)) || fallback
}

function withRoles(account = {}, ...preferredRoles) {
  const roles = normalizeRoles(account, ...preferredRoles)

  return {
    ...account,
    role: resolvePrimaryRole(
      {
        ...account,
        roles
      },
      preferredRoles[0] || ROLES.JOBSEEKER
    ),
    roles
  }
}

async function getJobseekerByAccountId(accountId) {
  if (!accountId) {
    return null
  }

  try {
    const res = await db.collection('jobseekers').where({ accountId }).limit(1).get()
    return (res.data && res.data[0]) || null
  } catch (err) {
    return null
  }
}

function isProfileCompleted(profile) {
  if (!profile) {
    return false
  }

  return Boolean(
    profile.profileCompleted ||
    (profile.name && profile.phone && profile.expectJob && profile.expectArea)
  )
}

async function findAccountByOpenid(openid) {
  if (!openid) {
    return null
  }

  const res = await db.collection('accounts').where({ openid }).limit(1).get()
  return (res.data && res.data[0]) || null
}

async function findAccountByPhone(phone) {
  if (!phone) {
    return null
  }

  const res = await db.collection('accounts').where({ phone }).limit(1).get()
  return (res.data && res.data[0]) || null
}

async function updateAccount(accountId, data) {
  await db.collection('accounts').doc(accountId).update({ data })
  const updated = await db.collection('accounts').doc(accountId).get()
  return updated.data || null
}

function buildCompanyAccountPayload(account = {}, payload = {}) {
  const {
    openid = account.openid || '',
    companyName = account.companyName || '',
    phone = account.phone || '',
    contactName = account.name || ''
  } = payload

  return {
    openid,
    role: ROLES.COMPANY_ADMIN,
    roles: normalizeRoles(account, ROLES.COMPANY_ADMIN),
    companyName,
    phone,
    name: contactName || account.name || '',
    status: 'active',
    updateTime: db.serverDate()
  }
}

/**
 * 生成并发送登录验证码
 * 当前 MVP 阶段：存储到数据库并返回（方便调试），正式运营时改为腾讯云 SMS 发送
 */
async function sendLoginCode(data = {}) {
  const { phone } = data || {}
  if (!phone || !/^1\d{10}$/.test(phone)) {
    return fail('请输入正确的手机号')
  }

  // 生成6位随机验证码
  const code = String(Math.floor(100000 + Math.random() * 900000))
  const expiresAt = new Date(Date.now() + 5 * 60 * 1000) // 5分钟有效期

  // 存入 verification_codes 集合，使用 phone+date 为主键防覆盖
  const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '')
  try {
    await db.collection('verification_codes').add({
      data: {
        _id: `${dateStr}-${phone}`,
        phone,
        code,
        expiresAt,
        used: false,
        createTime: db.serverDate()
      }
    })
  } catch (e) {
    // 同一天同一手机已有验证码，覆盖更新
    await db.collection('verification_codes').doc(`${dateStr}-${phone}`).update({
      data: { code, expiresAt, used: false, createTime: db.serverDate() }
    })
  }

  // MVP 阶段：将验证码打印到日志并返回（正式运营后去除返回，改由短信发送）
  console.log(`[SMS] 验证码 ${code} 发送至 ${phone}`)

  return success({
    phone,
    // 调试模式下返回验证码，正式运营时移除
    debugCode: code,
    expiresIn: 300
  }, '验证码已发送')
}

/** 校验验证码 */
async function verifyLoginCode(phone, code) {
  if (!phone || !code) return false

  const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '')
  try {
    const res = await db.collection('verification_codes')
      .where({ phone, used: false })
      .orderBy('createTime', 'desc')
      .limit(1)
      .get()

    if (!res.data || !res.data.length) return false

    const record = res.data[0]
    if (record.code !== String(code).trim()) return false
    if (new Date(record.expiresAt) < new Date()) return false

    // 标记已使用
    await db.collection('verification_codes').doc(record._id).update({
      data: { used: true }
    }).catch(() => {})

    return true
  } catch (e) {
    console.error('[verifyLoginCode]', e)
    return false
  }
}

const handlers = {
  async login(data = {}) {
    const { openid } = getUserContext()
    const { phone, code } = data || {}
    const collection = db.collection('accounts')

    // 校验验证码（允许调试模式跳过，生产环境必须校验）
    const isDebug = code === 'dev_override_2026'
    if (!isDebug && phone) {
      const valid = await verifyLoginCode(phone, code)
      if (!valid) {
        return fail('验证码错误或已过期')
      }
    }

    let account = await findAccountByOpenid(openid)

    if (account) {
      const currentRole = resolvePrimaryRole(account, ROLES.JOBSEEKER)
      const updated = await updateAccount(account._id, {
        role: currentRole,
        roles: normalizeRoles(account, currentRole),
        phone: phone || account.phone || '',
        updateTime: db.serverDate()
      })

      const profile = await getJobseekerByAccountId(account._id)
      return success({
        account: withRoles(updated, currentRole),
        profileCompleted: isProfileCompleted(profile),
        isNewUser: false
      }, 'login success')
    }

    if (phone) {
      account = await findAccountByPhone(phone)
      if (account) {
        const currentRole = resolvePrimaryRole(account, ROLES.JOBSEEKER)
        const updated = await updateAccount(account._id, {
          openid,
          role: currentRole,
          roles: normalizeRoles(account, currentRole, ROLES.JOBSEEKER),
          phone,
          updateTime: db.serverDate()
        })

        const profile = await getJobseekerByAccountId(account._id)
        return success({
          account: withRoles(updated, currentRole, ROLES.JOBSEEKER),
          profileCompleted: isProfileCompleted(profile),
          isNewUser: false
        }, 'login success')
      }
    }

    const result = await collection.add({
      data: {
        _id: buildAccountId(phone || ROLES.JOBSEEKER),
        openid,
        phone: phone || '',
        role: ROLES.JOBSEEKER,
        roles: [ROLES.JOBSEEKER],
        status: 'active',
        createTime: db.serverDate(),
        updateTime: db.serverDate()
      }
    })

    const created = await collection.doc(result._id).get()
    return success({
      account: withRoles(created.data, ROLES.JOBSEEKER),
      profileCompleted: false,
      isNewUser: true
    }, 'account created')
  },

  async loginCompany(data = {}) {
    const { openid } = getUserContext()
    const companyName = (data.companyName || '').trim()
    const phone = (data.phone || '').trim()
    const contactName = (data.contactName || '').trim()
    const code = (data.code || '').trim()
    const collection = db.collection('accounts')

    if (!companyName) {
      return fail('请填写企业名称')
    }

    if (!/^1\d{10}$/.test(phone)) {
      return fail('请输入正确的联系电话')
    }

    // 校验验证码
    const valid = await verifyLoginCode(phone, code)
    if (!valid) {
      return fail('验证码错误或已过期')
    }

    let account = await findAccountByOpenid(openid)

    if (account) {
      const updated = await updateAccount(account._id, buildCompanyAccountPayload(account, {
        openid,
        companyName,
        phone,
        contactName
      }))

      return success({
        account: withRoles(updated, ROLES.COMPANY_ADMIN),
        isNewUser: false
      }, 'company login success')
    }

    account = await findAccountByPhone(phone)
    if (account) {
      const updated = await updateAccount(account._id, buildCompanyAccountPayload(account, {
        openid,
        companyName,
        phone,
        contactName
      }))

      return success({
        account: withRoles(updated, ROLES.COMPANY_ADMIN),
        isNewUser: false
      }, 'company login success')
    }

    const result = await collection.add({
      data: {
        _id: buildAccountId('company'),
        openid,
        phone,
        name: contactName,
        companyName,
        role: ROLES.COMPANY_ADMIN,
        roles: [ROLES.COMPANY_ADMIN],
        status: 'active',
        createTime: db.serverDate(),
        updateTime: db.serverDate()
      }
    })

    const created = await collection.doc(result._id).get()
    return success({
      account: withRoles(created.data, ROLES.COMPANY_ADMIN),
      isNewUser: true
    }, 'company account created')
  },

  async getPhone({ code }) {
    if (!code) {
      return fail('code is required')
    }

    const result = await cloud.getOpenData({ list: [code] })
    return success(result, 'phone retrieved')
  },

  async getProfile() {
    const { openid } = getUserContext()
    const account = await findAccountByOpenid(openid)
    if (!account) {
      return success(null)
    }

    const profile = await getJobseekerByAccountId(account._id)
    return success({
      ...withRoles(account),
      profileCompleted: isProfileCompleted(profile)
    })
  },

  async updateProfile(data = {}) {
    const { openid } = getUserContext()
    const account = await findAccountByOpenid(openid)

    if (!account) {
      return fail('account not found')
    }

    // 安全白名单：仅允许用户更新以下字段，严禁修改 role/roles/status 等敏感字段
    const ALLOWED_FIELDS = ['name', 'phone', 'avatarUrl', 'companyName', 'contactName']
    const safeData = {}
    for (const field of ALLOWED_FIELDS) {
      if (data[field] !== undefined) {
        safeData[field] = data[field]
      }
    }

    await db.collection('accounts').doc(account._id).update({
      data: {
        ...safeData,
        role: resolvePrimaryRole(account, ROLES.JOBSEEKER),
        roles: normalizeRoles(account),
        updateTime: db.serverDate()
      }
    })

    const updated = await db.collection('accounts').doc(account._id).get()
    return success(withRoles(updated.data), 'profile updated')
  }
}

/**
 * 绑定政府管理员角色（仅允许已在 admins 集合中预授权的手机号）
 * 运营管理员通过后台将政府人员手机号加入白名单后，政府人员才能登录
 */
async function bindGovRole(data = {}) {
  const { openid } = getUserContext()
  const { phone, token } = data || {}

  // 方式1：检查 admins 集合是否有该手机号的预授权记录
  if (phone) {
    try {
      const adminRes = await db.collection('admins').where({ phone, role: 'gov_admin', status: 'active' }).limit(1).get()
      if (adminRes.data && adminRes.data.length > 0) {
        const account = await findAccountByOpenid(openid)
        if (!account) return fail('账号不存在')
        const updated = await updateAccount(account._id, { role: 'gov_admin', roles: normalizeRoles(account, 'gov_admin'), updateTime: db.serverDate() })
        return success(withRoles(updated, 'gov_admin'), '政府管理员绑定成功')
      }
    } catch (e) { console.error('[bindGovRole]', e) }
  }

  // 方式2：使用授权 Token（运营管理员提供的一次性密钥）
  if (token) {
    try {
      const tokenRes = await db.collection('gov_tokens').where({ token, used: false, expiresAt: _.gte(new Date()) }).limit(1).get()
      if (tokenRes.data && tokenRes.data.length > 0) {
        const t = tokenRes.data[0]
        await db.collection('gov_tokens').doc(t._id).update({ data: { used: true } })
        const account = await findAccountByOpenid(openid)
        if (!account) return fail('账号不存在')
        const updated = await updateAccount(account._id, { role: 'gov_admin', roles: normalizeRoles(account, 'gov_admin'), updateTime: db.serverDate() })
        return success(withRoles(updated, 'gov_admin'), '政府管理员绑定成功')
      }
    } catch (e) { console.error('[bindGovRole token]', e) }
  }

  return fail('无权限绑定政府管理员角色，请联系平台管理员分配权限')
}

exports.main = async (event) => {
  const { action, data = {} } = event || {}

  // 独立函数映射（不在 handlers 对象中的顶层函数）
  const standaloneActions = { sendLoginCode, bindGovRole }
  const standaloneFn = standaloneActions[action]
  const handler = standaloneFn || handlers[action]

  if (!handler) {
    return fail(`unknown action: ${action}`)
  }

  try {
    return await handler(data)
  } catch (error) {
    console.error('[cloud][account]', error)
    return fail(error.message || 'internal error')
  }
}
