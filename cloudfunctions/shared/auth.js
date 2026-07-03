const cloud = require('wx-server-sdk')

function getUserContext() {
  const context = cloud.getWXContext()
  return {
    openid: context.OPENID,
    appid: context.APPID,
    unionid: context.UNIONID || ''
  }
}

module.exports = {
  getUserContext
}
