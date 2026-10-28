








import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  loadCoreResources,
  loadOpsResources,
  renderWranglerExample
} from './resourceConfig.mjs'
import { discoverPluginPackageRecords } from './discovery.mjs'

const repositoryRoot = fileURLToPath(new URL('../../', import.meta.url))

export function renderExampleFile({ rootDir }) {
  const core = loadCoreResources()
  const resources = loadOpsResources({ rootDir })
  const records = discoverPluginPackageRecords({ rootDir, packageRoot: 'src/plugins/builtin' })
  return renderWranglerExample({ core, records, resources })
}

function runCli() {
  const args = process.argv.slice(2)
  if (args.some(argument => argument !== '--check') || args.length > 1) {
    throw new Error('Usage: node scripts/plugins/renderWranglerExample.mjs [--check]')
  }
  const target = path.join(repositoryRoot, 'template.toml')
  const rendered = renderExampleFile({ rootDir: repositoryRoot })
  if (args.includes('--check')) {
    const committed = readFileSync(target, 'utf8')
    if (committed !== rendered) {
      throw new Error(`template.toml is stale; run node scripts/plugins/renderWranglerExample.mjs`)
    }
    process.stdout.write('template.toml is up to date\n')
    return
  }
  writeFileSync(target, rendered)
  process.stdout.write(`rendered template.toml\n`)
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    runCli()
  } catch (error) {
    process.stderr.write(`${error.message}\n`)
    process.exitCode = 1
  }
}
