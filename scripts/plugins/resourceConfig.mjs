














import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { discoverPluginPackageRecords } from './discovery.mjs'

const moduleDir = path.dirname(fileURLToPath(import.meta.url))
const repositoryRoot = path.resolve(moduleDir, '../..')
const generatedConfigFile = 'wrangler.generated.json'
const deployRedirectFile = '.wrangler/deploy/config.json'
const opsResourcesFile = 'wrangler.resources.json'
const exampleResourcesFile = 'resources.json'

const bindingKinds = ['d1', 'r2', 'kv', 'ai', 'images', 'durable-object']

const mappedKinds = new Set(['d1', 'r2', 'kv', 'ai'])

export function loadCoreResources() {
  const file = path.join(moduleDir, 'coreResources.json')
  const core = JSON.parse(readFileSync(file, 'utf8'))
  validateCoreFragment(core, file)
  return core
}

function requireString(value, where, field) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`${where}: field "${field}" must be a non-empty string`)
  }
}

function validateCoreFragment(core, where) {
  requireString(core.main, where, 'main')
  requireString(core.compatibility_date, where, 'compatibility_date')
  if (core.assets !== undefined) {
    requireString(core.assets.directory, where, 'assets.directory')
    requireString(core.assets.binding, where, 'assets.binding')
  }
  if (core.build !== undefined) requireString(core.build.command, where, 'build.command')
  for (const [name, value] of Object.entries(core.vars ?? {})) {
    if (typeof value !== 'string' && typeof value !== 'boolean') {
      throw new Error(`${where}: vars "${name}" must be a string or boolean`)
    }
  }
  for (const [index, binding] of (core.bindings ?? []).entries()) {
    const field = `bindings.${index}`
    requireString(binding.name, where, `${field}.name`)
    if (!bindingKinds.includes(binding.kind)) throw new Error(`${where}: ${field}.kind is not supported`)
    requireString(binding.logicalResource, where, `${field}.logicalResource`)
    if (binding.kind === 'durable-object') requireString(binding.className, where, `${field}.className`)
  }
}






export function loadOpsResources({ rootDir }) {
  const actual = path.join(rootDir, opsResourcesFile)
  const file = existsSync(actual) ? actual : path.join(rootDir, exampleResourcesFile)
  const resources = JSON.parse(readFileSync(file, 'utf8'))
  if (resources.environments === undefined || typeof resources.environments !== 'object') {
    throw new Error(`${path.relative(process.cwd(), file)}: missing "environments" object`)
  }
  for (const [environment, entry] of Object.entries(resources.environments)) {
    requireString(entry.workerName, `${file} environments.${environment}`, 'workerName')
  }
  return resources
}

function consumerSignature(consumer) {
  return JSON.stringify([
    consumer.maxBatchSize,
    consumer.maxBatchTimeout,
    consumer.maxRetries,
    consumer.maxConcurrency
  ])
}

function declareBinding(registry, owner, binding) {
  const key = binding.name
  const existing = registry.get(key)
  if (existing === undefined) {
    registry.set(key, { binding, owners: [owner] })
    return
  }
  const held = existing.binding
  if (held.kind !== binding.kind || held.logicalResource !== binding.logicalResource) {
    throw new Error(
      `Binding conflict at "${key}": "${existing.owners[existing.owners.length - 1]}" declares ` +
        `${held.kind}/${held.logicalResource}, "${owner}" declares ${binding.kind}/${binding.logicalResource}`
    )
  }
  if (!binding.shared || !held.shared) {
    throw new Error(
      `Binding conflict at "${key}": declared by "${existing.owners.join('", "')}" and "${owner}", ` +
        `but duplicated bindings must be declared shared`
    )
  }
  if (binding.className !== undefined && binding.className !== held.className) {
    throw new Error(`Binding conflict at "${key}": className "${held.className}" vs "${binding.className}"`)
  }
  existing.owners.push(owner)
}

