import test from 'node:test'
import assert from 'node:assert/strict'
import fs, {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from 'node:fs'
import { execFileSync } from 'node:child_process'
import { syncBuiltinESMExports } from 'node:module'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  backendTestIgnorePattern,
  discoverPluginPackageRecords,
  discoverPluginPackages,
  frontendTestDirs
} from './discovery.mjs'

const DISCOVERY_CLI = fileURLToPath(new URL('./discovery.mjs', import.meta.url))

const metadata = {
  author: 'qzcrown',
  license: 'GPL-3.0-only',
  website: 'https://github.com/qzcrown/woe'
}

function makeRoot(t) {
  const rootDir = mkdtempSync(path.join(tmpdir(), 'woe-plugin-discovery-'))
  t.after(() => rmSync(rootDir, { recursive: true, force: true }))
  mkdirSync(path.join(rootDir, 'src/plugins/builtin'), { recursive: true })
  return rootDir
}

function makeManifest(modulePath, overrides = {}) {
  return {
    modulePath,
    name: modulePath,
    capabilities: ['test'],
    ...metadata,
    ...overrides
  }
}

function writePackage(rootDir, slug, manifest, files = {}) {
  const packageDir = path.join(rootDir, 'src/plugins/builtin', slug)
  mkdirSync(packageDir, { recursive: true })
  if (manifest !== null) {
    writeFileSync(path.join(packageDir, 'plugin.json'), JSON.stringify(manifest, null, 2))
  }
  for (const [name, contents] of Object.entries(files)) {
    const filePath = path.join(packageDir, name)
    mkdirSync(path.dirname(filePath), { recursive: true })
    writeFileSync(filePath, contents)
  }
  return packageDir
}

function discover(rootDir) {
  return discoverPluginPackages({ rootDir, packageRoot: 'src/plugins/builtin' })
}

function expectPluginError(fn, ...parts) {
  assert.throws(fn, error => {
    for (const part of parts) {
      assert.ok(
        String(error.message).includes(part),
        `expected ${JSON.stringify(error.message)} to include ${JSON.stringify(part)}`
      )
    }
    return true
  })
}

test('discovers only real packages, sorts modulePaths, and deeply freezes descriptors', t => {
  const rootDir = makeRoot(t)
  writePackage(rootDir, 'zeta', makeManifest('builtin/zeta'))
  writePackage(rootDir, 'alpha', makeManifest('builtin/alpha', {
    config: { secretFields: ['token'] }
  }))
  writePackage(rootDir, '.hidden', null)
  writeFileSync(path.join(rootDir, 'src/plugins/builtin/not-a-package.ts'), 'export {}')

  const packages = discover(rootDir)
  assert.deepEqual(packages.map(item => item.modulePath), ['builtin/alpha', 'builtin/zeta'])
  assert.ok(Object.isFrozen(packages))
  assert.ok(Object.isFrozen(packages[0]))
  assert.ok(Object.isFrozen(packages[0].capabilities))
  assert.ok(Object.isFrozen(packages[0].config.secretFields))
  assert.throws(() => packages.push(packages[0]), TypeError)
  assert.throws(() => packages[0].capabilities.push('changed'), TypeError)
  assert.throws(() => { packages[0].name = 'changed' }, TypeError)
})

test('adding and deleting package directories changes discovery without a registry', t => {
  const rootDir = makeRoot(t)
  assert.deepEqual(discover(rootDir), [])

  writePackage(rootDir, 'alpha', makeManifest('builtin/alpha'))
  writePackage(rootDir, 'beta', makeManifest('builtin/beta'))
  assert.deepEqual(discover(rootDir).map(item => item.modulePath), ['builtin/alpha', 'builtin/beta'])

  rmSync(path.join(rootDir, 'src/plugins/builtin/beta'), { recursive: true })
  assert.deepEqual(discover(rootDir).map(item => item.modulePath), ['builtin/alpha'])
})

test('a present package without plugin.json fails with its slug and manifest path', t => {
  const rootDir = makeRoot(t)
  writePackage(rootDir, 'broken', null)
  expectPluginError(() => discover(rootDir), 'broken', 'plugin.json')
})

test('malformed manifest JSON fails with its slug and manifest path', t => {
  const rootDir = makeRoot(t)
  const packageDir = path.join(rootDir, 'src/plugins/builtin/broken')
  mkdirSync(packageDir)
  writeFileSync(path.join(packageDir, 'plugin.json'), '{ not json')
  expectPluginError(() => discover(rootDir), 'broken', 'plugin.json')
})

