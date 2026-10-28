export function pluginPackageError(slug, field, message) {
  return new Error(`Plugin package "${slug}" field "${field}": ${message}`)
}

export function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value
  for (const child of Object.values(value)) deepFreeze(child)
  return Object.freeze(value)
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function requireRecord(value, slug, field) {
  if (!isRecord(value)) throw pluginPackageError(slug, field, 'must be an object')
  return value
}

function optionalRecord(value, slug, field) {
  if (value === undefined) return undefined
  return requireRecord(value, slug, field)
}

function requireString(value, slug, field) {
  if (typeof value !== 'string' || value.length === 0) {
    throw pluginPackageError(slug, field, 'must be a non-empty string')
  }
  return value
}

function optionalString(value, slug, field) {
  if (value !== undefined) requireString(value, slug, field)
}

function requireBoolean(value, slug, field) {
  if (typeof value !== 'boolean') throw pluginPackageError(slug, field, 'must be a boolean')
}

function requireNumber(value, slug, field) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw pluginPackageError(slug, field, 'must be a finite number')
  }
}

function requireStringArray(value, slug, field) {
  if (!Array.isArray(value)) throw pluginPackageError(slug, field, 'must be an array of strings')
  value.forEach((item, index) => requireString(item, slug, `${field}.${index}`))
}

function optionalStringArray(value, slug, field) {
  if (value !== undefined) requireStringArray(value, slug, field)
}

function validateExport(value, slug, field) {
  requireString(value, slug, field)
  if (!/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(value)) {
    throw pluginPackageError(slug, field, 'must be a JavaScript export identifier')
  }
}

function validateEntryRef(value, slug, field) {
  const entry = requireRecord(value, slug, field)
  requireString(entry.entry, slug, `${field}.entry`)
  validateExport(entry.export, slug, `${field}.export`)
}

function validateTask(value, slug) {
  const task = requireRecord(value, slug, 'backend.task')
  requireString(task.entry, slug, 'backend.task.entry')
  validateExport(task.staticExport, slug, 'backend.task.staticExport')
  validateExport(task.runtimeExport, slug, 'backend.task.runtimeExport')
  requireStringArray(task.supportedSubjectTypes, slug, 'backend.task.supportedSubjectTypes')
  optionalString(task.quotaNamespace, slug, 'backend.task.quotaNamespace')
  if (task.manualTrigger !== undefined) {
    requireBoolean(task.manualTrigger, slug, 'backend.task.manualTrigger')
  }
  const outbound = optionalRecord(task.outbound, slug, 'backend.task.outbound')
  if (outbound) {
    for (const field of ['allowHttp', 'allowPrivateNetwork', 'allowQuery']) {
      if (outbound[field] !== undefined) {
        requireBoolean(outbound[field], slug, `backend.task.outbound.${field}`)
      }
    }
  }
}

function validateFrontend(value, slug) {
  if (value === undefined) return
  const frontend = requireRecord(value, slug, 'frontend')
  const allowedFields = ['configEditor', 'messageActions', 'adminPanel', 'clientPlatformLabels', 'locales']
  for (const field of Object.keys(frontend)) {
    if (!allowedFields.includes(field)) {
      throw pluginPackageError(slug, `frontend.${field}`, 'is not a supported frontend field')
    }
  }
  for (const field of ['configEditor', 'messageActions', 'adminPanel']) {
    optionalString(frontend[field], slug, `frontend.${field}`)
  }
  const labels = optionalRecord(frontend.clientPlatformLabels, slug, 'frontend.clientPlatformLabels')
  if (labels) {
    for (const [platform, label] of Object.entries(labels)) {
      requireString(label, slug, `frontend.clientPlatformLabels.${platform}`)
    }
  }
  const locales = optionalRecord(frontend.locales, slug, 'frontend.locales')
  if (locales) {
    for (const [locale, entry] of Object.entries(locales)) {
      if (locale !== 'en-US' && locale !== 'zh-CN') {
        throw pluginPackageError(slug, `frontend.locales.${locale}`, 'is not a supported locale')
      }
      requireString(entry, slug, `frontend.locales.${locale}`)
    }
  }
}

function validateConsumer(value, slug, field) {
  const consumer = requireRecord(value, slug, field)
  for (const name of ['maxBatchSize', 'maxBatchTimeout', 'maxRetries']) {
    requireNumber(consumer[name], slug, `${field}.${name}`)
  }
  if (consumer.maxConcurrency !== undefined) {
    requireNumber(consumer.maxConcurrency, slug, `${field}.maxConcurrency`)
  }
}