function declareVar(registry, owner, name, value) {
  const existing = registry.get(name)
  if (existing === undefined) {
    registry.set(name, { value, owners: [owner] })
    return
  }
  if (existing.value !== value) {
    throw new Error(
      `Vars conflict at "${name}": "${existing.owners[existing.owners.length - 1]}" declares ` +
        `${JSON.stringify(existing.value)}, "${owner}" declares ${JSON.stringify(value)}`
    )
  }
  existing.owners.push(owner)
}

function declareQueue(registry, owner, queue) {
  if (queue.producerBinding === undefined && queue.consumer === undefined) {
    throw new Error(`Queue declaration for "${queue.logicalResource}" by "${owner}" must declare producerBinding or consumer`)
  }
  const existing = registry.get(queue.logicalResource)
  if (existing === undefined) {
    registry.set(queue.logicalResource, { queue, owners: [owner] })
    return
  }
  const held = existing.queue
  if ((held.producerBinding ?? null) !== (queue.producerBinding ?? null)) {
    throw new Error(
      `Queue conflict at "${queue.logicalResource}": producerBinding ` +
        `"${held.producerBinding ?? '<none>'}" ("${existing.owners[existing.owners.length - 1]}") vs ` +
        `"${queue.producerBinding ?? '<none>'}" ("${owner}")`
    )
  }
  if (consumerSignature(held.consumer ?? {}) !== consumerSignature(queue.consumer ?? {})) {
    throw new Error(
      `Queue consumer policy conflict at "${queue.logicalResource}": ` +
        `"${existing.owners.join('", "')}" and "${owner}" declare different consumer policies`
    )
  }
  existing.owners.push(owner)
}

function bindingMapping(resources, kind, logicalResource) {
  const section = resources.resources?.[kind]
  if (section === undefined || section[logicalResource] === undefined) return undefined
  return section[logicalResource]
}





