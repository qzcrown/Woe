import test from 'node:test'
import assert from 'node:assert/strict'
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  buildDeploymentFiles,
  buildWranglerConfig,
  loadCoreResources,
  loadOpsResources,
  renderWranglerExample
} from './resourceConfig.mjs'
import { discoverPluginPackageRecords } from './discovery.mjs'

const repositoryRoot = fileURLToPath(new URL('../../', import.meta.url))

const fixtureMetadata = {
  name: 'fixture',
  capabilities: ['test'],
  author: 'qzcrown',
  license: 'GPL-3.0-only',
  website: 'https://github.com/qzcrown/woe'
}

function record(slug, resources) {
  return {
    slug,
    packageDir: path.join(repositoryRoot, 'src/plugins/builtin', slug),
    manifest: { modulePath: `builtin/${slug}`, ...fixtureMetadata, ...(resources ? { resources } : {}) }
  }
}

const pushQueueFragment = (consumer = { maxBatchSize: 50, maxBatchTimeout: 5, maxRetries: 3 }) => ({
  queues: [{ logicalResource: 'push', producerBinding: 'PUSH_QUEUE', consumer }]
})
const jobsQueueFragment = (
  consumer = { maxBatchSize: 1, maxBatchTimeout: 5, maxRetries: 2, maxConcurrency: 1 }
) => ({ queues: [{ logicalResource: 'plugin-jobs', producerBinding: 'PLUGIN_JOB_QUEUE', consumer }] })

function fixtureResources() {
  return {
    environments: {
      production: {
        workerName: 'woe-prod',
        vars: { ENVIRONMENT: 'production' },
        resources: {
          d1: { db: { databaseName: 'woe-db', databaseId: 'd1-id' } },
          r2: { storage: { bucketName: 'woe-storage' } },
          kv: { 'quota-kv': { id: 'kv-id' }, shared: { id: 'shared-kv-id' } },
          ai: { ai: {} }
        },
        queues: {
          push: { name: 'woe-push-queue' },
          'plugin-jobs': { name: 'woe-plugin-jobs' }
        }
      },
      staging: {
        workerName: 'woe-staging',
        vars: { ENVIRONMENT: 'staging', STAGING_ONLY: 'yes' },
        resources: {
          d1: { db: { databaseName: 'woe-staging-db', databaseId: 'd1-staging-id' } },
          r2: { storage: { bucketName: 'woe-staging-storage' } },
          kv: { 'quota-kv': { id: 'kv-staging-id' }, shared: { id: 'shared-kv-id' } },
          ai: { ai: {} }
        },
        queues: {
          push: { name: 'woe-staging-push-queue' },
          'plugin-jobs': { name: 'woe-staging-plugin-jobs' }
        }
      }
    }
  }
}

function fixtureCore() {
  return {
    main: 'src/index.ts',
    compatibility_date: '2025-11-28',
    workers_dev: false,
    build: { command: 'node scripts/plugins/assertGenerated.mjs' },
    vars: { ENVIRONMENT: 'development', REGISTRATION: false },
    bindings: [
      { name: 'DB', kind: 'd1', logicalResource: 'db', required: true, shared: true },
      { name: 'R2', kind: 'r2', logicalResource: 'storage', required: true, shared: true },
      { name: 'QUOTA_KV', kind: 'kv', logicalResource: 'quota-kv', required: true, shared: true },
      {
        name: 'MESSAGE_STREAM_HUB',
        kind: 'durable-object',
        logicalResource: 'message-stream-hub',
        required: true,
        shared: true,
        className: 'MessageStreamHubObject'
      }
    ],
    secrets: [
      { name: 'DEFAULT_ADMIN_PASSWORD', required: true, shared: true, purpose: 'bootstrap admin password' },
      { name: 'PLUGIN_SECRET_MASTER_KEY', required: true, shared: true, purpose: 'plugin secret master key' }
    ],
    durableObjectMigrations: [{ tag: 'v1', newSqliteClasses: ['MessageStreamHubObject'] }],
    triggers: { crons: ['0 2 * * *'] }
  }
}