test('a missing declared entry fails with its slug, field, and entry path', t => {
  const rootDir = makeRoot(t)
  writePackage(rootDir, 'broken', makeManifest('builtin/broken', {
    backend: { event: { entry: 'missing.ts', export: 'createPlugin' } }
  }))
  expectPluginError(
    () => discover(rootDir),
    'broken',
    'backend.event.entry',
    'missing.ts'
  )
})

test('entry paths cannot escape the package directory', t => {
  const rootDir = makeRoot(t)
  writePackage(rootDir, 'broken', makeManifest('builtin/broken', {
    backend: { event: { entry: '../outside.ts', export: 'createPlugin' } }
  }))
  writeFileSync(path.join(rootDir, 'src/plugins/builtin/outside.ts'), 'export {}')
  expectPluginError(
    () => discover(rootDir),
    'broken',
    'backend.event.entry',
    '../outside.ts'
  )
})

test('absolute entry paths are rejected with the manifest field', t => {
  const rootDir = makeRoot(t)
  writePackage(rootDir, 'broken', makeManifest('builtin/broken', {
    backend: { event: { entry: '/tmp/plugin.ts', export: 'createPlugin' } }
  }))
  expectPluginError(() => discover(rootDir), 'broken', 'backend.event.entry', '/tmp/plugin.ts')
})

test('a symlinked package directory is rejected instead of followed', t => {
  const rootDir = makeRoot(t)
  const outside = path.join(rootDir, 'outside')
  mkdirSync(outside)
  writeFileSync(path.join(outside, 'plugin.json'), JSON.stringify(makeManifest('builtin/linked')))
  symlinkSync(outside, path.join(rootDir, 'src/plugins/builtin/linked'), 'dir')
  expectPluginError(() => discover(rootDir), 'linked', 'symlink')
})

test('a symlinked declared entry is rejected with its field', t => {
  const rootDir = makeRoot(t)
  const packageDir = writePackage(rootDir, 'broken', makeManifest('builtin/broken', {
    backend: { event: { entry: 'index.ts', export: 'createPlugin' } }
  }))
  const outside = path.join(rootDir, 'outside.ts')
  writeFileSync(outside, 'export {}')
  symlinkSync(outside, path.join(packageDir, 'index.ts'), 'file')
  expectPluginError(
    () => discover(rootDir),
    'broken',
    'backend.event.entry',
    'symlink'
  )
})

function reverseDirectoryEntries(t, rootDir) {
  const originalReaddirSync = fs.readdirSync
  fs.readdirSync = (directory, options) => {
    const entries = originalReaddirSync(directory, options)
    if (options?.withFileTypes && path.resolve(directory) === path.join(rootDir, 'src/plugins/builtin')) {
      return entries.reverse()
    }
    return entries
  }
  syncBuiltinESMExports()
  t.after(() => {
    fs.readdirSync = originalReaddirSync
    syncBuiltinESMExports()
  })
}

test('absolute and parent-escaping packageRoot values are rejected', t => {
  const baseDir = makeRoot(t)
  const rootDir = path.join(baseDir, 'project')
  const outside = path.join(baseDir, 'outside')
  mkdirSync(rootDir)
  mkdirSync(path.join(outside, 'alpha'), { recursive: true })
  writeFileSync(
    path.join(outside, 'alpha/plugin.json'),
    JSON.stringify(makeManifest('builtin/alpha'))
  )

  for (const packageRoot of ['../outside', outside]) {
    expectPluginError(
      () => discoverPluginPackages({ rootDir, packageRoot }),
      'packageRoot',
      'outside'
    )
  }
})

test('a symlinked packageRoot ancestor is rejected even when the final directory is real', t => {
  const baseDir = makeRoot(t)
  const rootDir = path.join(baseDir, 'project')
  const externalPlugins = path.join(baseDir, 'external-plugins')
  mkdirSync(path.join(rootDir, 'src'), { recursive: true })
  mkdirSync(path.join(externalPlugins, 'builtin/alpha'), { recursive: true })
  writeFileSync(
    path.join(externalPlugins, 'builtin/alpha/plugin.json'),
    JSON.stringify(makeManifest('builtin/alpha'))
  )
  symlinkSync(externalPlugins, path.join(rootDir, 'src/plugins'), 'dir')

  expectPluginError(
    () => discoverPluginPackages({ rootDir, packageRoot: 'src/plugins/builtin' }),
    'packageRoot',
    'symlink'
  )
})

