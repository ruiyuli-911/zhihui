const fs = require('fs')
const path = require('path')
const ci = require('C:/Users/lenovo/node_modules/miniprogram-ci')

function loadConfig() {
  const localConfigPath = path.resolve(process.cwd(), 'deploy.local.json')
  const exampleConfigPath = path.resolve(process.cwd(), 'deploy.example.json')
  const targetPath = fs.existsSync(localConfigPath) ? localConfigPath : exampleConfigPath
  const config = JSON.parse(fs.readFileSync(targetPath, 'utf8'))

  return {
    ...config,
    projectPath: path.resolve(process.cwd(), config.projectPath),
    privateKeyPath: path.resolve(process.cwd(), config.privateKeyPath)
  }
}

function createProject(config) {
  return new ci.Project({
    appid: config.appid,
    type: 'miniProgram',
    projectPath: config.projectPath,
    privateKeyPath: config.privateKeyPath,
    ignores: config.ignores || []
  })
}

function ensureConfigReady(config) {
  if (!fs.existsSync(config.privateKeyPath)) {
    throw new Error(`Missing private key file: ${config.privateKeyPath}`)
  }
}

module.exports = {
  ci,
  loadConfig,
  createProject,
  ensureConfigReady
}
