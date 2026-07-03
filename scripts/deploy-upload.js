const { ci, loadConfig, createProject, ensureConfigReady } = require('./deploy-lib')

async function main() {
  const config = loadConfig()
  ensureConfigReady(config)

  const project = createProject(config)
  const result = await ci.upload({
    project,
    version: config.upload.version,
    desc: config.upload.desc,
    setting: config.setting,
    onProgressUpdate(progress) {
      console.log('[upload]', progress)
    }
  })

  console.log('[upload] done')
  console.log(result)
}

main().catch((error) => {
  console.error('[upload] failed')
  console.error(error)
  process.exit(1)
})
