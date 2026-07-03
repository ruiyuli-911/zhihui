const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

exports.main = async (event) => {
  const { action } = event || {}
  if (!action) return { code: -1, msg: 'action is required' }

  try {
    switch (action) {
      case 'getDashboard': return await getDashboard()
      default: return { code: 0, data: { action, ready: false } }
    }
  } catch (err) {
    console.error('[stats]', err)
    return { code: -1, msg: err.message }
  }
}

function success(d = null) { return { code: 0, data: d } }

async function getDashboard() {
  const [jobs, activeJobs, appsTotal, accepted, seekers, companies] = await Promise.all([
    db.collection('jobs').count(),
    db.collection('jobs').where({ recruitStatus: 'recruiting' }).count(),
    db.collection('applications').count(),
    db.collection('applications').where({ status: 'accepted' }).count(),
    db.collection('accounts').where({ role: 'jobseeker' }).count(),
    db.collection('accounts').where({ role: 'company_admin' }).count()
  ])

  return success({
    totalJobs: jobs.total || 0,
    activeJobs: activeJobs.total || 0,
    totalApplications: appsTotal.total || 0,
    acceptedApplications: accepted.total || 0,
    totalJobseekers: seekers.total || 0,
    totalCompanies: companies.total || 0
  })
}
