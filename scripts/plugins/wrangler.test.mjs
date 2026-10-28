import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn, execFileSync } from 'node:child_process'
import { copyFileSync, cpSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { unstable_readConfig } from 'wrangler'
import { resolveWranglerEnvironment } from './wrangler.mjs'
import { assertGeneratedInputs } from './assertGenerated.mjs'
import { buildDeploymentFiles, loadCoreResources } from './resourceConfig.mjs'
import { generatePluginArtifacts } from './generate.mjs'

const repositoryRoot = fileURLToPath(new URL('../../', import.meta.url))
const wranglerBin = path.join(repositoryRoot, 'node_modules', 'wrangler', 'bin', 'wrangler.js')

const baseEnv = { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '' }

test('-e consumes the target environment and strips the flag pair', () => {
  const resolved = resolveWranglerEnvironment({ argv: ['deploy', '-e', 'staging', '--dry-run'], env: baseEnv })
  assert.equal(resolved.targetEnvironment, 'staging')
  assert.deepEqual(resolved.forwardedArgs, ['deploy', '--dry-run'])
  assert.equal('CLOUDFLARE_ENV' in resolved.childEnv, false)
})

test('--env and --env= forms behave like -e', () => {
  const spaced = resolveWranglerEnvironment({ argv: ['dev', '--env', 'staging'], env: baseEnv })
  assert.equal(spaced.targetEnvironment, 'staging')
  assert.deepEqual(spaced.forwardedArgs, ['dev'])

  const inline = resolveWranglerEnvironment({ argv: ['dev', '--env=staging'], env: baseEnv })
  assert.equal(inline.targetEnvironment, 'staging')
  assert.deepEqual(inline.forwardedArgs, ['dev'])

  const shortInline = resolveWranglerEnvironment({ argv: ['dev', '-e=staging'], env: baseEnv })
  assert.equal(shortInline.targetEnvironment, 'staging')
  assert.deepEqual(shortInline.forwardedArgs, ['dev'])
})

test('CLOUDFLARE_ENV is consumed when no CLI environment is passed', () => {
  const resolved = resolveWranglerEnvironment({
    argv: ['deploy'],
    env: { ...baseEnv, CLOUDFLARE_ENV: 'staging' }
  })
  assert.equal(resolved.targetEnvironment, 'staging')
  assert.equal('CLOUDFLARE_ENV' in resolved.childEnv, false)
  assert.equal(resolved.childEnv.HOME, baseEnv.HOME)
})

test('the default target environment is production', () => {
  const resolved = resolveWranglerEnvironment({ argv: ['deploy'], env: baseEnv })
  assert.equal(resolved.targetEnvironment, 'production')
})

test('repeated CLI environments with different values conflict', () => {
  assert.throws(
    () => resolveWranglerEnvironment({ argv: ['-e', 'staging', '--env', 'production'], env: baseEnv }),
    /staging.*production|production.*staging/s
  )
})

test('repeated CLI environments with the same value are not a conflict', () => {
  const resolved = resolveWranglerEnvironment({ argv: ['-e', 'staging', '--env=staging'], env: baseEnv })
  assert.equal(resolved.targetEnvironment, 'staging')
})

test('the CLI environment overrides CLOUDFLARE_ENV', () => {
  const resolved = resolveWranglerEnvironment({
    argv: ['deploy', '-e', 'staging'],
    env: { ...baseEnv, CLOUDFLARE_ENV: 'production' }
  })
  assert.equal(resolved.targetEnvironment, 'staging')
  assert.equal('CLOUDFLARE_ENV' in resolved.childEnv, false)
})

test('an explicit --config is reserved for the wrapper and must be rejected', () => {
  assert.throws(
    () => resolveWranglerEnvironment({ argv: ['deploy', '--config', 'other.toml'], env: baseEnv }),
    /--config/
  )
  assert.throws(
    () => resolveWranglerEnvironment({ argv: ['deploy', '--config=other.toml'], env: baseEnv }),
    /--config/
  )
})

test('unrelated flags survive the stripping untouched', () => {
  const resolved = resolveWranglerEnvironment({
    argv: ['versions', 'upload', '--dry-run', '--outdir', 'some-dir', '-e', 'staging'],
    env: baseEnv
  })
  assert.deepEqual(resolved.forwardedArgs, ['versions', 'upload', '--dry-run', '--outdir', 'some-dir'])
})

test('native wrangler through the official redirect rejects an environment mismatch', { timeout: 120000 }, async t => {
  const projectDir = await materializeRedirectProject(t, { targetEnvironment: 'staging' })

  const { code, output } = await runWrangler(projectDir, ['deploy', '--dry-run', '-e', 'production'])
  assert.notEqual(code, 0)
  assert.match(output, /does not match the target environment "staging"/)
})

test('native wrangler through the official redirect deploys the mapped worker name on a matching environment', { timeout: 120000 }, async t => {
  const projectDir = await materializeRedirectProject(t, { targetEnvironment: 'staging' })
  const outdir = path.join(projectDir, 'dry-run-out')

  const { code, output } = await runWrangler(projectDir, [
    'deploy',
    '--dry-run',
    '--env=staging',
    '--outdir',
    outdir
  ])
  assert.equal(code, 0, output)

  const readme = readFileSync(path.join(outdir, 'README.md'), 'utf8')
  assert.match(readme, /worker "woe-redirect-fixture-staging"/)
  assert.equal(readme.includes('woe-redirect-fixture-staging-staging'), false)


  assert.match(output, /env\.MARKER_VAR \("staging-8f3d"\).*Environment Variable/)
  assert.match(output, /env\.DB \(woe-staging-db\)/)
  assert.match(output, /env\.QUOTA_KV \(kv-staging-id\)/)
  assert.match(output, /env\.AI\b/)
  assert.match(output, /env\.PUSH_QUEUE \(woe-staging-push-queue\)/)
  assert.match(output, /env\.PLUGIN_JOB_QUEUE \(woe-staging-plugin-jobs\)/)
})

test('native wrangler through the official redirect never exposes production-only mappings on staging', { timeout: 120000 }, async t => {
  const projectDir = await materializeRedirectProject(t, { targetEnvironment: 'staging' })
  const outdir = path.join(projectDir, 'dry-run-out')

  const { code, output } = await runWrangler(projectDir, ['deploy', '--dry-run', '--env=staging', '--outdir', outdir])
  assert.equal(code, 0, output)
  assert.equal(output.includes('woe-push-queue"'), false)
  assert.equal(output.includes('woe-plugin-jobs"'), false)
  assert.equal(output.includes('production-8f3d'), false)
})

test('native wrangler without an environment flag consumes the fresh config as-is', { timeout: 120000 }, async t => {
  const projectDir = await materializeRedirectProject(t, { targetEnvironment: 'staging' })

  const { code } = await runWrangler(projectDir, ['deploy', '--dry-run'])
  assert.equal(code, 0)
})

test('native wrangler deploy fails through the custom build when the plugin fingerprint is stale', { timeout: 120000 }, async t => {
  const projectDir = await materializeRedirectProject(t, { targetEnvironment: 'staging' })


  const fresh = await runWrangler(projectDir, ['deploy', '--dry-run'])
  assert.equal(fresh.code, 0, fresh.output)
  assert.match(fresh.output, /plugin artifacts and deployment inputs are current/)


  const fingerprintFile = path.join(projectDir, '.plugin-generation.json')
  const fingerprint = JSON.parse(readFileSync(fingerprintFile, 'utf8'))
  writeFileSync(fingerprintFile, JSON.stringify({ ...fingerprint, fingerprint: '0'.repeat(64) }, null, 2))
  const stale = await runWrangler(projectDir, ['deploy', '--dry-run'])
  assert.notEqual(stale.code, 0)
  assert.match(stale.output, /npm run wrangler --/)
})

test('assertGeneratedInputs accepts fresh generation and rejects stale fingerprints', { timeout: 120000 }, async t => {
  const rootDir = mkdtempSync(path.join(tmpdir(), 'woe-assert-'))
  t.after(() => rmSync(rootDir, { recursive: true, force: true }))
  const { core, resources } = await materializeMinimalProject(rootDir, { targetEnvironment: 'production' })
  await generatePluginArtifacts({ rootDir, check: false })

  await assertGeneratedInputs({ rootDir, core, resources })


  const fingerprintFile = path.join(rootDir, '.plugin-generation.json')
  const fingerprint = JSON.parse(readFileSync(fingerprintFile, 'utf8'))
  writeFileSync(fingerprintFile, JSON.stringify({ ...fingerprint, fingerprint: '0'.repeat(64) }, null, 2))
  await assert.rejects(
    assertGeneratedInputs({ rootDir, core, resources }),
    /npm run wrangler --/
  )


  await generatePluginArtifacts({ rootDir, check: false })
  const generated = JSON.parse(readFileSync(path.join(rootDir, 'wrangler.generated.json'), 'utf8'))
  generated.vars.TAMPERED = 'yes'
  writeFileSync(path.join(rootDir, 'wrangler.generated.json'), JSON.stringify(generated, null, 2))
  await assert.rejects(assertGeneratedInputs({ rootDir, core, resources }), /stale/i)
})

test('standard npm entries route through the wrapper', () => {
  const packageJson = JSON.parse(readFileSync(path.join(repositoryRoot, 'package.json'), 'utf8'))
  assert.equal(packageJson.scripts.wrangler, 'node scripts/plugins/wrangler.mjs')
  for (const script of ['dev', 'deploy', 'build']) {
    assert.match(
      packageJson.scripts[script],
      /npm run wrangler --/,
      `script "${script}" must go through the wrangler wrapper`
    )
  }
})

test('watch passes its resolved target environment to the wrapper explicitly', () => {


  const source = readFileSync(path.join(repositoryRoot, 'scripts', 'plugins', 'watch.mjs'), 'utf8')
  assert.match(source, /\.\.\.wranglerArgs,\s*'-e',\s*targetEnvironment/)

  assert.match(source, /export function createDevSupervisor/)
})

test('the export default lockfile path runs regenerateLockfiles once per tree', () => {
  const source = readFileSync(path.join(repositoryRoot, 'scripts', 'plugins', 'export.mjs'), 'utf8')


  assert.match(source, /await regenerateLockfiles\(\{ rootDir: absoluteOut \}\)/)
  assert.doesNotMatch(source, /args, cwd\) => regenerateLockfiles/)
})


