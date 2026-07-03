const { ci, loadConfig, createProject, ensureConfigReady } = require('./deploy-lib')

async function main() {
  const config = loadConfig()
  ensureConfigReady(config)

  const project = createProject(config)
  const result = await ci.preview({
    project,
    desc: config.preview.desc,
    setting: config.setting,
    qrcodeFormat: 'terminal',
    qrcodeOutputDest: './preview-qrcode.jpg',
    onProgressUpdate(progress) {
      console.log('[preview]', progress)
    }
  })

  console.log('[preview] done')
  console.log(result)
}

main().catch((error) => {
  console.error('[preview] failed')
  console.error(error)
  process.exit(1)
})