test('real repository merges core fragments with package fragments for production', () => {
  const core = loadCoreResources()
  const resources = loadOpsResources({ rootDir: repositoryRoot })
  const records = discoverPluginPackageRecords({ rootDir: repositoryRoot, packageRoot: 'src/plugins/builtin' })

  const { config } = buildWranglerConfig({ core, records, resources, targetEnvironment: 'production' })

  assert.equal(config.targetEnvironment, 'production')
  assert.equal(config.name, 'woe')

  assert.equal('env' in config, false)
  assert.ok(config.main.includes('src/index.ts'))
  assert.ok(config.d1_databases.some(entry => entry.binding === 'DB'))
  assert.ok(config.r2_buckets.some(entry => entry.binding === 'R2'))
  assert.ok(config.kv_namespaces.some(entry => entry.binding === 'QUOTA_KV'))
  assert.ok(config.images && config.images.binding === 'IMAGES')
  assert.equal(config.durable_objects.bindings[0].class_name, 'MessageStreamHubObject')
  assert.deepEqual(config.triggers.crons, core.triggers.crons)
  assert.equal(config.ai?.binding, undefined)
  const logicalQueues = new Set(records.flatMap(record =>
    (record.manifest.resources?.queues ?? []).map(queue => queue.logicalResource)
  ))
  const producers = (config.queues?.producers ?? []).map(producer => producer.binding)
  const consumers = config.queues?.consumers ?? []
  const expectedProducers = [
    ...(logicalQueues.has('plugin-jobs') ? ['PLUGIN_JOB_QUEUE'] : []),
    ...(logicalQueues.has('push') ? ['PUSH_QUEUE'] : [])
  ]
  assert.deepEqual(producers.sort(), expectedProducers.sort())
  const pushConsumer = consumers.find(consumer => consumer.queue.includes('push'))
  assert.equal(Boolean(pushConsumer), logicalQueues.has('push'))
  if (pushConsumer) {
    assert.deepEqual(
      [pushConsumer.max_batch_size, pushConsumer.max_batch_timeout, pushConsumer.max_retries],
      [50, 5, 3]
    )
  }
  const jobsConsumer = consumers.find(consumer => consumer.queue.includes('plugin-jobs'))
  assert.equal(Boolean(jobsConsumer), logicalQueues.has('plugin-jobs'))
  if (jobsConsumer) {
    assert.deepEqual(
      [jobsConsumer.max_batch_size, jobsConsumer.max_batch_timeout, jobsConsumer.max_retries, jobsConsumer.max_concurrency],
      [1, 5, 2, 1]
    )
  }

  assert.equal(config.vars.ENVIRONMENT, 'production')
})

test('staging keeps the ops worker name verbatim and never inherits production-only values', () => {
  const core = loadCoreResources()
  const resources = loadOpsResources({ rootDir: repositoryRoot })
  const records = discoverPluginPackageRecords({ rootDir: repositoryRoot, packageRoot: 'src/plugins/builtin' })

  const staging = buildWranglerConfig({ core, records, resources, targetEnvironment: 'staging' })
  const production = buildWranglerConfig({ core, records, resources, targetEnvironment: 'production' })


  assert.equal(staging.config.name, 'woe-staging')
  assert.notEqual(staging.config.name, 'woe-staging-staging')
  assert.equal(staging.config.targetEnvironment, 'staging')

  assert.equal(production.config.vars.ENVIRONMENT, 'production')
  assert.equal(staging.config.vars.ENVIRONMENT, 'staging')
})

test('vars only declared for staging never reach production', () => {
  const staging = buildWranglerConfig({
    core: fixtureCore(),
    records: [record('task-like', jobsQueueFragment()), record('push-like', pushQueueFragment())],
    resources: fixtureResources(),
    targetEnvironment: 'staging'
  })
  const production = buildWranglerConfig({
    core: fixtureCore(),
    records: [record('task-like', jobsQueueFragment()), record('push-like', pushQueueFragment())],
    resources: fixtureResources(),
    targetEnvironment: 'production'
  })
  assert.equal(staging.config.vars.STAGING_ONLY, 'yes')
  assert.equal('STAGING_ONLY' in production.config.vars, false)
  assert.equal(production.config.vars.ENVIRONMENT, 'production')
})

test('unknown environment fails and lists the configured environments', () => {
  assert.throws(
    () =>
      buildWranglerConfig({
        core: fixtureCore(),
        records: [],
        resources: fixtureResources(),
        targetEnvironment: 'banana'
      }),
    /banana.*production.*staging|banana.*staging.*production/s
  )
})