test('duplicate modulePaths fail deterministically after reversed filesystem enumeration', t => {
  const rootDir = makeRoot(t)
  writePackage(rootDir, 'alpha', makeManifest('builtin/same'))
  writePackage(rootDir, 'beta', makeManifest('builtin/same'))
  reverseDirectoryEntries(t, rootDir)
  assert.throws(() => discover(rootDir), error => {
    assert.ok(error.message.startsWith('Plugin package "beta" field "modulePath": duplicate identity "builtin/same"'))
    assert.ok(error.message.includes('also declared by "alpha"'))
    return true
  })
})

test('duplicate push platforms fail deterministically after reversed filesystem enumeration', t => {
  const rootDir = makeRoot(t)
  for (const slug of ['alpha', 'beta']) {
    writePackage(rootDir, slug, makeManifest(`builtin/${slug}`, {
      backend: { push: { entry: 'index.ts', export: 'definition', platform: 'vendor' } }
    }), { 'index.ts': 'export const definition = {}' })
  }
  reverseDirectoryEntries(t, rootDir)
  assert.throws(() => discover(rootDir), error => {
    assert.ok(error.message.startsWith('Plugin package "beta" field "backend.push.platform": duplicate platform "vendor"'))
    assert.ok(error.message.includes('also declared by "alpha"'))
    return true
  })
})

for (const platform of ['web', 'unknown']) {
  test(`reserved push platform ${platform} is rejected`, t => {
    const rootDir = makeRoot(t)
    writePackage(rootDir, 'broken', makeManifest('builtin/broken', {
      backend: { push: { entry: 'index.ts', export: 'definition', platform } }
    }), { 'index.ts': 'export const definition = {}' })
    expectPluginError(
      () => discover(rootDir),
      'broken',
      'backend.push.platform',
      platform
    )
  })
}

test('invalid dependency declarations identify their exact field', t => {
  const rootDir = makeRoot(t)
  writePackage(rootDir, 'broken', makeManifest('builtin/broken', {
    dependencies: { frontend: { dependencies: { yaml: 2 } } }
  }))
  expectPluginError(
    () => discover(rootDir),
    'broken',
    'dependencies.frontend.dependencies.yaml'
  )
})

test('repository manifests match the actual input tree and preserve present package identities', () => {
  const rootDir = fileURLToPath(new URL('../../', import.meta.url))
  const packages = discover(rootDir)
  const auditFile = path.join(rootDir, 'export-manifest.json')
  const expectedModules = fs.existsSync(auditFile)
    ? JSON.parse(fs.readFileSync(auditFile, 'utf8')).modules
    : ['builtin/displayer', 'builtin/webhooker']
  assert.deepEqual(packages.map(item => item.modulePath), expectedModules)

  const byPath = new Map(packages.map(item => [item.modulePath, item]))
  const checks = {
    'builtin/webhooker': manifest => {
      assert.deepEqual(manifest.config.secretFields, ['authToken'])
      assert.equal(manifest.backend.task.manualTrigger, false)
      assert.deepEqual(manifest.backend.task.outbound, { allowQuery: true })
    },
    'builtin/displayer': manifest => {
      assert.equal(manifest.backend.event.export, 'createDisplayer')
    },
  }
  for (const [modulePath, check] of Object.entries(checks)) {
    if (byPath.has(modulePath)) check(byPath.get(modulePath))
  }
})

