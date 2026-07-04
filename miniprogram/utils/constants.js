const DEFAULT_ENV_ID = 'cloud1-7gukagm3a064dc47'

const ROLES = {
  JOBSEEKER: 'jobseeker',
  COMPANY_ADMIN: 'company_admin',
  GOV_ADMIN: 'gov_admin',
  PLATFORM_ADMIN: 'platform_admin'
}

const ACCOUNT_STATUS = {
  ACTIVE: 'active',
  DISABLED: 'disabled'
}

const JOBSEEKER_STATUS = {
  ACTIVE: 'active',
  DISABLED: 'disabled'
}

const AUDIT_STATUS = {
  DRAFT: 'draft',
  PENDING: 'pending',
  APPROVED: 'approved',
  REJECTED: 'rejected',
  REVOKED: 'revoked'
}

const RECRUIT_STATUS = {
  RECRUITING: 'recruiting',
  FULL: 'full',
  PAUSED: 'paused',
  CLOSED: 'closed'
}

const APPLY_STATUS = {
  SUBMITTED: 'submitted',
  ACCEPTED: 'accepted',
  REJECTED: 'rejected',
  CANCELLED: 'cancelled',
  COMPLETED: 'completed'
}

const WAGE_CONFIRM_STATUS = {
  PENDING: 'pending',
  CONFIRMED: 'confirmed',
  DISPUTED: 'disputed'
}

const DISPUTE_STATUS = {
  PENDING: 'pending',
  REVIEWING: 'platform_reviewing',
  RESOLVED: 'resolved',
  DISMISSED: 'dismissed'
}

const COMPANY_AUDIT_STATUS = {
  PENDING: 'pending',
  APPROVED: 'approved',
  REJECTED: 'rejected'
}

const APPLY_STATUS_TEXT = {
  [APPLY_STATUS.SUBMITTED]: '已报名',
  [APPLY_STATUS.ACCEPTED]: '已录取',
  [APPLY_STATUS.REJECTED]: '未通过',
  [APPLY_STATUS.CANCELLED]: '已取消',
  [APPLY_STATUS.COMPLETED]: '已完成'
}

const WAGE_STATUS_TEXT = {
  [WAGE_CONFIRM_STATUS.PENDING]: '待确认',
  [WAGE_CONFIRM_STATUS.CONFIRMED]: '已确认',
  [WAGE_CONFIRM_STATUS.DISPUTED]: '有异议'
}

const DEFAULT_CATEGORIES = [
  { name: '采摘工', icon: '采摘工' },
  { name: '家政', icon: '家政' },
  { name: '工厂流水线', icon: '工厂流水线' },
  { name: '物品配送员', icon: '物品配送员' },
  { name: '汽配工', icon: '汽配工' },
  { name: '草编工', icon: '草编工' },
  { name: '餐馆服务', icon: '餐馆服务' },
  { name: '康养', icon: '康养' },
  { name: '建筑工', icon: '建筑工' }
]

const PAGES = {
  C_LOGIN: '/pages/c/login/login',
  C_HOME: '/pages/c/home/home',
  C_JOBS: '/pages/c/jobs/jobs',
  C_JOB_DETAIL: '/pages/c/job-detail/job-detail',
  C_APPLY: '/pages/c/apply/apply',
  C_MY_APPLICATIONS: '/pages/c/my-applications/my-applications',
  C_MY_QRCODE: '/pages/c/my-qrcode/my-qrcode',
  C_CHECKINS: '/pages/c/checkins/checkins',
  C_WAGES: '/pages/c/wages/wages',
  C_WAGE_DETAIL: '/pages/c/wage-detail/wage-detail',
  C_DISPUTE: '/pages/c/dispute/dispute',
  C_FAVORITES: '/pages/c/favorites/favorites',
  C_PROFILE: '/pages/c/profile/profile',
  C_SETTINGS: '/pages/c/settings/settings',
  B_LOGIN: '/pages/b/login/login',
  B_HOME: '/pages/b/home/home',
  B_JOBS: '/pages/b/jobs/jobs',
  B_JOB_PUBLISH: '/pages/b/job-publish/job-publish',
  B_JOB_EDIT: '/pages/b/job-edit/job-edit',
  B_APPLICANTS: '/pages/b/applicants/applicants',
  B_SCAN: '/pages/b/scan/scan',
  B_ATTENDANCE: '/pages/b/attendance/attendance',
  B_WAGES: '/pages/b/wages/wages',
  B_WAGE_INPUT: '/pages/b/wage-input/wage-input',
  G_LOGIN: '/pages/g/login/login',
  G_DASHBOARD: '/pages/g/dashboard/dashboard',
  G_ANALYSIS: '/pages/g/analysis/analysis',
  G_POLICIES: '/pages/g/policies/policies',
  G_ENTERPRISES: '/pages/g/enterprises/enterprises',
  ADMIN_LOGIN: '/pages/admin/login/login',
  ADMIN_DASHBOARD: '/pages/admin/dashboard/dashboard',
  ADMIN_COMPANY_AUDIT: '/pages/admin/company-audit/company-audit',
  ADMIN_JOB_AUDIT: '/pages/admin/job-audit/job-audit',
  ADMIN_USERS: '/pages/admin/users/users',
  ADMIN_DISPUTES: '/pages/admin/disputes/disputes',
  ADMIN_LOGS: '/pages/admin/logs/logs',
  ADMIN_SETTINGS: '/pages/admin/settings/settings'
}

