import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { discoverPluginPackageRecords } from './discovery.mjs'
import { checkBoundaries } from './checkBoundaries.mjs'

const repositoryRoot = fileURLToPath(new URL('../../', import.meta.url))

function makeRoot(t) {
  const rootDir = mkdtempSync(path.join(tmpdir(), 'woe-plugin-boundaries-'))
  t.after(() => rmSync(rootDir, { recursive: true, force: true }))
  mkdirSync(path.join(rootDir, 'src/plugins/builtin'), { recursive: true })
  mkdirSync(path.join(rootDir, 'frontend/src'), { recursive: true })
  return rootDir
}

function writePackage(rootDir, slug, files) {
  const packageDir = path.join(rootDir, 'src/plugins/builtin', slug)
  mkdirSync(packageDir, { recursive: true })
  for (const [name, contents] of Object.entries(files)) {
    const filePath = path.join(packageDir, name)
    mkdirSync(path.dirname(filePath), { recursive: true })
    writeFileSync(filePath, contents)
  }
  return packageDir
}

const manifest = slug => `${JSON.stringify({
  modulePath: `builtin/${slug}`,
  name: slug,
  capabilities: ['test'],
  author: 'qzcrown',
  license: 'GPL-3.0-only',
  website: 'https://github.com/qzcrown/woe',
  backend: { event: { entry: 'index.ts', export: `create${slug}` } }
}, null, 2)}\n`

function discover(rootDir) {
  return discoverPluginPackageRecords({ rootDir, packageRoot: 'src/plugins/builtin' })
}

test('core source may not import plugin package-private paths', t => {
  const rootDir = makeRoot(t)
  writePackage(rootDir, 'alpha', { 'plugin.json': manifest('alpha'), 'index.ts': 'export function createalpha() {}\n' })
  mkdirSync(path.join(rootDir, 'src/routes'), { recursive: true })
  writeFileSync(
    path.join(rootDir, 'src/routes/app.ts'),
    "import { createalpha } from '../plugins/builtin/alpha/index'\n"
  )

  assert.throws(
    () => checkBoundaries({ rootDir, records: discover(rootDir) }),
    /src\/routes\/app\.ts.*plugins\/builtin\/alpha.*core must not import plugin package paths/s
  )
})

test('core frontend may not import plugin package-private paths', t => {
  const rootDir = makeRoot(t)
  writePackage(rootDir, 'alpha', { 'plugin.json': manifest('alpha'), 'index.ts': 'export function createalpha() {}\n' })
  mkdirSync(path.join(rootDir, 'frontend/src/views'), { recursive: true })
  writeFileSync(
    path.join(rootDir, 'frontend/src/views/Broken.vue'),
    "<script setup>\nimport Comp from '../../../src/plugins/builtin/alpha/frontend/Thing.vue'\n</script>\n"
  )

  assert.throws(
    () => checkBoundaries({ rootDir, records: discover(rootDir) }),
    /frontend\/src\/views\/Broken\.vue.*plugins\/builtin\/alpha/s
  )
})

test('a package may not import another package private path', t => {
  const rootDir = makeRoot(t)
  writePackage(rootDir, 'alpha', { 'plugin.json': manifest('alpha'), 'index.ts': 'export function createalpha() {}\n' })
  writePackage(rootDir, 'beta', {
    'plugin.json': manifest('beta'),
    'index.ts': "import { createalpha } from '../alpha/index.ts'\nexport function createbeta() {}\n"
  })

  assert.throws(
    () => checkBoundaries({ rootDir, records: discover(rootDir) }),
    /beta\/index\.ts.*alpha.*must not import package "alpha"/s
  )
})

test('packages may import core, generated catalogs and their own files', t => {
  const rootDir = makeRoot(t)
  mkdirSync(path.join(rootDir, 'src/generated/plugins'), { recursive: true })
  mkdirSync(path.join(rootDir, 'src/services'), { recursive: true })
  writeFileSync(path.join(rootDir, 'src/generated/plugins/server.ts'), 'export const serverModules = {}\n')
  writeFileSync(
    path.join(rootDir, 'src/services/thing.ts'),
    'export const thing = 1\n'
  )
  writePackage(rootDir, 'alpha', {
    'plugin.json': manifest('alpha'),
    'index.ts': [
      "import { thing } from '../../../services/thing.ts'",
      "import { serverModules } from '../../../generated/plugins/server.ts'",
      "import { helper } from './helper.ts'",
      'export function createalpha() { void thing; void serverModules; void helper }\n'
    ].join('\n'),
    'helper.ts': 'export const helper = 2\n'
  })
  writeFileSync(
    path.join(rootDir, 'src/app.ts'),
    "import { serverModules } from './generated/plugins/server.ts'\nvoid serverModules\n"
  )

  const summary = checkBoundaries({ rootDir, records: discover(rootDir) })

  assert.equal(summary.coreFiles, 2)

  assert.equal(summary.packageFiles, 2)
})

test('the real repository respects core/package import boundaries', () => {
  const records = discoverPluginPackageRecords({
    rootDir: repositoryRoot,
    packageRoot: 'src/plugins/builtin'
  })
  checkBoundaries({ rootDir: repositoryRoot, records })
})

test('existing @/ aliases cannot hide core-to-package or cross-package imports', t => {
  const rootDir = makeRoot(t)
  writePackage(rootDir, 'alpha', { 'plugin.json': manifest('alpha'), 'index.ts': 'export function createalpha() {}' })
  const imports = [
    "import { secret } from '@/../../src/plugins/builtin/alpha/private'",
    "export { secret } from '@/../../src/plugins/builtin/alpha/../alpha/private'",
    "const lazy = import('@/../../src/plugins/builtin/alpha/lazy')",
    "const legacy = require('@/../../src/plugins/builtin/alpha/legacy')"
  ].join('\n')
  writeFileSync(path.join(rootDir, 'frontend/src/broken.ts'), imports)
  writePackage(rootDir, 'beta', { 'plugin.json': manifest('beta'), 'index.ts': imports + '\nexport function createbeta() {}' })
  assert.throws(() => checkBoundaries({ rootDir, records: discover(rootDir) }), error => {
    assert.match(error.message, /core must not import plugin package paths/)
    assert.match(error.message, /package "beta" must not import package "alpha"/)
    assert.equal(error.message.split('\n').length, 9)
    return true
  })
})

test('aliases to core and generated entries stay allowed', t => {
  const rootDir = makeRoot(t)
  writeFileSync(path.join(rootDir, 'frontend/src/app.ts'), "import '@/generated/plugins/ui'\n")
  writePackage(rootDir, 'alpha', { 'plugin.json': manifest('alpha'), 'index.ts': "import '@/plugins/types'\nimport '@/../../src/services/http'\nexport function createalpha() {}" })
  checkBoundaries({ rootDir, records: discover(rootDir) })
})