async function materializeRedirectProject(t, { targetEnvironment }) {
  const rootDir = mkdtempSync(path.join(tmpdir(), 'woe-redirect-'))
  t.after(() => rmSync(rootDir, { recursive: true, force: true }))
  const { core } = await materializeMinimalProject(rootDir, { targetEnvironment })
  await generatePluginArtifacts({ rootDir, check: false })


  cpSync(path.join(repositoryRoot, 'scripts/plugins'), path.join(rootDir, 'scripts/plugins'), { recursive: true })
  writeFileSync(path.join(rootDir, 'scripts/plugins/coreResources.json'), `${JSON.stringify(core, null, 2)}\n`)
  return rootDir
}





const fixturePackages = [
  {
    slug: 'push-like',
    resources: {
      queues: [
        { logicalResource: 'push', producerBinding: 'PUSH_QUEUE', consumer: { maxBatchSize: 50, maxBatchTimeout: 5, maxRetries: 3 } }
      ]
    }
  },
  {
    slug: 'task-like',
    resources: {
      queues: [
        { logicalResource: 'plugin-jobs', producerBinding: 'PLUGIN_JOB_QUEUE', consumer: { maxBatchSize: 1, maxBatchTimeout: 5, maxRetries: 2, maxConcurrency: 1 } }
      ]
    }
  },
  {
    slug: 'ai-like',
    resources: {
      bindings: [{ name: 'AI', kind: 'ai', logicalResource: 'ai', required: false, shared: false }]
    }
  }
]