const PAGE_META = {
  [PAGES.C_HOME]: { title: '求职者首页', role: 'c' },
  [PAGES.C_JOBS]: { title: '岗位列表', role: 'c' },
  [PAGES.C_JOB_DETAIL]: { title: '岗位详情', role: 'c' },
  [PAGES.C_APPLY]: { title: '报名确认', role: 'c' },
  [PAGES.C_MY_APPLICATIONS]: { title: '我的报名', role: 'c' },
  [PAGES.C_MY_QRCODE]: { title: '签到码', role: 'c' },
  [PAGES.C_CHECKINS]: { title: '签到记录', role: 'c' },
  [PAGES.C_WAGES]: { title: '工资列表', role: 'c' },
  [PAGES.C_WAGE_DETAIL]: { title: '工资详情', role: 'c' },
  [PAGES.C_DISPUTE]: { title: '工资异议', role: 'c' },
  [PAGES.C_FAVORITES]: { title: '我的收藏', role: 'c' },
  [PAGES.C_PROFILE]: { title: '个人中心', role: 'c' },
  [PAGES.C_SETTINGS]: { title: '设置', role: 'c' },
  [PAGES.B_LOGIN]: { title: '企业登录', role: 'b' },
  [PAGES.B_HOME]: { title: '企业首页', role: 'b' },
  [PAGES.B_JOBS]: { title: '岗位管理', role: 'b' },
  [PAGES.B_JOB_PUBLISH]: { title: '发布岗位', role: 'b' },
  [PAGES.B_JOB_EDIT]: { title: '编辑岗位', role: 'b' },
  [PAGES.B_APPLICANTS]: { title: '报名列表', role: 'b' },
  [PAGES.B_SCAN]: { title: '扫码签到', role: 'b' },
  [PAGES.B_ATTENDANCE]: { title: '考勤记录', role: 'b' },
  [PAGES.B_WAGES]: { title: '工资管理', role: 'b' },
  [PAGES.B_WAGE_INPUT]: { title: '录入工资', role: 'b' },
  [PAGES.G_LOGIN]: { title: '政府登录', role: 'g' },
  [PAGES.G_DASHBOARD]: { title: '数据看板', role: 'g' },
  [PAGES.G_ANALYSIS]: { title: '统计分析', role: 'g' },
  [PAGES.G_POLICIES]: { title: '政策管理', role: 'g' },
  [PAGES.G_ENTERPRISES]: { title: '企业监管', role: 'g' },
  [PAGES.ADMIN_LOGIN]: { title: '管理员登录', role: 'admin' },
  [PAGES.ADMIN_DASHBOARD]: { title: '平台总览', role: 'admin' },
  [PAGES.ADMIN_COMPANY_AUDIT]: { title: '企业审核', role: 'admin' },
  [PAGES.ADMIN_JOB_AUDIT]: { title: '岗位审核', role: 'admin' },
  [PAGES.ADMIN_USERS]: { title: '用户管理', role: 'admin' },
  [PAGES.ADMIN_DISPUTES]: { title: '争议处理', role: 'admin' },
  [PAGES.ADMIN_LOGS]: { title: '操作日志', role: 'admin' },
  [PAGES.ADMIN_SETTINGS]: { title: '系统设置', role: 'admin' }
}

const CLOUD_FUNCTIONS = {
  ACCOUNT: 'account',
  JOBSEEKER: 'jobseeker',
  COMPANY: 'company',
  JOB: 'job',
  APPLY: 'apply',
  CHECKIN: 'checkin',
  WAGE: 'wage',
  POLICY: 'policy',
  AUDIT: 'audit',
  STATS: 'stats',
  NOTIFICATION: 'notification',
  ADMIN: 'admin',
  AI_CHAT: 'ai-chat'
}

const STORAGE_KEYS = {
  ACCOUNT_INFO: 'account_info',
  ROLE: 'user_role',
  TOKEN: 'token'
}

const SMS_TEMPLATES = {
  ACCEPT_NOTICE: 'accept-notice-template-id',
  WAGE_NOTICE: 'wage-notice-template-id'
}

module.exports = {
  DEFAULT_ENV_ID,
  ROLES,
  ACCOUNT_STATUS,
  JOBSEEKER_STATUS,
  AUDIT_STATUS,
  RECRUIT_STATUS,
  APPLY_STATUS,
  WAGE_CONFIRM_STATUS,
  DISPUTE_STATUS,
  COMPANY_AUDIT_STATUS,
  APPLY_STATUS_TEXT,
  WAGE_STATUS_TEXT,
  DEFAULT_CATEGORIES,
  PAGES,
  PAGE_META,
  CLOUD_FUNCTIONS,
  STORAGE_KEYS,
  SMS_TEMPLATES
}
