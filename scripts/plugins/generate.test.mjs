import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  symlinkSync,
  utimesSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { generatePluginArtifacts } from './generate.mjs'

const outputFiles = [
  '.plugin-generation.json',
  'frontend/src/generated/plugins/catalog.ts',
  'frontend/src/generated/plugins/locales.ts',
  'frontend/src/generated/plugins/ui.ts',
  'src/generated/plugins/catalog.ts',
  'src/generated/plugins/server.ts'
]

function makeRoot(t) {
  const rootDir = mkdtempSync(path.join(tmpdir(), 'woe-plugin-generation-'))
  t.after(() => rmSync(rootDir, { recursive: true, force: true }))
  mkdirSync(path.join(rootDir, 'src/plugins/builtin'), { recursive: true })
  return rootDir
}

function writePackage(rootDir, slug, overrides = {}) {
  const packageDir = path.join(rootDir, 'src/plugins/builtin', slug)
  mkdirSync(packageDir, { recursive: true })
  const manifest = {
    modulePath: `builtin/${slug}`,
    name: slug,
    capabilities: ['test'],
    author: 'qzcrown',
    license: 'GPL-3.0-only',
    website: 'https://github.com/qzcrown/woe',
    backend: {
      event: { entry: 'index.ts', export: `create${slug[0].toUpperCase()}${slug.slice(1)}` }
    },
    ...overrides
  }
  writeFileSync(path.join(packageDir, 'plugin.json'), `${JSON.stringify(manifest, null, 2)}\n`)
  writeFileSync(path.join(packageDir, 'index.ts'), `export function ${manifest.backend.event.export}() {}\n`)
  return packageDir
}

function listFiles(rootDir, relativeDir) {
  const absoluteDir = path.join(rootDir, relativeDir)
  if (!existsSync(absoluteDir)) return []
  const files = []
  const visit = (directory, prefix = '') => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name
      if (entry.isDirectory()) visit(path.join(directory, entry.name), relativePath)
      else files.push(path.posix.join(relativeDir, relativePath))
    }
  }
  visit(absoluteDir)
  return files
}

function snapshotOutputs(rootDir, withMetadata = false) {
  const files = [
    ...(existsSync(path.join(rootDir, '.plugin-generation.json')) ? ['.plugin-generation.json'] : []),
    ...listFiles(rootDir, 'src/generated/plugins'),
    ...listFiles(rootDir, 'frontend/src/generated/plugins'),
    ...listFiles(rootDir, 'frontend/public/generated-plugins')
  ].sort()
  return Object.fromEntries(files.map(relativePath => {
    const absolutePath = path.join(rootDir, relativePath)
    const contents = readFileSync(absolutePath)
    const value = withMetadata
      ? { hash: createHash('sha256').update(contents).digest('hex'), mtimeMs: statSync(absolutePath).mtimeMs }
      : createHash('sha256').update(contents).digest('hex')
    return [relativePath, value]
  }))
}

test('an empty package root generates valid deterministic empty catalogs', async t => {
  const rootDir = makeRoot(t)
  const first = await generatePluginArtifacts({ rootDir })
  const firstSnapshot = snapshotOutputs(rootDir)
  const second = await generatePluginArtifacts({ rootDir })

  assert.deepEqual(first.modules, [])
  assert.deepEqual(second.modules, [])
  assert.equal(first.fingerprint, second.fingerprint)
  assert.deepEqual(first.files, outputFiles)
  assert.deepEqual(second.files, outputFiles)
  assert.deepEqual(snapshotOutputs(rootDir), firstSnapshot)
  assert.match(first.fingerprint, /^[a-f0-9]{64}$/)
  assert.deepEqual(JSON.parse(readFileSync(path.join(rootDir, '.plugin-generation.json'), 'utf8')).modules, [])
  for (const relativePath of outputFiles) {
    assert.ok(readFileSync(path.join(rootDir, relativePath), 'utf8').includes(first.fingerprint))
  }
})