test('shared bindings declared by multiple packages are emitted once', () => {
  const core = fixtureCore()
  const fragment = {
    bindings: [{ name: 'SHARED_KV', kind: 'kv', logicalResource: 'shared', required: true, shared: true }]
  }
  const { config } = buildWranglerConfig({
    core,
    records: [record('alpha', fragment), record('beta', fragment)],
    resources: fixtureResources(),
    targetEnvironment: 'production'
  })
  assert.equal(config.kv_namespaces.filter(entry => entry.binding === 'SHARED_KV').length, 1)
})

test('same binding name with a different kind conflicts and names both packages', () => {
  assert.throws(
    () =>
      buildWranglerConfig({
        core: fixtureCore(),
        records: [
          record('alpha', { bindings: [{ name: 'SHARED_KV', kind: 'kv', logicalResource: 'shared', required: true, shared: true }] }),
          record('beta', { bindings: [{ name: 'SHARED_KV', kind: 'r2', logicalResource: 'shared', required: true, shared: true }] })
        ],
        resources: fixtureResources(),
        targetEnvironment: 'production'
      }),
    /SHARED_KV.*alpha.*beta|SHARED_KV.*beta.*alpha/s
  )
})

test('non-shared duplicate binding declarations conflict', () => {
  assert.throws(
    () =>
      buildWranglerConfig({
        core: fixtureCore(),
        records: [
          record('alpha', { bindings: [{ name: 'AI', kind: 'ai', logicalResource: 'ai', required: false, shared: false }] }),
          record('beta', { bindings: [{ name: 'AI', kind: 'ai', logicalResource: 'ai', required: false, shared: false }] })
        ],
        resources: fixtureResources(),
        targetEnvironment: 'production'
      }),
    /AI.*shared/s
  )
})

test('queue consumer policy conflicts fail with the logical resource', () => {
  assert.throws(
    () =>
      buildWranglerConfig({
        core: fixtureCore(),
        records: [
          record('alpha', pushQueueFragment({ maxBatchSize: 50, maxBatchTimeout: 5, maxRetries: 3 })),
          record('beta', pushQueueFragment({ maxBatchSize: 10, maxBatchTimeout: 5, maxRetries: 3 }))
        ],
        resources: fixtureResources(),
        targetEnvironment: 'production'
      }),
    /push.*consumer|consumer.*push/s
  )
})

test('missing required resource mapping fails and lists logical resource names', () => {
  const resources = fixtureResources()
  delete resources.environments.production.resources.d1.db
  delete resources.environments.production.resources.kv['quota-kv']
  assert.throws(
    () =>
      buildWranglerConfig({
        core: fixtureCore(),
        records: [],
        resources,
        targetEnvironment: 'production'
      }),
    /db.*quota-kv|quota-kv.*db/s
  )
})

test('optional AI mapping can be absent without failing', () => {
  const resources = fixtureResources()
  delete resources.environments.production.resources.ai
  const { config } = buildWranglerConfig({
    core: fixtureCore(),
    records: [record('ai-like', { bindings: [{ name: 'AI', kind: 'ai', logicalResource: 'ai', required: false, shared: false }] })],
    resources,
    targetEnvironment: 'production'
  })
  assert.equal('ai' in config, false)
})

test('removing the last push package drops the Push Queue bindings', () => {
  const { config } = buildWranglerConfig({
    core: fixtureCore(),
    records: [record('webhooker-like', jobsQueueFragment())],
    resources: fixtureResources(),
    targetEnvironment: 'production'
  })
  const producers = config.queues?.producers ?? []
  assert.equal(producers.some(producer => producer.binding === 'PUSH_QUEUE'), false)
  assert.equal(config.queues.consumers.some(consumer => consumer.queue === 'woe-push-queue'), false)
  assert.ok(config.queues.producers.some(producer => producer.binding === 'PLUGIN_JOB_QUEUE'))
})

test('removing the last task package drops the Plugin Jobs Queue but keeps cron', () => {
  const { config } = buildWranglerConfig({
    core: fixtureCore(),
    records: [record('push-like', pushQueueFragment())],
    resources: fixtureResources(),
    targetEnvironment: 'production'
  })
  const producers = config.queues?.producers ?? []
  assert.equal(producers.some(producer => producer.binding === 'PLUGIN_JOB_QUEUE'), false)
  assert.ok(producers.some(producer => producer.binding === 'PUSH_QUEUE'))

  assert.deepEqual(config.triggers.crons, ['0 2 * * *'])
})

