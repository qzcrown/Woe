import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { discoverPluginPackageRecords } from './discovery.mjs'
import {
  assertRetainedLockVersions,
  loadCoreDependencies,
  projectManifests,
  regenerateLockfiles
} from './projectDependencies.mjs'

const repositoryRoot = fileURLToPath(new URL('../../', import.meta.url))

const baseMetadata = {
  name: 'fixture',
  capabilities: ['test'],
  author: 'qzcrown',
  license: 'GPL-3.0-only',
  website: 'https://github.com/qzcrown/woe'
}





function makeRepo(t) {
  const rootDir = mkdtempSync(path.join(tmpdir(), 'woe-plugin-deps-'))
  t.after(() => rmSync(rootDir, { recursive: true, force: true }))
  const core = loadCoreDependencies()

  const rootManifest = {
    name: 'woe-fixture',
    dependencies: { ...core.root.dependencies },
    devDependencies: { ...core.root.devDependencies }
  }
  const frontendManifest = {
    name: 'woe-fixture-frontend',
    dependencies: { ...core.frontend.dependencies, yaml: '^2.9.1' },
    devDependencies: { ...core.frontend.devDependencies }
  }
  writeFileSync(path.join(rootDir, 'package.json'), `${JSON.stringify(rootManifest, null, 2)}\n`)
  mkdirSync(path.join(rootDir, 'frontend'), { recursive: true })
  writeFileSync(
    path.join(rootDir, 'frontend/package.json'),
    `${JSON.stringify(frontendManifest, null, 2)}\n`
  )
  return { rootDir, rootManifest, frontendManifest }
}

function packageRecord(rootDir, slug, dependencies) {
  const manifest = {
    modulePath: `builtin/${slug}`,
    ...baseMetadata,
    ...(dependencies === undefined ? {} : { dependencies })
  }
  return { slug, packageDir: path.join(rootDir, 'src/plugins/builtin', slug), manifest }
}

test('full projection explains the fixture repository and equals its manifests', t => {
  const { rootDir, rootManifest, frontendManifest } = makeRepo(t)
  const packages = [
    packageRecord(rootDir, 'ai-like', { frontend: { dependencies: { yaml: '^2.9.1' } } }),
    packageRecord(rootDir, 'plain-like')
  ]

  const projection = projectManifests({ rootDir, packages, target: 'full' })


  assert.deepEqual(projection.root.dependencies, rootManifest.dependencies)
  assert.deepEqual(projection.root.devDependencies, rootManifest.devDependencies)
  assert.deepEqual(projection.frontend.dependencies, frontendManifest.dependencies)
  assert.deepEqual(projection.frontend.devDependencies, frontendManifest.devDependencies)
  assert.equal(projection.frontend.dependencies.yaml, '^2.9.1')
  assert.equal(projection.root.dependencies.yaml, '^2.7.0')
})

test('full projection fails on a dependency owned by neither core nor a package', t => {
  const { rootDir, rootManifest } = makeRepo(t)
  rootManifest.dependencies['left-pad'] = '^1.0.0'
  writeFileSync(path.join(rootDir, 'package.json'), `${JSON.stringify(rootManifest, null, 2)}\n`)

  assert.throws(
    () =>
      projectManifests({
        rootDir,
        packages: [packageRecord(rootDir, 'ai-like', { frontend: { dependencies: { yaml: '^2.9.1' } } })],
        target: 'full'
      }),
    /root\.dependencies\.left-pad.*owned by neither core nor any plugin package/s
  )
})

test('full projection fails when a package declares a dependency missing from the manifest', t => {
  const { rootDir } = makeRepo(t)
  const packages = [
    packageRecord(rootDir, 'ai-like', { frontend: { dependencies: { yaml: '^2.9.1' } } }),
    packageRecord(rootDir, 'wants-more', { frontend: { dependencies: { magic: '^9.9.9' } } })
  ]

  assert.throws(
    () => projectManifests({ rootDir, packages, target: 'full' }),
    /frontend\.dependencies\.magic.*wants-more.*frontend\/package\.json does not declare it/s
  )
})

test('full projection fails when a manifest range drifts from its owner declaration', t => {
  const { rootDir, frontendManifest } = makeRepo(t)
  frontendManifest.dependencies.yaml = '^2.8.0'
  writeFileSync(
    path.join(rootDir, 'frontend/package.json'),
    `${JSON.stringify(frontendManifest, null, 2)}\n`
  )

  assert.throws(
    () =>
      projectManifests({
        rootDir,
        packages: [packageRecord(rootDir, 'ai-like', { frontend: { dependencies: { yaml: '^2.9.1' } } })],
        target: 'full'
      }),
    /frontend\.dependencies\.yaml.*\^2\.8\.0.*ai-like.*\^2\.9\.1/s
  )
})