test('unchanged inputs skip rewriting generated artifacts', async t => {
  const rootDir = makeRoot(t)
  writePackage(rootDir, 'alpha')
  await generatePluginArtifacts({ rootDir })

  const frozen = new Date('2000-01-01T00:00:00.000Z')
  for (const relativePath of Object.keys(snapshotOutputs(rootDir))) {
    utimesSync(path.join(rootDir, relativePath), frozen, frozen)
  }
  const before = snapshotOutputs(rootDir, true)

  const result = await generatePluginArtifacts({ rootDir })

  assert.deepEqual(result.files, outputFiles)
  assert.deepEqual(snapshotOutputs(rootDir, true), before)
})

test('deleting a package removes its imports and every stale generated file', async t => {
  const rootDir = makeRoot(t)
  writePackage(rootDir, 'alpha')
  writePackage(rootDir, 'beta')
  const initial = await generatePluginArtifacts({ rootDir })
  assert.deepEqual(initial.modules, ['builtin/alpha', 'builtin/beta'])

  writeFileSync(path.join(rootDir, 'src/generated/plugins/stale.ts'), 'ghost')
  writeFileSync(path.join(rootDir, 'frontend/src/generated/plugins/stale.ts'), 'ghost')
  mkdirSync(path.join(rootDir, 'frontend/public/generated-plugins'), { recursive: true })
  writeFileSync(path.join(rootDir, 'frontend/public/generated-plugins/stale.js'), 'ghost')
  rmSync(path.join(rootDir, 'src/plugins/builtin/beta'), { recursive: true })

  const result = await generatePluginArtifacts({ rootDir })
  assert.deepEqual(result.modules, ['builtin/alpha'])
  assert.equal(existsSync(path.join(rootDir, 'src/generated/plugins/stale.ts')), false)
  assert.equal(existsSync(path.join(rootDir, 'frontend/src/generated/plugins/stale.ts')), false)
  assert.equal(existsSync(path.join(rootDir, 'frontend/public/generated-plugins/stale.js')), false)
  for (const relativePath of outputFiles) {
    const contents = readFileSync(path.join(rootDir, relativePath), 'utf8')
    assert.equal(contents.includes('builtin/beta'), false, relativePath)
    assert.equal(contents.includes('ghost'), false, relativePath)
  }
})

test('check mode accepts current outputs without rewriting them', async t => {
  const rootDir = makeRoot(t)
  writePackage(rootDir, 'alpha')
  const generated = await generatePluginArtifacts({ rootDir })
  const before = snapshotOutputs(rootDir, true)

  const checked = await generatePluginArtifacts({ rootDir, check: true })
  assert.equal(checked.fingerprint, generated.fingerprint)
  assert.deepEqual(checked.files, generated.files)
  assert.deepEqual(snapshotOutputs(rootDir, true), before)
})

test('check mode rejects missing and changed outputs without repairing them', async t => {
  const rootDir = makeRoot(t)
  writePackage(rootDir, 'alpha')
  await assert.rejects(generatePluginArtifacts({ rootDir, check: true }), /stale|missing|outdated/i)
  assert.deepEqual(snapshotOutputs(rootDir), {})

  await generatePluginArtifacts({ rootDir })
  const catalogPath = path.join(rootDir, 'src/generated/plugins/catalog.ts')
  writeFileSync(catalogPath, '// stale catalog\n')
  const before = snapshotOutputs(rootDir, true)
  await assert.rejects(generatePluginArtifacts({ rootDir, check: true }), /stale|outdated/i)
  assert.deepEqual(snapshotOutputs(rootDir, true), before)

  await generatePluginArtifacts({ rootDir })
  assert.ok(readFileSync(catalogPath, 'utf8').includes('builtin/alpha'))
})

test('check mode rejects an otherwise-current output tree with only an extra file', async t => {
  const rootDir = makeRoot(t)
  writePackage(rootDir, 'alpha')
  await generatePluginArtifacts({ rootDir })
  const extraPath = path.join(rootDir, 'src/generated/plugins/extra.ts')
  writeFileSync(extraPath, '// stale extra\n')
  const before = snapshotOutputs(rootDir, true)

  await assert.rejects(generatePluginArtifacts({ rootDir, check: true }), /extra.*stale|stale.*extra/i)
  assert.deepEqual(snapshotOutputs(rootDir, true), before)
})