test('jest collection only follows scanned packages: builtin paths except <slug>/tests/backend stay ignored', t => {
  const rootDir = makeRoot(t)
  const eventManifest = slug => makeManifest(`builtin/${slug}`, {
    backend: { event: { entry: 'index.ts', export: `create${slug}` } }
  })
  writePackage(rootDir, 'alpha', eventManifest('alpha'), {
    'index.ts': `export function createalpha() {}\n`
  })
  writePackage(rootDir, 'beta', eventManifest('beta'), {
    'index.ts': `export function createbeta() {}\n`
  })

  const asJestRegex = slugs => new RegExp(backendTestIgnorePattern(slugs).replace('<rootDir>', '/repo'))
  const records = discoverPluginPackageRecords({ rootDir, packageRoot: 'src/plugins/builtin' })
  const withBoth = asJestRegex(records.map(record => record.slug))


  assert.equal(withBoth.test('/repo/src/plugins/builtin/alpha/tests/backend/a.test.ts'), false)
  assert.equal(withBoth.test('/repo/src/plugins/builtin/beta/tests/backend/deep/b.test.ts'), false)

  assert.equal(withBoth.test('/repo/src/plugins/builtin/alpha/tests/frontend/a.test.ts'), true)
  assert.equal(withBoth.test('/repo/src/plugins/builtin/alpha/__tests__/a.test.ts'), true)

  assert.equal(withBoth.test('/repo/tests/unit/a.test.ts'), false)
  assert.equal(withBoth.test('/repo/src/services/a.test.ts'), false)


  rmSync(path.join(rootDir, 'src/plugins/builtin/beta'), { recursive: true, force: true })
  const afterRemoval = discoverPluginPackageRecords({ rootDir, packageRoot: 'src/plugins/builtin' })
  assert.deepEqual(afterRemoval.map(record => record.slug), ['alpha'])
  const withoutBeta = asJestRegex(afterRemoval.map(record => record.slug))
  assert.equal(withoutBeta.test('/repo/src/plugins/builtin/beta/tests/backend/b.test.ts'), true)
  assert.equal(withoutBeta.test('/repo/src/plugins/builtin/alpha/tests/backend/a.test.ts'), false)


  const empty = asJestRegex([])
  assert.equal(empty.test('/repo/src/plugins/builtin/alpha/tests/backend/a.test.ts'), true)
})

test('vitest includes only follow scanned packages that actually ship tests/frontend', t => {
  const rootDir = makeRoot(t)
  const eventManifest = slug => makeManifest(`builtin/${slug}`, {
    backend: { event: { entry: 'index.ts', export: `create${slug}` } }
  })
  const withFrontendTests = writePackage(rootDir, 'alpha', eventManifest('alpha'), {
    'index.ts': `export function createalpha() {}\n`,
    'tests/frontend/a.test.ts': `import { expect, it } from 'vitest'\nit('works', () => expect(true).toBe(true))\n`
  })
  writePackage(rootDir, 'beta', eventManifest('beta'), {
    'index.ts': `export function createbeta() {}\n`
  })

  const discoverRecords = () =>
    discoverPluginPackageRecords({ rootDir, packageRoot: 'src/plugins/builtin' })

  assert.deepEqual(frontendTestDirs(discoverRecords()), ['src/plugins/builtin/alpha/tests/frontend'])
  assert.ok(withFrontendTests)


  rmSync(path.join(rootDir, 'src/plugins/builtin/alpha'), { recursive: true, force: true })
  assert.deepEqual(frontendTestDirs(discoverRecords()), [])


  const revived = writePackage(rootDir, 'alpha', eventManifest('alpha'), {
    'index.ts': `export function createalpha() {}\n`
  })
  mkdirSync(path.join(revived, 'tests/frontend'), { recursive: true })
  assert.deepEqual(frontendTestDirs(discoverRecords()), ['src/plugins/builtin/alpha/tests/frontend'])
  rmSync(path.join(revived, 'tests/frontend'), { recursive: true, force: true })
  assert.deepEqual(frontendTestDirs(discoverRecords()), [])
})

test('discovery CLI serves CJS consumers: packages, jest ignore and frontend test dirs', t => {
  const rootDir = makeRoot(t)
  const eventManifest = slug => makeManifest(`builtin/${slug}`, {
    backend: { event: { entry: 'index.ts', export: `create${slug}` } }
  })
  writePackage(rootDir, 'alpha', eventManifest('alpha'), {
    'index.ts': `export function createalpha() {}\n`,
    'tests/frontend/a.test.ts': `export {}\n`
  })

  const run = args => execFileSync(process.execPath, [DISCOVERY_CLI, ...args], { encoding: 'utf8' })


  const packages = JSON.parse(run(['--print-packages', '--root', rootDir]))
  assert.deepEqual(packages.map(item => item.modulePath), ['builtin/alpha'])

  const ignore = run(['--print-jest-ignore', '--root', rootDir])
  assert.equal(ignore, '<rootDir>/src/plugins/builtin/(?!(alpha)/tests/backend/)')

  const frontendDirs = JSON.parse(run(['--print-frontend-test-dirs', '--root', rootDir]))
  assert.deepEqual(frontendDirs, ['src/plugins/builtin/alpha/tests/frontend'])


  for (const bad of [['--nonsense'], ['--print-packages', '--root']]) {
    let failed = false
    try {
      run(bad)
    } catch {
      failed = true
    }
    assert.ok(failed, `expected CLI to reject ${JSON.stringify(bad)}`)
  }
})