async function materializeMinimalProject(rootDir, { targetEnvironment }) {
  mkdirSync(path.join(rootDir, 'src'), { recursive: true })
  writeFileSync(
    path.join(rootDir, 'src', 'index.ts'),
    "export default { fetch() { return new Response('ok') } }\n"
  )
  writeFileSync(path.join(rootDir, 'package.json'), JSON.stringify({ name: 'woe-redirect-fixture', private: true }, null, 2))
  for (const { slug, resources } of fixturePackages) {
    const packageDir = path.join(rootDir, 'src/plugins/builtin', slug)
    mkdirSync(packageDir, { recursive: true })
    writeFileSync(
      path.join(packageDir, 'plugin.json'),
      JSON.stringify(
        {
          modulePath: `builtin/${slug}`,
          name: `${slug} fixture`,
          capabilities: ['test'],
          author: 'qzcrown',
          license: 'GPL-3.0-only',
          website: 'https://github.com/qzcrown/woe',
          resources
        },
        null,
        2
      )
    )
  }

  const core = loadCoreResources()
  const resources = {
    environments: {
      [targetEnvironment]: {
        workerName: `woe-redirect-fixture-${targetEnvironment}`,
        vars: { MARKER_VAR: `${targetEnvironment}-8f3d` },
        resources: {
          d1: { db: { databaseName: `woe-${targetEnvironment}-db`, databaseId: `d1-${targetEnvironment}-id` } },
          kv: { 'quota-kv': { id: `kv-${targetEnvironment}-id` } },
          ai: { ai: {} }
        },
        queues: {
          push: { name: `woe-${targetEnvironment}-push-queue` },
          'plugin-jobs': { name: `woe-${targetEnvironment}-plugin-jobs` }
        }
      }
    }
  }


  writeFileSync(
    path.join(rootDir, 'resources.json'),
    JSON.stringify(resources, null, 2)
  )
  const minimalCore = {
    ...core,
    assets: undefined,
    build: { command: 'node scripts/plugins/assertGenerated.mjs' },
    bindings: [
      { name: 'DB', kind: 'd1', logicalResource: 'db', required: true, shared: true },
      { name: 'QUOTA_KV', kind: 'kv', logicalResource: 'quota-kv', required: true, shared: true }
    ],
    secrets: [],
    durableObjectMigrations: [],
    rules: [],
    triggers: { crons: [] }
  }
  const records = (await import('./discovery.mjs')).discoverPluginPackageRecords({ rootDir, packageRoot: 'src/plugins/builtin' })
  const { files } = buildDeploymentFiles({ core: minimalCore, records, resources, targetEnvironment })
  for (const [file, contents] of Object.entries(files)) {
    mkdirSync(path.join(rootDir, path.dirname(file)), { recursive: true })
    writeFileSync(path.join(rootDir, file), contents)
  }
  return { core: minimalCore, resources }
}

