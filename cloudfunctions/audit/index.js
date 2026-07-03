const { success, fail } = require('../shared/response')

exports.main = async (event) => {
  const { action } = event

  if (!action) {
    return fail('action is required')
  }

  return success({
    action,
    ready: false
  }, 'audit cloud function scaffold is ready')
}