export function buildWranglerConfig({ core, records, resources, targetEnvironment }) {
  const environment = resources.environments[targetEnvironment]
  if (environment === undefined) {
    const available = Object.keys(resources.environments).sort().join(', ')
    throw new Error(
      `Unknown target environment "${targetEnvironment}" in the ops resources mapping; available: ${available}`
    )
  }

  const bindings = new Map()
  const vars = new Map()
  const queues = new Map()
  const secrets = new Map()

  const declareSecret = (owner, secret) => {
    const existing = secrets.get(secret.name)
    if (existing === undefined) {
      secrets.set(secret.name, { secret, owners: [owner] })
      return
    }
    existing.owners.push(owner)
    if (secret.required) existing.secret.required = true
  }

  const declareFragment = (owner, fragment) => {
    if (fragment === undefined) return
    for (const [name, value] of Object.entries(fragment.vars ?? {})) declareVar(vars, owner, name, value)
    for (const binding of fragment.bindings ?? []) declareBinding(bindings, owner, binding)
    for (const queue of fragment.queues ?? []) declareQueue(queues, owner, queue)
    for (const secret of fragment.secrets ?? []) declareSecret(owner, secret)
  }



  for (const [name, value] of Object.entries(core.vars ?? {})) declareVar(vars, 'core', name, value)
  for (const binding of core.bindings ?? []) declareBinding(bindings, 'core', binding)
  for (const secret of core.secrets ?? []) declareSecret('core', secret)

  for (const record of records) {
    declareFragment(record.slug ?? record.manifest.modulePath, record.manifest.resources)
  }



  for (const [name, value] of Object.entries(environment.vars ?? {})) vars.set(name, { value, owners: ['ops'] })

  const missing = []
  const d1Databases = []
  const r2Buckets = []
  const kvNamespaces = []
  const durableObjects = []
  const otherBindings = {}
  for (const { binding } of bindings.values()) {
    const mapping = mappedKinds.has(binding.kind)
      ? bindingMapping(environment, binding.kind, binding.logicalResource)
      : {}
    if (mapping === undefined) {
      if (binding.required) {
        missing.push(`${binding.kind} "${binding.logicalResource}" (binding ${binding.name})`)
      }
      continue
    }
    if (binding.kind === 'd1') {
      d1Databases.push({
        binding: binding.name,
        database_name: mapping.databaseName,
        database_id: mapping.databaseId
      })
    } else if (binding.kind === 'r2') {
      r2Buckets.push({ binding: binding.name, bucket_name: mapping.bucketName })
    } else if (binding.kind === 'kv') {
      kvNamespaces.push({ binding: binding.name, id: mapping.id })
    } else if (binding.kind === 'durable-object') {
      durableObjects.push({ name: binding.name, class_name: binding.className })
    } else if (binding.kind === 'ai') {
      otherBindings.ai = { binding: binding.name }
    } else if (binding.kind === 'images') {
      otherBindings.images = { binding: binding.name }
    }
  }
  if (missing.length > 0) {
    throw new Error(
      `Missing required resource mapping for environment "${targetEnvironment}": ${missing.join(', ')}; ` +
        `fill them in ${opsResourcesFile}`
    )
  }

  const queueProducers = []
  const queueConsumers = []
  const missingQueues = []
  for (const { queue } of queues.values()) {
    const mapping = environment.queues?.[queue.logicalResource]
    if (mapping === undefined) {
      missingQueues.push(`queue "${queue.logicalResource}"`)
      continue
    }
    if (queue.producerBinding !== undefined) {
      queueProducers.push({ binding: queue.producerBinding, queue: mapping.name })
    }
    if (queue.consumer !== undefined) {
      queueConsumers.push({
        queue: mapping.name,
        max_batch_size: queue.consumer.maxBatchSize,
        max_batch_timeout: queue.consumer.maxBatchTimeout,
        max_retries: queue.consumer.maxRetries,
        ...(queue.consumer.maxConcurrency === undefined ? {} : { max_concurrency: queue.consumer.maxConcurrency })
      })
    }
  }
  if (missingQueues.length > 0) {
    throw new Error(
      `Packages demand queues without an ops mapping for environment "${targetEnvironment}": ` +
        `${missingQueues.join(', ')}; fill them in ${opsResourcesFile}`
    )
  }


  const routingVars = [['plugin-jobs', 'PLUGIN_JOB_QUEUE_NAME'], ['push', 'PUSH_QUEUE_NAME']]
  const actualNames = new Map()
  for (const [logical, variable] of routingVars) {
    vars.delete(variable)
    if (!queues.has(logical)) continue
    const name = environment.queues[logical].name
    if (actualNames.has(name)) throw new Error(`Cannot map ${logical} and ${actualNames.get(name)} to the same queue "${name}"`)
    actualNames.set(name, logical)
    vars.set(variable, { value: name, owners: ['generated queue mapping'] })
  }


  const config = {
    name: environment.workerName,
    targetEnvironment,
    ...(core.main === undefined ? {} : { main: core.main }),
    compatibility_date: core.compatibility_date,
    ...(core.workers_dev === undefined ? {} : { workers_dev: core.workers_dev }),
    ...(core.assets === undefined ? {} : { assets: { directory: core.assets.directory, binding: core.assets.binding } }),
    ...(core.build === undefined ? {} : { build: { command: core.build.command } }),
    vars: Object.fromEntries([...vars.entries()].map(([name, { value }]) => [name, value])),
    ...(d1Databases.length === 0 ? {} : { d1_databases: d1Databases }),
    ...(r2Buckets.length === 0 ? {} : { r2_buckets: r2Buckets }),
    ...(kvNamespaces.length === 0 ? {} : { kv_namespaces: kvNamespaces }),
    ...(durableObjects.length === 0 ? {} : { durable_objects: { bindings: durableObjects } }),
    ...(otherBindings.ai === undefined ? {} : { ai: otherBindings.ai }),
    ...(otherBindings.images === undefined ? {} : { images: otherBindings.images }),
    ...(queueProducers.length === 0 && queueConsumers.length === 0
      ? {}
      : {
          queues: {
            ...(queueProducers.length === 0 ? {} : { producers: queueProducers }),
            ...(queueConsumers.length === 0 ? {} : { consumers: queueConsumers })
          }
        }),
    ...(core.rules === undefined ? {} : { rules: core.rules }),
    ...(core.observability === undefined ? {} : { observability: core.observability }),
    ...(core.durableObjectMigrations === undefined || core.durableObjectMigrations.length === 0
      ? {}
      : {
          migrations: core.durableObjectMigrations.map(migration => ({
            tag: migration.tag,
            new_sqlite_classes: migration.newSqliteClasses
          }))
        }),
    ...(core.triggers === undefined ? {} : { triggers: core.triggers })
  }
  return {
    config,
    workerName: environment.workerName,
    secretNames: [...secrets.keys()].sort()
  }
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonicalize(value[key])]))
  }
  return value
}