function runWrangler(cwd, args) {
  return new Promise(resolve => {
    const child = spawn(process.execPath, [wranglerBin, ...args], {
      cwd,
      env: { ...baseEnv, CI: 'true', WRANGLER_SEND_METRICS: 'false', NO_COLOR: '1' },
      stdio: ['ignore', 'pipe', 'pipe']
    })
    let output = ''
    for (const stream of [child.stdout, child.stderr]) {
      stream.on('data', chunk => {
        output += chunk
      })
    }
    child.once('error', error => resolve({ code: -1, output: `${output}\n${error.message}` }))
    child.once('close', code => resolve({ code: code ?? -1, output }))
  })
}

test('D1, Secret and tail explicitly select the generated config; dev/deploy retain redirect', () => {
  for (const command of [['d1', 'execute', 'woe-staging-db'], ['secret', 'list'], ['tail']]) {
    const { forwardedArgs } = resolveWranglerEnvironment({ argv: [...command, '-e', 'staging'], env: baseEnv, cwd: '/tmp/woe-target-fixture' })
    assert.deepEqual(forwardedArgs, [...command, '--config', '/tmp/woe-target-fixture/wrangler.generated.json'])
  }
  for (const command of ['dev', 'deploy']) {
    const { forwardedArgs } = resolveWranglerEnvironment({ argv: [command, '-e', 'staging'], env: baseEnv })
    assert.deepEqual(forwardedArgs, [command])
  }
})

test('all short config overrides are rejected', () => {
  for (const flag of ['-c', '-c=legacy.toml', '-clegacy.toml']) {
    assert.throws(() => resolveWranglerEnvironment({ argv: ['d1', 'execute', 'DB', flag, 'legacy.toml'], env: baseEnv }), /config/)
  }
})