function validateResources(value, slug) {
  if (value === undefined) return
  const resources = requireRecord(value, slug, 'resources')
  const vars = optionalRecord(resources.vars, slug, 'resources.vars')
  if (vars) {
    for (const [name, variable] of Object.entries(vars)) {
      if (typeof variable !== 'string' && typeof variable !== 'boolean') {
        throw pluginPackageError(slug, `resources.vars.${name}`, 'must be a string or boolean')
      }
    }
  }
  if (resources.bindings !== undefined) {
    if (!Array.isArray(resources.bindings)) {
      throw pluginPackageError(slug, 'resources.bindings', 'must be an array')
    }
    resources.bindings.forEach((binding, index) => {
      const field = `resources.bindings.${index}`
      requireRecord(binding, slug, field)
      requireString(binding.name, slug, `${field}.name`)
      if (!['d1', 'r2', 'kv', 'ai', 'images', 'durable-object'].includes(binding.kind)) {
        throw pluginPackageError(slug, `${field}.kind`, 'is not a supported binding kind')
      }
      requireString(binding.logicalResource, slug, `${field}.logicalResource`)
      requireBoolean(binding.required, slug, `${field}.required`)
      requireBoolean(binding.shared, slug, `${field}.shared`)
    })
  }
  if (resources.queues !== undefined) {
    if (!Array.isArray(resources.queues)) {
      throw pluginPackageError(slug, 'resources.queues', 'must be an array')
    }
    resources.queues.forEach((queue, index) => {
      const field = `resources.queues.${index}`
      requireRecord(queue, slug, field)
      requireString(queue.logicalResource, slug, `${field}.logicalResource`)
      optionalString(queue.producerBinding, slug, `${field}.producerBinding`)
      if (queue.consumer !== undefined) validateConsumer(queue.consumer, slug, `${field}.consumer`)
    })
  }
  if (resources.secrets !== undefined) {
    if (!Array.isArray(resources.secrets)) {
      throw pluginPackageError(slug, 'resources.secrets', 'must be an array')
    }
    resources.secrets.forEach((secret, index) => {
      const field = `resources.secrets.${index}`
      requireRecord(secret, slug, field)
      requireString(secret.name, slug, `${field}.name`)
      requireBoolean(secret.required, slug, `${field}.required`)
      requireBoolean(secret.shared, slug, `${field}.shared`)
      requireString(secret.purpose, slug, `${field}.purpose`)
    })
  }
}

function validateDependencies(value, slug) {
  if (value === undefined) return
  const dependencies = requireRecord(value, slug, 'dependencies')
  for (const target of ['root', 'frontend']) {
    const manifest = optionalRecord(dependencies[target], slug, `dependencies.${target}`)
    if (!manifest) continue
    for (const section of ['dependencies', 'devDependencies']) {
      const versions = optionalRecord(manifest[section], slug, `dependencies.${target}.${section}`)
      if (!versions) continue
      for (const [name, version] of Object.entries(versions)) {
        requireString(version, slug, `dependencies.${target}.${section}.${name}`)
      }
    }
  }
}

export function validatePluginManifest(manifest, slug) {
  requireRecord(manifest, slug, 'plugin.json')
  for (const field of ['modulePath', 'name', 'author', 'license', 'website']) {
    requireString(manifest[field], slug, field)
  }
  requireStringArray(manifest.capabilities, slug, 'capabilities')

  const backend = optionalRecord(manifest.backend, slug, 'backend')
  if (backend) {
    if (backend.event !== undefined) validateEntryRef(backend.event, slug, 'backend.event')
    if (backend.task !== undefined) validateTask(backend.task, slug)
    if (backend.push !== undefined) {
      validateEntryRef(backend.push, slug, 'backend.push')
      requireString(backend.push.platform, slug, 'backend.push.platform')
    }
  }

  const config = optionalRecord(manifest.config, slug, 'config')
  if (config) {
    if (config.parser !== undefined) validateEntryRef(config.parser, slug, 'config.parser')
    optionalStringArray(config.secretFields, slug, 'config.secretFields')
    optionalString(config.errorDescription, slug, 'config.errorDescription')
  }

  validateFrontend(manifest.frontend, slug)
  optionalString(manifest.assets, slug, 'assets')
  optionalString(manifest.docs, slug, 'docs')
  validateResources(manifest.resources, slug)
  validateDependencies(manifest.dependencies, slug)
  return manifest
}
