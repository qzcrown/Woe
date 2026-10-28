import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { exportSourceTree } from './export.mjs'
import { generatePluginArtifacts } from './generate.mjs'
import { discoverPluginPackageRecords } from './discovery.mjs'
import { buildWranglerConfig, loadCoreResources, loadOpsResources } from './resourceConfig.mjs'

const repositoryRoot = fileURLToPath(new URL('../../', import.meta.url))
const publicRemovableSlugs = []

function stubLockfileRunner({ outDir, sourceRoot }) {
  const calls = []
  const run = async (args, cwd) => {
    calls.push({ args, cwd })
    const frontend = cwd === path.join(outDir, 'frontend')
    const source = frontend
      ? path.join(sourceRoot, 'frontend/package-lock.json')
      : path.join(sourceRoot, 'package-lock.json')
    if (existsSync(source)) copyFileSync(source, path.join(cwd, 'package-lock.json'))
  }
  return { run, calls }
}

function removalSource(t) {
  const current = discoverPluginPackageRecords({ rootDir: repositoryRoot, packageRoot: 'src/plugins/builtin' })
  if (current.length > 0) return { sourceRoot: repositoryRoot, records: current }

  const parent = mkdtempSync(path.join(tmpdir(), 'woe-export-empty-source-'))
  t.after(() => rmSync(parent, { recursive: true, force: true }))
  const sourceRoot = path.join(parent, 'source')
  for (const directory of ['frontend', 'scripts/plugins', 'src/plugins/builtin/remove-me']) {
    mkdirSync(path.join(sourceRoot, directory), { recursive: true })
  }
  for (const relative of [
    'package.json',
    'package-lock.json',
    'frontend/package.json',
    'frontend/package-lock.json',
    'resources.json',
    'scripts/plugins/export.mjs'
  ]) {
    copyFileSync(path.join(repositoryRoot, relative), path.join(sourceRoot, relative))
  }
  cpSync(path.join(repositoryRoot, 'src/migrations'), path.join(sourceRoot, 'src/migrations'), { recursive: true })
  writeFileSync(path.join(sourceRoot, 'src/plugins/builtin/remove-me/plugin.json'), JSON.stringify({
    modulePath: 'builtin/remove-me',
    name: 'Remove Me',
    capabilities: ['test'],
    author: 'fixture',
    license: 'GPL-3.0-only',
    website: 'https://example.invalid'
  }, null, 2))
  return {
    sourceRoot,
    records: discoverPluginPackageRecords({ rootDir: sourceRoot, packageRoot: 'src/plugins/builtin' })
  }
}