test('conflicting shared dependency ranges across packages fail with both owners named', t => {
  const { rootDir } = makeRepo(t)
  const packages = [
    packageRecord(rootDir, 'ai-like', { frontend: { dependencies: { yaml: '^2.9.1' } } }),
    packageRecord(rootDir, 'other-ui', { frontend: { dependencies: { yaml: '^3.0.0' } } })
  ]

  assert.throws(
    () => projectManifests({ rootDir, packages, target: 'export' }),
    /frontend\.dependencies\.yaml.*ai-like.*\^2\.9\.1.*other-ui.*\^3\.0\.0/s
  )
})

test('a package conflicting with core ownership fails with core named as an owner', t => {
  const { rootDir } = makeRepo(t)
  const packages = [packageRecord(rootDir, 'hot-hono', { root: { dependencies: { hono: '^5.0.0' } } })]

  assert.throws(
    () => projectManifests({ rootDir, packages, target: 'export' }),
    /root\.dependencies\.hono.*core.*\^4\.11\.4.*hot-hono.*\^5\.0\.0/s
  )
})

test('export projection drops the AI-only frontend yaml while the core root yaml stays', t => {
  const { rootDir } = makeRepo(t)
  const projection = projectManifests({
    rootDir,
    packages: [packageRecord(rootDir, 'plain-like')],
    target: 'export'
  })


  assert.equal(projection.frontend.dependencies.yaml, undefined)
  assert.equal(projection.frontend.dependencies.vue, '^3.5.0')
  assert.equal(projection.frontend.dependencies.axios, '^1.7.0')

  assert.equal(projection.root.dependencies.yaml, '^2.7.0')
})

test('export projection keeps a shared dependency while another package user remains', t => {
  const { rootDir } = makeRepo(t)
  const packages = [
    packageRecord(rootDir, 'ai-like', { frontend: { dependencies: { yaml: '^2.9.1' } } }),
    packageRecord(rootDir, 'second-ui', { frontend: { dependencies: { yaml: '^2.9.1' } } })
  ]

  const withOneUser = projectManifests({
    rootDir,
    packages: packages.filter(record => record.slug !== 'ai-like'),
    target: 'export'
  })
  assert.equal(withOneUser.frontend.dependencies.yaml, '^2.9.1')

  const withNoUser = projectManifests({ rootDir, packages: [], target: 'export' })
  assert.equal(withNoUser.frontend.dependencies.yaml, undefined)

  assert.equal(withNoUser.root.dependencies.yaml, '^2.7.0')
})

test('lockfile projection always runs npm install --package-lock-only with pinned flags', async t => {
  const { rootDir } = makeRepo(t)
  const calls = []
  const run = async (args, cwd) => {
    calls.push({ args, cwd })
  }

  await regenerateLockfiles({ rootDir, run })

  assert.equal(calls.length, 2)
  assert.deepEqual(calls[0].args, [
    'install',
    '--package-lock-only',
    '--ignore-scripts',
    '--no-audit',
    '--no-fund'
  ])
  assert.equal(calls[0].cwd, rootDir)
  assert.deepEqual(calls[1].args, calls[0].args)
  assert.equal(calls[1].cwd, path.join(rootDir, 'frontend'))
})

test('retained lockfile entries must keep their locked versions', () => {
  const source = {
    lockfileVersion: 3,
    packages: {
      '': {},
      'node_modules/yaml': { version: '2.9.1' },
      'node_modules/vue': { version: '3.5.13' }
    }
  }
  const projected = {
    lockfileVersion: 3,
    packages: {
      '': {},
      'node_modules/yaml': { version: '2.9.2' },
      'node_modules/vue': { version: '3.5.13' },
      'node_modules/added-by-npm': { version: '1.0.0' }
    }
  }

  assert.throws(
    () => assertRetainedLockVersions({ source, projected, context: 'frontend' }),
    /frontend.*node_modules\/yaml.*2\.9\.1.*2\.9\.2/s
  )

  const removedByNpm = {
    lockfileVersion: 3,
    packages: { '': {}, 'node_modules/vue': { version: '3.5.13' } }
  }

  assertRetainedLockVersions({ source, projected: removedByNpm, context: 'frontend' })
})

test('the real repository manifests stay fully explained by core ownership and plugin declarations', () => {
  const packages = discoverPluginPackageRecords({
    rootDir: repositoryRoot,
    packageRoot: 'src/plugins/builtin'
  })

  const projection = projectManifests({ rootDir: repositoryRoot, packages, target: 'full' })



  assert.equal(projection.frontend.dependencies.yaml, undefined)
  assert.equal(projection.root.dependencies.yaml, '^2.7.0')
})
