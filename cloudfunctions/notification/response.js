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

module.exports = {
  success,
  fail
}