test('deployment D1 name is read from the generated DB binding and conflicting overrides fail', t => {
  const cwd = mkdtempSync(path.join(tmpdir(), 'woe-d1-target-'))
  t.after(() => rmSync(cwd, { recursive: true, force: true }))
  writeFileSync(path.join(cwd, 'wrangler.generated.json'), JSON.stringify({ name: 'woe-staging', d1_databases: [{ binding: 'DB', database_name: 'woe-staging-db' }] }))
  writeFileSync(path.join(cwd, 'wrangler.toml'), 'name="legacy"\n')
  const script = readFileSync(path.join(repositoryRoot, 'scripts/deploy-with-migration.sh'), 'utf8')
  const body = script.split('# === D1 TARGET START ===')[1].split('# === D1 TARGET END ===')[0]
  const snippet = `set -e\n${body}\nprintf '%s' "$D1_NAME"`
  for (const override of ['', 'woe-staging-db']) {
    assert.equal(execFileSync('bash', ['-c', snippet], { cwd, env: { ...process.env, WOE_D1_NAME: override }, encoding: 'utf8' }), 'woe-staging-db')
  }
  assert.throws(() => execFileSync('bash', ['-c', snippet], { cwd, env: { ...process.env, WOE_D1_NAME: 'woe-db' }, stdio: 'pipe' }), /Command failed/)
})

test('wrapper rejects cwd overrides and command-leading global options before target selection', () => {
  for (const argv of [
    ['--cwd', '.', 'secret', 'put', 'DEFAULT_ADMIN_PASSWORD', '-e', 'staging'],
    ['secret', 'list', '--cwd=../legacy', '-e', 'staging'],
    ['dev', '--cwd', '../legacy'],
    ['--log-level', 'debug', 'd1', 'execute', 'DB', '-e', 'staging']
  ]) {
    assert.throws(() => resolveWranglerEnvironment({ argv, env: baseEnv, cwd: '/tmp/woe-target-fixture' }), /cwd|command before options/)
  }
  const safe = resolveWranglerEnvironment({ argv: ['-e', 'staging', 'secret', 'list', '--log-level', 'debug'], env: baseEnv, cwd: '/tmp/woe-target-fixture' })
  assert.deepEqual(safe.forwardedArgs, ['secret', 'list', '--log-level', 'debug', '--config', '/tmp/woe-target-fixture/wrangler.generated.json'])
})

test('ops commands parse the generated staging config locally before dispatch', () => {
  const cwd = mkdtempSync(path.join(tmpdir(), 'woe-config-parse-'))
  const generated = {
    name: 'woe-staging',
    targetEnvironment: 'staging',
    vars: { ENVIRONMENT: 'staging' },
    d1_databases: [{ binding: 'DB', database_name: 'woe-staging-db', database_id: 'fixture-id' }]
  }
  writeFileSync(path.join(cwd, 'wrangler.generated.json'), JSON.stringify(generated))

  writeFileSync(path.join(cwd, 'wrangler.toml'), [
    'name = "legacy-worker"',
    '[[d1_databases]]',
    'binding = "DB"',
    'database_name = "legacy-db"',
    'database_id = "legacy-id"',
    ''
  ].join('\n'))
  try {
    const legacyConfig = unstable_readConfig({ config: path.join(cwd, 'wrangler.toml') }, { hideWarnings: true })
    assert.equal(legacyConfig.name, 'legacy-worker')
    assert.equal(legacyConfig.d1_databases?.[0]?.database_name, 'legacy-db')
    for (const command of [['d1', 'execute', 'DB'], ['secret', 'list'], ['tail']]) {
      const resolved = resolveWranglerEnvironment({ argv: [...command, '-e', 'staging'], env: baseEnv, cwd })
      const configPath = resolved.forwardedArgs.at(-1)
      assert.equal(configPath, path.join(cwd, 'wrangler.generated.json'))
      const parsed = JSON.parse(readFileSync(configPath, 'utf8'))
      assert.equal(parsed.targetEnvironment, 'staging')
      assert.equal(parsed.name, 'woe-staging')
      assert.equal(parsed.d1_databases[0].database_name, 'woe-staging-db')
      const resolvedConfig = unstable_readConfig({ config: configPath }, { hideWarnings: true })
      assert.equal(resolvedConfig.name, 'woe-staging')
      assert.equal(resolvedConfig.d1_databases?.[0]?.database_name, 'woe-staging-db')
    }
  } finally {
    rmSync(cwd, { recursive: true, force: true })
  }
})
