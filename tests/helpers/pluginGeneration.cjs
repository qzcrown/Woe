const { execFileSync } = require('node:child_process')
const path = require('node:path')

module.exports = function preparePluginGeneration() {
  const rootDir = path.resolve(__dirname, '../..')
  execFileSync(process.execPath, [path.join(rootDir, 'scripts/plugins/generate.mjs')], {
    cwd: rootDir,
    stdio: ['ignore', 'ignore', 'inherit']
  })
}