test('validation completes before any existing output is replaced', async t => {
  const rootDir = makeRoot(t)
  writePackage(rootDir, 'alpha')
  await generatePluginArtifacts({ rootDir })
  const before = snapshotOutputs(rootDir, true)

  const brokenDir = path.join(rootDir, 'src/plugins/builtin/broken')
  mkdirSync(brokenDir)
  writeFileSync(path.join(brokenDir, 'plugin.json'), JSON.stringify({
    modulePath: 'builtin/broken',
    name: 'broken',
    capabilities: ['test'],
    author: 'qzcrown',
    license: 'GPL-3.0-only',
    website: 'https://github.com/qzcrown/woe',
    backend: { event: { entry: 'missing.ts', export: 'missing' } }
  }))
  await assert.rejects(generatePluginArtifacts({ rootDir }), /broken.*backend\.event\.entry/s)
  assert.deepEqual(snapshotOutputs(rootDir, true), before)
})

for (const [field, value] of [
  ['secretFields', ['NESTED_SECRET']],
  ['resources', { nested: 'server-only' }],
  ['dependencies', { root: { dependencies: { private: '1.0.0' } } }]
]) {
  test(`server-only frontend.${field} is rejected before outputs are replaced`, async t => {
    const rootDir = makeRoot(t)
    writePackage(rootDir, 'alpha')
    await generatePluginArtifacts({ rootDir })
    const before = snapshotOutputs(rootDir, true)
    writePackage(rootDir, 'broken', { frontend: { [field]: value } })

    await assert.rejects(
      generatePluginArtifacts({ rootDir }),
      new RegExp(`broken.*frontend\\.${field}`)
    )
    assert.deepEqual(snapshotOutputs(rootDir, true), before)
  })
}

for (const [field, value] of [
  ['allowQuery', 'false'],
  ['allowHttp', 1],
  ['allowPrivateNetwork', 'true']
]) {
  test(`invalid backend.task.outbound.${field} fails before outputs are replaced`, async t => {
    const rootDir = makeRoot(t)
    writePackage(rootDir, 'alpha')
    await generatePluginArtifacts({ rootDir })
    const before = snapshotOutputs(rootDir, true)
    writePackage(rootDir, 'broken', {
      backend: {
        event: { entry: 'index.ts', export: 'createBroken' },
        task: {
          entry: 'index.ts',
          staticExport: 'createStatic',
          runtimeExport: 'createRuntime',
          supportedSubjectTypes: ['message'],
          outbound: { [field]: value }
        }
      }
    })

    await assert.rejects(
      generatePluginArtifacts({ rootDir }),
      new RegExp(`broken.*backend\\.task\\.outbound\\.${field}`)
    )
    assert.deepEqual(snapshotOutputs(rootDir, true), before)
  })
}

test('browser artifacts contain only public metadata and share the server fingerprint', async t => {
  const rootDir = makeRoot(t)
  writePackage(rootDir, 'alpha', {
    config: { secretFields: ['apiKey'], errorDescription: 'server-only-error' },
    resources: { secrets: [{ name: 'PRIVATE_SECRET', required: true, shared: false, purpose: 'test' }] },
    dependencies: { root: { dependencies: { private: '1.0.0' } } },
    backend: {
      event: { entry: 'index.ts', export: 'createAlpha' },
      task: {
        entry: 'index.ts',
        staticExport: 'createStatic',
        runtimeExport: 'createRuntime',
        supportedSubjectTypes: ['message'],
        quotaNamespace: 'quota'
      },
      push: { entry: 'index.ts', export: 'definition', platform: 'vendor' }
    },
    frontend: { clientPlatformLabels: { vendor: 'Vendor' } }
  })
  const result = await generatePluginArtifacts({ rootDir })
  const browserCatalog = readFileSync(path.join(rootDir, 'frontend/src/generated/plugins/catalog.ts'), 'utf8')
  const serverCatalog = readFileSync(path.join(rootDir, 'src/generated/plugins/catalog.ts'), 'utf8')

  assert.ok(browserCatalog.includes('builtin/alpha'))
  assert.ok(browserCatalog.includes('quota'))
  assert.ok(browserCatalog.includes('vendor'))
  for (const forbidden of ['apiKey', 'PRIVATE_SECRET', 'server-only-error', 'private', 'createAlpha']) {
    assert.equal(browserCatalog.includes(forbidden), false, forbidden)
  }
  assert.ok(serverCatalog.includes('apiKey'))
  assert.ok(serverCatalog.includes('PRIVATE_SECRET'))
})