test('webhooker-like task packages keep the Plugin Jobs Queue', () => {
  const { config } = buildWranglerConfig({
    core: fixtureCore(),
    records: [record('webhooker-like', jobsQueueFragment())],
    resources: fixtureResources(),
    targetEnvironment: 'production'
  })
  assert.ok(config.queues.producers.some(producer => producer.binding === 'PLUGIN_JOB_QUEUE'))
})

test('secret names never leak into the generated wrangler configuration', () => {
  const { files } = buildDeploymentFiles({
    core: fixtureCore(),
    records: [record('vendor-like', {
      vars: { VENDOR_URL: 'https://example.invalid' },
      secrets: [{ name: 'VENDOR_API_TOKEN', required: false, shared: false, purpose: 'vendor auth' }]
    }), record('task-like', jobsQueueFragment()), record('push-like', pushQueueFragment())],
    resources: fixtureResources(),
    targetEnvironment: 'production'
  })
  const config = JSON.parse(files['wrangler.generated.json'])
  const serialized = JSON.stringify(config) + files['.wrangler/deploy/config.json']
  assert.equal(serialized.includes('DEFAULT_ADMIN_PASSWORD'), false)
  assert.equal(serialized.includes('PLUGIN_SECRET_MASTER_KEY'), false)
  assert.equal(serialized.includes('VENDOR_API_TOKEN'), false)
  assert.equal(config.vars.VENDOR_URL, 'https://example.invalid')
})

test('duplicate package vars with conflicting values fail', () => {
  assert.throws(
    () =>
      buildWranglerConfig({
        core: fixtureCore(),
        records: [
          record('alpha', { vars: { SHARED_FLAG: 'a' } }),
          record('beta', { vars: { SHARED_FLAG: 'b' } })
        ],
        resources: fixtureResources(),
        targetEnvironment: 'production'
      }),
    /SHARED_FLAG.*alpha.*beta|SHARED_FLAG.*beta.*alpha/s
  )
})

test('buildDeploymentFiles emits the root config plus the official deploy redirect', () => {
  const { files } = buildDeploymentFiles({
    core: fixtureCore(),
    records: [record('task-like', jobsQueueFragment())],
    resources: fixtureResources(),
    targetEnvironment: 'staging'
  })
  assert.deepEqual(JSON.parse(files['.wrangler/deploy/config.json']), {
    configPath: '../../wrangler.generated.json'
  })
  const config = JSON.parse(files['wrangler.generated.json'])
  assert.equal(config.targetEnvironment, 'staging')
  assert.equal('env' in config, false)
  assert.equal(config.name, 'woe-staging')
})

test('loadOpsResources prefers wrangler.resources.json and falls back to the example file', t => {
  const rootDir = mkdtempSync(path.join(tmpdir(), 'woe-resources-'))
  t.after(() => rmSync(rootDir, { recursive: true, force: true }))


  copyFileSync(
    path.join(repositoryRoot, 'resources.json'),
    path.join(rootDir, 'resources.json')
  )
  const fallback = loadOpsResources({ rootDir })
  assert.ok(fallback.environments.production)
  assert.equal(fallback.environments.production.workerName, 'woe')


  const custom = { environments: { production: { workerName: 'custom-name', vars: {}, resources: {}, queues: {} } } }
  writeFileSync(path.join(rootDir, 'wrangler.resources.json'), JSON.stringify(custom))
  const loaded = loadOpsResources({ rootDir })
  assert.equal(loaded.environments.production.workerName, 'custom-name')
})

test('the committed template.toml matches the deterministic renderer output', t => {
  const rootDir = mkdtempSync(path.join(tmpdir(), 'woe-template-'))
  t.after(() => rmSync(rootDir, { recursive: true, force: true }))
  copyFileSync(
    path.join(repositoryRoot, 'resources.json'),
    path.join(rootDir, 'resources.json')
  )

  const core = loadCoreResources()

  const resources = loadOpsResources({ rootDir })
  const records = discoverPluginPackageRecords({ rootDir: repositoryRoot, packageRoot: 'src/plugins/builtin' })

  const rendered = renderWranglerExample({ core, records, resources })
  const committed = readFileSync(path.join(repositoryRoot, 'template.toml'), 'utf8')

  assert.equal(rendered, committed)

  assert.equal(/^DEFAULT_ADMIN_PASSWORD\s*=/m.test(rendered), false)
  assert.match(rendered, /wrangler secret put DEFAULT_ADMIN_PASSWORD/)
  assert.match(rendered, /targetEnvironment/)
})