function serialize(value) {
  return `${JSON.stringify(canonicalize(value), null, 2)}\n`
}


export function buildDeploymentFiles({ core, records, resources, targetEnvironment }) {
  const { config } = buildWranglerConfig({ core, records, resources, targetEnvironment })
  return {
    files: {
      [generatedConfigFile]: serialize(config),
      [deployRedirectFile]: `${JSON.stringify({ configPath: `../../${generatedConfigFile}` }, null, 2)}\n`
    }
  }
}





export function generateWranglerConfig({ rootDir, targetEnvironment, records, core, resources }) {
  const absoluteRoot = path.resolve(rootDir)
  const resolvedRecords = records ?? discoverPluginPackageRecords({ rootDir: absoluteRoot, packageRoot: 'src/plugins/builtin' })
  const resolvedCore = core ?? loadCoreResources()
  const resolvedResources = resources ?? loadOpsResources({ rootDir: absoluteRoot })
  const { files } = buildDeploymentFiles({
    core: resolvedCore,
    records: resolvedRecords,
    resources: resolvedResources,
    targetEnvironment
  })

  const configFile = path.join(absoluteRoot, generatedConfigFile)
  const redirectFile = path.join(absoluteRoot, deployRedirectFile)
  mkdirSync(path.dirname(redirectFile), { recursive: true })
  const temporaryConfig = `${configFile}.tmp-${process.pid}`
  writeFileSync(temporaryConfig, files[generatedConfigFile])
  renameSync(temporaryConfig, configFile)
  const temporaryRedirect = `${redirectFile}.tmp-${process.pid}`
  writeFileSync(temporaryRedirect, files[deployRedirectFile])
  renameSync(temporaryRedirect, redirectFile)
  return { targetEnvironment, files: Object.keys(files).sort() }
}






export function assertWranglerConfigCurrent({ rootDir, core, resources }) {
  const absoluteRoot = path.resolve(rootDir)
  const configFile = path.join(absoluteRoot, generatedConfigFile)
  const redirectFile = path.join(absoluteRoot, deployRedirectFile)
  if (!existsSync(configFile)) {
    throw new Error(`Missing ${generatedConfigFile}; regenerate with the project wrapper`)
  }
  const current = readFileSync(configFile, 'utf8')
  const parsed = JSON.parse(current)
  const records = discoverPluginPackageRecords({ rootDir: absoluteRoot, packageRoot: 'src/plugins/builtin' })
  const { files } = buildDeploymentFiles({
    core: core ?? loadCoreResources(),
    records,
    resources: resources ?? loadOpsResources({ rootDir: absoluteRoot }),
    targetEnvironment: parsed.targetEnvironment
  })
  if (current !== files[generatedConfigFile]) {
    throw new Error(`Generated deployment configuration is stale at ${generatedConfigFile}; regenerate with the project wrapper`)
  }
  if (!existsSync(redirectFile) || readFileSync(redirectFile, 'utf8') !== files[deployRedirectFile]) {
    throw new Error(`Generated deploy redirect is stale at ${deployRedirectFile}; regenerate with the project wrapper`)
  }
  return { targetEnvironment: parsed.targetEnvironment }
}