test('UI editors and locale modules resolve entries within the generated root', async t => {
  const rootDir = makeRoot(t)
  const packageDir = writePackage(rootDir, 'alpha', {
    frontend: {
      configEditor: 'frontend/ConfigEditor.vue',
      locales: { 'en-US': 'locales/en-US.ts' }
    }
  })
  mkdirSync(path.join(packageDir, 'frontend'), { recursive: true })
  mkdirSync(path.join(packageDir, 'locales'), { recursive: true })
  writeFileSync(path.join(packageDir, 'frontend/ConfigEditor.vue'), '<template />')
  writeFileSync(path.join(packageDir, 'locales/en-US.ts'), 'export default {}')

  await generatePluginArtifacts({ rootDir })
  const ui = readFileSync(path.join(rootDir, 'frontend/src/generated/plugins/ui.ts'), 'utf8')
  const locales = readFileSync(path.join(rootDir, 'frontend/src/generated/plugins/locales.ts'), 'utf8')
  assert.ok(ui.includes('"../../../../src/plugins/builtin/alpha/frontend/ConfigEditor.vue"'))
  assert.ok(locales.includes('"../../../../src/plugins/builtin/alpha/locales/en-US.ts"'))
})

test('locale contributions are projected as synchronous imports for deep merging', async t => {
  const rootDir = makeRoot(t)
  const packageDir = writePackage(rootDir, 'alpha', {
    frontend: { locales: { 'en-US': 'locales/en-US.ts', 'zh-CN': 'locales/zh-CN.ts' } }
  })
  mkdirSync(path.join(packageDir, 'locales'), { recursive: true })
  writeFileSync(path.join(packageDir, 'locales/en-US.ts'), "export default { pluginDetail: { ai: { title: 'AI' } } }\n")
  writeFileSync(path.join(packageDir, 'locales/zh-CN.ts'), "export default { pluginDetail: { ai: { title: 'AI' } } }\n")

  await generatePluginArtifacts({ rootDir })
  const locales = readFileSync(path.join(rootDir, 'frontend/src/generated/plugins/locales.ts'), 'utf8')
  assert.match(locales, /import pluginLocale\d+ from "\.\.\/\.\.\/\.\.\/\.\.\/src\/plugins\/builtin\/alpha\/locales\/en-US\.ts"/)
  assert.match(locales, /"en-US": \[\n    pluginLocale\d+\n  \]/)
  assert.equal(locales.includes('() => import('), false)
})

test('locale keys duplicating the core frontend locale fail at generation time', async t => {
  const rootDir = makeRoot(t)
  mkdirSync(path.join(rootDir, 'frontend/src/locales'), { recursive: true })
  writeFileSync(path.join(rootDir, 'frontend/src/locales/en-US.ts'), "export default { pluginDetail: { title: 'core' } }\n")
  writeFileSync(path.join(rootDir, 'frontend/src/locales/zh-CN.ts'), "export default { pluginDetail: { title: 'core' } }\n")
  const packageDir = writePackage(rootDir, 'alpha', {
    frontend: { locales: { 'en-US': 'locales/en-US.ts' } }
  })
  mkdirSync(path.join(packageDir, 'locales'), { recursive: true })
  writeFileSync(path.join(packageDir, 'locales/en-US.ts'), "export default { pluginDetail: { title: 'plugin' } }\n")

  await assert.rejects(
    generatePluginArtifacts({ rootDir }),
    /alpha.*frontend\.locales\.en-US.*pluginDetail\.title.*duplicates the core frontend locale/s
  )
  assert.equal(existsSync(path.join(rootDir, 'frontend/src/generated/plugins/locales.ts')), false)
})