test('export physically removes packages and projects manifests for the remaining set', { timeout: 120000 }, async t => {
  const parent = mkdtempSync(path.join(tmpdir(), 'woe-export-'))
  const outDir = path.join(parent, 'export')
  t.after(() => rmSync(parent, { recursive: true, force: true }))
  const { sourceRoot, records: sourceRecords } = removalSource(t)
  const removedSlug = sourceRecords[0].slug
  const removedModule = sourceRecords.find(record => record.slug === removedSlug).manifest.modulePath
  const expected = sourceRecords.filter(record => record.slug !== removedSlug)
  const lockfiles = stubLockfileRunner({ outDir, sourceRoot })

  const summary = await exportSourceTree({
    rootDir: sourceRoot,
    outDir,
    remove: [removedSlug],
    lockfileRunner: lockfiles.run
  })

  assert.equal(existsSync(path.join(outDir, 'src/plugins/builtin', removedSlug)), false)
  assert.deepEqual(summary.removed, [removedSlug])
  assert.deepEqual([...summary.modules].sort(), expected.map(record => record.manifest.modulePath).sort())
  assert.equal(summary.modules.includes(removedModule), false)

  const frontendManifest = JSON.parse(readFileSync(path.join(outDir, 'frontend/package.json'), 'utf8'))
  assert.equal('yaml' in frontendManifest.dependencies, false)
  const rootManifest = JSON.parse(readFileSync(path.join(outDir, 'package.json'), 'utf8'))
  assert.equal(rootManifest.dependencies.yaml, '^2.7.0')
  assert.equal(
    rootManifest.scripts.postinstall,
    'node scripts/plugins/generate.mjs && node scripts/write-build-info.js'
  )

  assert.equal(lockfiles.calls.length, 2)
  for (const call of lockfiles.calls) {
    assert.deepEqual(call.args, ['install', '--package-lock-only', '--ignore-scripts', '--no-audit', '--no-fund'])
  }

  assert.ok(existsSync(path.join(outDir, 'src/migrations/sql')))
  assert.equal(existsSync(path.join(outDir, 'node_modules')), false)
  assert.equal(existsSync(path.join(outDir, 'src/generated/plugins')), false)
  assert.equal(existsSync(path.join(outDir, 'frontend/src/generated/plugins')), false)
  assert.equal(existsSync(path.join(outDir, 'frontend/public/generated-plugins')), false)
  assert.equal(existsSync(path.join(outDir, '.plugin-generation.json')), false)
  assert.equal(existsSync(path.join(outDir, 'wrangler.resources.json')), false)
  assert.equal(existsSync(path.join(outDir, 'wrangler.toml')), false)

  const audit = JSON.parse(readFileSync(path.join(outDir, 'export-manifest.json'), 'utf8'))
  assert.deepEqual(audit.remove, [removedSlug])
  assert.deepEqual(audit.modules, expected.map(record => record.manifest.modulePath).sort())
  const sample = audit.files.find(entry => entry.path === 'scripts/plugins/export.mjs')
  assert.ok(sample)
  const actual = createHash('sha256').update(readFileSync(path.join(outDir, sample.path))).digest('hex')
  assert.equal(sample.sha256, actual)
  assert.equal(existsSync(path.join(outDir, 'frontend/node_modules')), false)
  assert.equal(audit.files.some(entry => entry.path.split('/').includes('node_modules')), false)
  assert.equal(audit.files.some(entry => entry.path.split('/').includes('dist')), false)
  assert.ok(summary.fileCount < 2000, `fileCount should stay in source-tree scale, got ${summary.fileCount}`)

  await generatePluginArtifacts({ rootDir: outDir, check: false })
  const records = readdirSync(path.join(outDir, 'src/plugins/builtin'), { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => entry.name)
    .sort()
  assert.deepEqual(records, expected.map(record => record.slug).sort())
})

test('nested dependency and build directories are pruned at any depth', async t => {
  const parent = mkdtempSync(path.join(tmpdir(), 'woe-export-nested-'))
  const sourceRoot = path.join(parent, 'source')
  const outDir = path.join(parent, 'export')
  t.after(() => rmSync(parent, { recursive: true, force: true }))

  mkdirSync(path.join(sourceRoot, 'frontend/node_modules/left-pad'), { recursive: true })
  writeFileSync(path.join(sourceRoot, 'frontend/node_modules/left-pad/index.js'), 'module.exports = 1\n')
  mkdirSync(path.join(sourceRoot, 'frontend/dist'), { recursive: true })
  writeFileSync(path.join(sourceRoot, 'frontend/dist/index.html'), '<html></html>')
  mkdirSync(path.join(sourceRoot, 'src/deep/node_modules'), { recursive: true })
  writeFileSync(path.join(sourceRoot, 'src/deep/node_modules/dep.js'), '')
  mkdirSync(path.join(sourceRoot, 'src/deep/coverage'), { recursive: true })
  writeFileSync(path.join(sourceRoot, 'src/deep/coverage/lcov.info'), '')
  for (const directory of ['src/generated/plugins.backup-123', 'frontend/src/generated/plugins.tmp-123', '.plugin-tmp']) {
    mkdirSync(path.join(sourceRoot, directory), { recursive: true })
    writeFileSync(path.join(sourceRoot, directory, 'stale.ts'), 'export const stale = 1')
  }
  writeFileSync(path.join(sourceRoot, 'package.json'), JSON.stringify({ name: 'nested-fixture', private: true }, null, 2))
  writeFileSync(path.join(sourceRoot, 'frontend/package.json'), JSON.stringify({ name: 'nested-fixture-frontend', private: true }, null, 2))
  copyFileSync(
    path.join(repositoryRoot, 'resources.json'),
    path.join(sourceRoot, 'resources.json')
  )

  const summary = await exportSourceTree({ rootDir: sourceRoot, outDir, remove: [], lockfileRunner: null })

  for (const directory of ['src/generated/plugins.backup-123', 'frontend/src/generated/plugins.tmp-123', '.plugin-tmp']) assert.equal(existsSync(path.join(outDir, directory)), false)
  assert.equal(existsSync(path.join(outDir, 'frontend/node_modules/left-pad')), false)
  assert.equal(existsSync(path.join(outDir, 'frontend/dist')), false)
  assert.equal(existsSync(path.join(outDir, 'src/deep/node_modules')), false)
  assert.equal(existsSync(path.join(outDir, 'src/deep/coverage')), false)
  assert.equal(existsSync(path.join(outDir, 'frontend/package.json')), true)
  assert.equal(existsSync(path.join(outDir, 'package.json')), true)
  const audit = JSON.parse(readFileSync(path.join(outDir, 'export-manifest.json'), 'utf8'))
  assert.equal(audit.files.some(entry => entry.path.split('/').includes('node_modules')), false)
  assert.equal(audit.files.some(entry => entry.path.split('/').includes('dist')), false)
  assert.deepEqual(summary.modules, [])
})

test('export removals participate in wrangler resource projection', { timeout: 120000 }, async t => {
  const parent = mkdtempSync(path.join(tmpdir(), 'woe-export-public-'))
  const outDir = path.join(parent, 'export')
  t.after(() => rmSync(parent, { recursive: true, force: true }))
  const { sourceRoot, records: sourceRecords } = removalSource(t)
  const remove = publicRemovableSlugs.filter(slug => sourceRecords.some(record => record.slug === slug))
  const lockfiles = stubLockfileRunner({ outDir, sourceRoot })

  await exportSourceTree({ rootDir: sourceRoot, outDir, remove, lockfileRunner: lockfiles.run })
  await generatePluginArtifacts({ rootDir: outDir, check: false })
  const records = discoverPluginPackageRecords({ rootDir: outDir, packageRoot: 'src/plugins/builtin' })

  const core = loadCoreResources()
  const resources = loadOpsResources({ rootDir: outDir })
  const { config } = buildWranglerConfig({ core, records, resources, targetEnvironment: 'production' })

  const producers = config.queues?.producers ?? []
  assert.equal(producers.some(producer => producer.binding === 'PUSH_QUEUE'), false)
  assert.equal('ai' in config, false)
  const expectsJobs = records.some(record =>
    (record.manifest.resources?.queues ?? []).some(queue => queue.logicalResource === 'plugin-jobs')
  )
  assert.equal(producers.some(producer => producer.binding === 'PLUGIN_JOB_QUEUE'), expectsJobs)
  assert.deepEqual(config.triggers.crons, core.triggers.crons)
  for (const key of ['FIXTURE_PROJECT_ID', 'FIXTURE_CATEGORY', 'FIXTURE_TEAM_ID', 'FIXTURE_KEY_ID', 'FIXTURE_BUNDLE_ID']) {
    assert.equal(key in config.vars, false, `${key} must not survive the export removal`)
  }
  const example = readFileSync(path.join(outDir, 'template.toml'), 'utf8')
  assert.equal(example.includes('binding = "PUSH_QUEUE"'), false)
  assert.equal(example.includes('[ai]'), false)
})

test('removing an unknown package fails and lists the available packages', async t => {
  const parent = mkdtempSync(path.join(tmpdir(), 'woe-export-unknown-'))
  const outDir = path.join(parent, 'export')
  t.after(() => rmSync(parent, { recursive: true, force: true }))

  await assert.rejects(
    exportSourceTree({ rootDir: repositoryRoot, outDir, remove: ['not-a-package'] }),
    /not-a-package/
  )
  assert.equal(existsSync(path.join(outDir, 'package.json')), false)
})

test('the export target directory must not already exist', async t => {
  const outDir = mkdtempSync(path.join(tmpdir(), 'woe-export-exists-'))
  t.after(() => rmSync(outDir, { recursive: true, force: true }))

  await assert.rejects(
    exportSourceTree({ rootDir: repositoryRoot, outDir, remove: [] }),
    /exists/
  )
})