function tomlString(value) {
  return JSON.stringify(value)
}

function tomlValue(value) {
  if (typeof value === 'string') return tomlString(value)
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  if (typeof value === 'number') return String(value)
  if (Array.isArray(value)) return `[${value.map(tomlString).join(', ')}]`
  throw new Error(`The example renderer only supports scalars and string arrays, received ${typeof value}`)
}

function renderBindingTable(header, entry, comment) {
  const lines = []
  if (comment) lines.push(...comment.map(line => `# ${line}`))
  lines.push(header)
  for (const [key, value] of Object.entries(entry)) {
    lines.push(`${key} = ${tomlValue(value)}`)
  }
  return lines
}

export function renderWranglerExample({ core, records, resources }) {
  const { config, secretNames } = buildWranglerConfig({
    core,
    records,
    resources,
    targetEnvironment: 'production'
  })
  const lines = []
  const comment = text => lines.push(...text.split('\n').map(line => `# ${line}`))

  comment(
    'Woe - Cloudflare Workers Configuration Example\n' +
      '===============================================\n' +
      '本文件由 scripts/plugins/renderWranglerExample.mjs 从 coreResources.json、实际包\n' +
      'fragment 与 resources.json 确定性生成（--check 防漂移），不要手改。\n' +
      '部署输入不经本文件：`npm run wrangler -- ...` 会按目标环境（-e/--env/CLOUDFLARE_ENV，\n' +
      '缺省 production）生成 wrangler.generated.json 与 .wrangler/deploy/config.json 官方\n' +
      '重定向后调用 Wrangler；原生 npx wrangler 只能消费已生成配置，指纹过期即失败。\n' +
      '资源 ID/名称等运维参数在 resources.json（复制为\n' +
      'wrangler.resources.json 后填写真实值）。'
  )
  lines.push('')
  lines.push(`name = ${tomlString(config.name)}  # Worker 名称：只取 production 运维映射，无环境后缀拼接`)
  if (config.main !== undefined) lines.push(`main = ${tomlString(config.main)}  # Worker 入口`)
  lines.push(`compatibility_date = ${tomlString(config.compatibility_date)}  # Workers 兼容日期`)
  if (config.workers_dev !== undefined) {
    lines.push(`workers_dev = ${config.workers_dev ? 'true' : 'false'}  # false = 仅自定义域，不启用 *.workers.dev`)
  }
  if (config.targetEnvironment !== undefined) {
    lines.push(
      `# 生成的部署配置带 targetEnvironment = ${tomlString(config.targetEnvironment)}（模板仅注释示意）；` +
        '原生 Wrangler 经官方重定向消费时会校验请求环境与构建环境一致'
    )
  }
  if (config.build !== undefined) {
    lines.push('')
    comment('原生 Wrangler 的 custom build 只校验生成指纹，过期即失败并提示 `npm run wrangler -- ...`')
    lines.push('[build]')
    lines.push(`command = ${tomlString(config.build.command)}`)
  }
  if (config.assets !== undefined) {
    lines.push('')
    comment('静态资产：构建后的前端文件（npm run build:frontend 输出到 public/）')
    lines.push('[assets]')
    lines.push(`directory = ${tomlString(config.assets.directory)}`)
    lines.push(`binding = ${tomlString(config.assets.binding)}`)
  }

  lines.push('')
  comment(
    '环境变量（[vars]）：core 默认值 + 包声明 + 目标环境运维映射的合并结果。\n' +
      'Secret 一律不得放入 [vars]，只允许 wrangler secret put：'
  )
  for (const name of secretNames) {
    lines.push(`#   wrangler secret put ${name}`)
  }
  lines.push('[vars]')
  for (const [name, value] of Object.entries(config.vars)) {
    lines.push(`${name} = ${tomlValue(value)}`)
  }
  comment(
    'PLUGIN_JOB_QUEUE_NAME/PUSH_QUEUE_NAME 由启用队列的环境映射自动派生，无需手工同步。\n' +
      'plugin-jobs 与 push 两种用途的实际队列不能同名；移除队列时同步移除对应变量。'
  )

  for (const entry of config.d1_databases ?? []) {
    lines.push(...renderBindingTable('[[d1_databases]]', entry, ['D1 数据库：wrangler d1 create <database_name> 后填真实 database_id']))
  }
  for (const entry of config.r2_buckets ?? []) {
    lines.push(...renderBindingTable('[[r2_buckets]]', entry, ['R2 桶：应用图标等上传存储']))
  }
  if (config.images !== undefined) {
    lines.push(...renderBindingTable('[images]', config.images, ['Workers Images：服务端图片压缩/转写']))
  }
  if (config.kv_namespaces !== undefined) {
    for (const entry of config.kv_namespaces) {
      lines.push(...renderBindingTable('[[kv_namespaces]]', entry, ['KV：配额覆盖存储（键 ai:limit:<userId>）']))
    }
  }
  if (config.ai !== undefined) {
    lines.push(...renderBindingTable('[ai]', config.ai, ['Workers AI：可选 binding，缺失时仅 workers-ai provider 降级']))
  }
  if (config.durable_objects !== undefined) {
    lines.push('')
    comment('Durable Object：实时消息流 hub')
    lines.push('[durable_objects]')
    lines.push('bindings = [')
    for (const entry of config.durable_objects.bindings) {
      lines.push(`  { name = ${tomlString(entry.name)}, class_name = ${tomlString(entry.class_name)} }`)
    }
    lines.push(']')
  }
  if (config.queues !== undefined) {
    lines.push('')
    comment(
      '队列按实际包声明条件生成：push 包声明 Push Queue，任务包（如 Webhooker）声明\n' +
        'Plugin Jobs Queue；两者必须不同名（Worker 的 queue() 按 batch.queue 精确分流）。'
    )
    if (config.queues.producers !== undefined) {
      for (const entry of config.queues.producers) {
        lines.push(...renderBindingTable('[[queues.producers]]', entry))
      }
    }
    if (config.queues.consumers !== undefined) {
      for (const entry of config.queues.consumers) {
        lines.push(...renderBindingTable('[[queues.consumers]]', entry))
      }
    }
  }
  for (const entry of config.migrations ?? []) {
    lines.push(...renderBindingTable('[[migrations]]', entry, ['Durable Object 迁移（历史已发布，不得改写）']))
  }
  for (const entry of config.rules ?? []) {
    lines.push(...renderBindingTable('[[rules]]', entry, ['迁移 SQL 以 Text 规则打包进 Worker']))
  }
  if (config.observability !== undefined) {
    lines.push('')
    comment('可观测性：logs/traces 全量采样并持久化（Workers Traces）')
    if (config.observability.logs !== undefined) {
      lines.push(...renderBindingTable('[observability.logs]', config.observability.logs))
    }
    if (config.observability.traces !== undefined) {
      lines.push(...renderBindingTable('[observability.traces]', config.observability.traces))
    }
  }
  if (config.triggers !== undefined) {
    lines.push('')
    comment('定时任务：插件日志/任务清理与推送对账（无队列时通用清理仍保留）')
    lines.push('[triggers]')
    lines.push(`crons = ${tomlValue(config.triggers.crons)}`)
  }
  lines.push('')
  return lines.join('\n')
}