test('locale keys duplicated across packages fail at generation time', async t => {
  const rootDir = makeRoot(t)
  for (const slug of ['alpha', 'beta']) {
    const packageDir = writePackage(rootDir, slug, {
      frontend: { locales: { 'en-US': 'locales/en-US.ts' } }
    })
    mkdirSync(path.join(packageDir, 'locales'), { recursive: true })
    writeFileSync(path.join(packageDir, 'locales/en-US.ts'), "export default { pluginNamespace: { title: 'same' } }\n")
  }

  await assert.rejects(
    generatePluginArtifacts({ rootDir }),
    /beta.*frontend\.locales\.en-US.*pluginNamespace\.title.*duplicates package "alpha"/s
  )
  assert.equal(existsSync(path.join(rootDir, 'frontend/src/generated/plugins/locales.ts')), false)
})

test('non-object locale modules fail at generation time', async t => {
  const rootDir = makeRoot(t)
  const packageDir = writePackage(rootDir, 'alpha', {
    frontend: { locales: { 'en-US': 'locales/en-US.ts' } }
  })
  mkdirSync(path.join(packageDir, 'locales'), { recursive: true })
  writeFileSync(path.join(packageDir, 'locales/en-US.ts'), 'export default []\n')

  await assert.rejects(
    generatePluginArtifacts({ rootDir }),
    /alpha.*frontend\.locales\.en-US.*must default-export a message object/s
  )
})

test('declared package assets are copied into the public generation root', async t => {
  const rootDir = makeRoot(t)
  const packageDir = writePackage(rootDir, 'alpha', {
    assets: 'assets'
  })
  mkdirSync(path.join(packageDir, 'assets/icons'), { recursive: true })
  writeFileSync(path.join(packageDir, 'assets/logo.svg'), '<svg>alpha</svg>')
  writeFileSync(path.join(packageDir, 'assets/icons/marker.png'), 'png-bytes')

  const result = await generatePluginArtifacts({ rootDir })
  const publicRoot = 'frontend/public/generated-plugins'
  assert.deepEqual(
    listFiles(rootDir, `${publicRoot}/alpha`).sort(),
    [`${publicRoot}/alpha/icons/marker.png`, `${publicRoot}/alpha/logo.svg`]
  )
  assert.equal(readFileSync(path.join(rootDir, `${publicRoot}/alpha/logo.svg`), 'utf8'), '<svg>alpha</svg>')
  assert.ok(result.files.includes(`${publicRoot}/alpha/logo.svg`))
  assert.ok(result.files.includes(`${publicRoot}/alpha/icons/marker.png`))
  const fingerprint = JSON.parse(readFileSync(path.join(rootDir, '.plugin-generation.json'), 'utf8'))
  assert.ok(fingerprint.files.includes(`${publicRoot}/alpha/icons/marker.png`))
  await generatePluginArtifacts({ rootDir, check: true })
})

test('a single-file assets declaration is copied under the package slug', async t => {
  const rootDir = makeRoot(t)
  const packageDir = writePackage(rootDir, 'alpha', { assets: 'assets/banner.png' })
  mkdirSync(path.join(packageDir, 'assets'), { recursive: true })
  writeFileSync(path.join(packageDir, 'assets/banner.png'), 'banner')

  await generatePluginArtifacts({ rootDir })
  const publicRoot = 'frontend/public/generated-plugins'
  assert.deepEqual(listFiles(rootDir, `${publicRoot}/alpha`), [`${publicRoot}/alpha/banner.png`])
})

test('removing the assets declaration clears stale public copies on the next run', async t => {
  const rootDir = makeRoot(t)
  const packageDir = writePackage(rootDir, 'alpha', { assets: 'assets' })
  mkdirSync(path.join(packageDir, 'assets'), { recursive: true })
  writeFileSync(path.join(packageDir, 'assets/logo.svg'), '<svg>alpha</svg>')
  await generatePluginArtifacts({ rootDir })

  writePackage(rootDir, 'alpha', {})
  const result = await generatePluginArtifacts({ rootDir })
  assert.equal(existsSync(path.join(rootDir, 'frontend/public/generated-plugins/alpha')), false)
  assert.equal(result.files.includes('frontend/public/generated-plugins/alpha/logo.svg'), false)
})

