import { existsSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const repositoryRoot = fileURLToPath(new URL('../../', import.meta.url))
const slug = process.argv[2]

if (!slug || !/^[a-z0-9][a-z0-9-]*$/.test(slug)) {
  console.error('Usage: npm run plugin:test -- <slug>')
  process.exit(1)
}

const packageDir = path.join(repositoryRoot, 'src/plugins/builtin', slug)
if (!existsSync(path.join(packageDir, 'plugin.json'))) {
  console.error(`[plugin:test] unknown plugin package: ${slug}`)
  process.exit(1)
}

function collectTests(directory) {
  if (!existsSync(directory)) return []
  const files = []
  const visit = current => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) continue
      const absolute = path.join(current, entry.name)
      if (entry.isDirectory()) visit(absolute)
      else if (/\.(test|spec)\.ts$/.test(entry.name)) files.push(absolute)
    }
  }
  visit(directory)
  return files.sort()
}

const backendTests = collectTests(path.join(packageDir, 'tests/backend'))
const frontendTests = collectTests(path.join(packageDir, 'tests/frontend'))

if (backendTests.length === 0 && frontendTests.length === 0) {
  console.log(`[plugin:test] ${slug}: no backend or frontend tests`)
  process.exit(0)
}

let failed = false

if (backendTests.length > 0) {
  console.log(`[plugin:test] ${slug}: backend (${backendTests.length} files)`)
  const result = spawnSync(
    path.join(repositoryRoot, 'node_modules/.bin/jest'),
    ['--runInBand', '--runTestsByPath', ...backendTests],
    { cwd: repositoryRoot, stdio: 'inherit', env: process.env }
  )
  if (result.status !== 0) failed = true
}

if (frontendTests.length > 0) {
  const frontendRoot = path.join(repositoryRoot, 'frontend')
  console.log(`[plugin:test] ${slug}: frontend (${frontendTests.length} files)`)
  const relativeTests = frontendTests.map(file => path.relative(frontendRoot, file))
  const result = spawnSync(
    path.join(frontendRoot, 'node_modules/.bin/vitest'),
    ['run', ...relativeTests],
    { cwd: frontendRoot, stdio: 'inherit', env: process.env }
  )
  if (result.status !== 0) failed = true
}

process.exit(failed ? 1 : 0)