test('resource loading never reads .env, .dev.vars, or secret material', t => {


  const rootDir = mkdtempSync(path.join(tmpdir(), 'woe-core-'))
  t.after(() => rmSync(rootDir, { recursive: true, force: true }))
  writeFileSync(path.join(rootDir, '.env'), 'DEFAULT_ADMIN_PASSWORD=leak-env\nworkerName=leak-env-name\n')
  writeFileSync(path.join(rootDir, '.dev.vars'), 'PLUGIN_SECRET_MASTER_KEY=leak-vars\n')
  writeFileSync(
    path.join(rootDir, 'resources.json'),
    JSON.stringify({ environments: { production: { workerName: 'woe', vars: {}, resources: {}, queues: {} } } })
  )

  const ops = loadOpsResources({ rootDir })
  const serialized = JSON.stringify(ops)
  assert.equal(ops.environments.production.workerName, 'woe')
  assert.equal(serialized.includes('leak-env'), false)
  assert.equal(serialized.includes('leak-vars'), false)


  assert.equal(JSON.stringify(loadCoreResources()).includes('leak'), false)
  assert.equal(existsSync(path.join(rootDir, '.env')), true)
})

test('queue routing vars derive from active mappings and disappear with queues', () => {
  const resources = fixtureResources()
  for (const targetEnvironment of ['production', 'staging']) {
    resources.environments[targetEnvironment].vars.PLUGIN_JOB_QUEUE_NAME = 'stale-override'
    resources.environments[targetEnvironment].vars.PUSH_QUEUE_NAME = 'stale-push'
    const records = [record('task', jobsQueueFragment()), record('push', pushQueueFragment())]
    const { config } = buildWranglerConfig({ core: fixtureCore(), records, resources, targetEnvironment })
    for (const [logical, variable] of [['plugin-jobs', 'PLUGIN_JOB_QUEUE_NAME'], ['push', 'PUSH_QUEUE_NAME']]) {
      assert.equal(config.vars[variable], resources.environments[targetEnvironment].queues[logical].name)
      assert.ok(config.queues.consumers.some(consumer => consumer.queue === config.vars[variable]))
    }
    const publicConfig = buildWranglerConfig({ core: fixtureCore(), records: records.slice(0, 1), resources, targetEnvironment }).config
    assert.equal('PUSH_QUEUE_NAME' in publicConfig.vars, false)
    assert.equal(publicConfig.vars.PLUGIN_JOB_QUEUE_NAME, resources.environments[targetEnvironment].queues['plugin-jobs'].name)
    const empty = buildWranglerConfig({ core: fixtureCore(), records: [], resources, targetEnvironment }).config
    assert.equal('PUSH_QUEUE_NAME' in empty.vars, false)
    assert.equal('PLUGIN_JOB_QUEUE_NAME' in empty.vars, false)
  }
})

test('push and plugin-jobs cannot map to the same actual queue', () => {
  const resources = fixtureResources()
  resources.environments.staging.queues.push.name = resources.environments.staging.queues['plugin-jobs'].name
  assert.throws(() => buildWranglerConfig({ core: fixtureCore(), records: [record('task', jobsQueueFragment()), record('push', pushQueueFragment())], resources, targetEnvironment: 'staging' }), /same.*queue|queue.*same/i)
})

test('empty queue declarations are rejected before routing vars are generated', () => {
  const resources = fixtureResources()
  assert.throws(
    () => buildWranglerConfig({
      core: fixtureCore(),
      records: [record('empty-queue', { queues: [{ logicalResource: 'push' }] })],
      resources,
      targetEnvironment: 'production'
    }),
    /queue.*producerBinding.*consumer|empty queue declaration/i
  )
})

test('core observability passes through to generated config when declared', () => {
  const core = fixtureCore()
  core.observability = {
    logs: { enabled: true, head_sampling_rate: 1, invocation_logs: true, persist: true },
    traces: { enabled: true, head_sampling_rate: 1, persist: true }
  }
  const { config } = buildWranglerConfig({ core, records: [], resources: fixtureResources(), targetEnvironment: 'production' })
  assert.deepEqual(config.observability, core.observability)

  const bare = buildWranglerConfig({ core: fixtureCore(), records: [], resources: fixtureResources(), targetEnvironment: 'production' })
  assert.equal(bare.config.observability, undefined)
})