test('symlinks inside a declared assets directory fail generation before outputs are replaced', async t => {
  const rootDir = makeRoot(t)
  const packageDir = writePackage(rootDir, 'alpha', { assets: 'assets' })
  mkdirSync(path.join(packageDir, 'assets'), { recursive: true })
  writeFileSync(path.join(packageDir, 'assets/real.svg'), '<svg />')
  await generatePluginArtifacts({ rootDir })
  const before = snapshotOutputs(rootDir, true)

  symlinkSync('real.svg', path.join(packageDir, 'assets/linked.svg'))

  await assert.rejects(
    generatePluginArtifacts({ rootDir }),
    /alpha.*assets.*symlink.*linked\.svg/s
  )
  assert.deepEqual(snapshotOutputs(rootDir, true), before)
})

for (const owner of ['core', 'package']) {
  for (const [earlier, later] of [
    [{ common: { save: 'Save' } }, { common: 'Oops' }],
    [{ common: 'Oops' }, { common: { save: 'Save' } }],
    [{ common: { save: 'Save' } }, { common: [] }],
    [{ common: [] }, { common: { save: 'Save' } }]
  ]) {
    test(`locale parent/leaf conflict with ${owner}: ${JSON.stringify(earlier)}`, async t => {
      const rootDir = makeRoot(t)
      let earlierDir
      if (owner === 'core') earlierDir = path.join(rootDir, 'frontend/src/locales')
      else earlierDir = path.join(writePackage(rootDir, 'alpha', { frontend: { locales: { 'en-US': 'locales/en-US.ts' } } }), 'locales')
      mkdirSync(earlierDir, { recursive: true })
      writeFileSync(path.join(earlierDir, 'en-US.ts'), `export default ${JSON.stringify(earlier)}`)
      const laterDir = path.join(writePackage(rootDir, 'beta', { frontend: { locales: { 'en-US': 'locales/en-US.ts' } } }), 'locales')
      mkdirSync(laterDir, { recursive: true })
      writeFileSync(path.join(laterDir, 'en-US.ts'), `export default ${JSON.stringify(later)}`)
      await assert.rejects(generatePluginArtifacts({ rootDir }), /beta.*en-US.*common.*conflict/s)
    })
  }
}

test('disjoint children of a shared object namespace merge safely', async t => {
  const rootDir = makeRoot(t)
  mkdirSync(path.join(rootDir, 'frontend/src/locales'), { recursive: true })
  writeFileSync(path.join(rootDir, 'frontend/src/locales/en-US.ts'), 'export default { pluginDetail: { title: "Core" } }')
  for (const slug of ['alpha', 'beta']) {
    const directory = path.join(writePackage(rootDir, slug, { frontend: { locales: { 'en-US': 'locales/en-US.ts' } } }), 'locales')
    mkdirSync(directory, { recursive: true })
    writeFileSync(path.join(directory, 'en-US.ts'), `export default { pluginDetail: { ${slug}: { title: "Plugin" } } }`)
  }
  await generatePluginArtifacts({ rootDir })
})

test('interrupted generator keeps scratch outside source and supports serial cleanup/rebuild', async t => {
  const rootDir = makeRoot(t)
  writePackage(rootDir, 'alpha')
  await generatePluginArtifacts({ rootDir })

  writeFileSync(path.join(rootDir, 'src/generated/plugins/catalog.ts'), 'stale')
  const crash = spawnSync(process.execPath, ['--input-type=module', '-e', `
    import fs from 'node:fs';
    import { syncBuiltinESMExports } from 'node:module';
    const rename = fs.renameSync;
    fs.renameSync = (from, to) => { rename(from, to); if (to.includes('.backup-')) process.exit(77) };
    syncBuiltinESMExports();
    const { generatePluginArtifacts } = await import(process.argv[1]);
    await generatePluginArtifacts({ rootDir: process.argv[2] });
  `, new URL('./generate.mjs', import.meta.url).href, rootDir])
  assert.equal(crash.status, 77, crash.stderr?.toString())
  const sourceFiles = [...listFiles(rootDir, 'src'), ...listFiles(rootDir, 'frontend/src')]
  assert.equal(sourceFiles.some(file => /\.(tmp|backup)-/.test(file)), false)

  rmSync(path.join(rootDir, '.plugin-tmp'), { recursive: true, force: true })
  await generatePluginArtifacts({ rootDir })
  await generatePluginArtifacts({ rootDir, check: true })
  assert.equal(listFiles(rootDir, '.plugin-tmp').length, 0)
})
