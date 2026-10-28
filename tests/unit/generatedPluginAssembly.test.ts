import { readFileSync } from 'node:fs'
import path from 'node:path'
import type { Env } from '../../src/types/index'

const GENERATED_CATALOG = '../../src/generated/plugins/catalog'
const GENERATED_SERVER = '../../src/generated/plugins/server'
const GENERATED_MODULE_PATH = 'test/generated-plugin'

const generatedDescriptor = {
  modulePath: GENERATED_MODULE_PATH,
  name: 'Generated Probe',
  capabilities: ['generated-probe'],
  author: 'fixture-author',
  license: 'fixture-license',
  website: 'https://example.invalid/plugin',
  secretFields: ['credential'],
  task: {
    supportedSubjectTypes: ['message'],
    quotaNamespace: 'generated-quota',
    manualTrigger: false,
    outbound: { allowQuery: true }
  },
  push: { platform: 'huawei' }
}

const generatedServerModule = {
  event: ({ id, name }: { id: number; name: string }) => ({
    id,
    name,
    capabilities: ['generated-probe'],
    configExample: 'generated: true',
    init() {},
    async onMessageCreate() {
      return { status: 'ok' as const }
    }
  }),
  task: {
    staticFactory: () => ({
      validateConfig: async () => undefined,
      prepareJob: async () => ({ payload: { prepared: true } }),
      createTask: async () => {
        throw new Error('generated static task requires env')
      }
    }),
    runtimeFactory: (env: Env) => ({
      outbound: { allowHttp: true },
      createTask: async () => ({
        run: async () => ({
          ok: true as const,
          result: { marker: (env as unknown as Record<string, unknown>).GENERATED_ENV_MARKER }
        })
      })
    })
  },
  push: {
    async createRuntime() {
      return {
        platform: 'huawei',
        provider: {
          name: 'huawei',
          send: async () => ({ ok: true as const, retriable: false })
        },
        policy: { maxRetries: 7, retryBackoffMs: 700 }
      }
    }
  }
}

type GeneratedAssembly = {
  BUILTIN_PLUGINS: typeof import('../../src/constants/builtinPlugins').BUILTIN_PLUGINS
  createModuleCatalog: typeof import('../../src/plugins/moduleCatalog').createModuleCatalog
  moduleDescriptors: typeof import('../../src/generated/plugins/catalog').moduleDescriptors
  resolve: typeof import('../../src/plugins/registry').resolve
  builtinPluginTaskMetadata: typeof import('../../src/plugins/builtin/pluginTasks').builtinPluginTaskMetadata
  builtinPluginTasks: typeof import('../../src/plugins/builtin/pluginTasks').builtinPluginTasks
  createPluginTaskRegistry: typeof import('../../src/plugins/jobs/registry').createPluginTaskRegistry
  getPluginSecretFields: typeof import('../../src/plugins/jobs/registry').getPluginSecretFields
  registerPluginTask: typeof import('../../src/plugins/jobs/registry').registerPluginTask
  BUILTIN_PUSH_PLUGINS: typeof import('../../src/plugins/builtin/pushPlugins').BUILTIN_PUSH_PLUGINS
  createPushRuntime: typeof import('../../src/services/push/runtime').createPushRuntime
}

function loadGeneratedAssembly(): GeneratedAssembly {
  jest.resetModules()
  jest.doMock(GENERATED_CATALOG, () => ({ moduleDescriptors: [generatedDescriptor] }))
  jest.doMock(GENERATED_SERVER, () => ({
    serverModules: { [GENERATED_MODULE_PATH]: generatedServerModule }
  }))

  let assembly!: GeneratedAssembly
  jest.isolateModules(() => {
    const constants = require('../../src/constants/builtinPlugins') as typeof import('../../src/constants/builtinPlugins')
    const catalog = require('../../src/plugins/moduleCatalog') as typeof import('../../src/plugins/moduleCatalog')
    const generatedCatalog = require(GENERATED_CATALOG) as typeof import('../../src/generated/plugins/catalog')
    const registry = require('../../src/plugins/registry') as typeof import('../../src/plugins/registry')
    const tasks = require('../../src/plugins/builtin/pluginTasks') as typeof import('../../src/plugins/builtin/pluginTasks')
    const taskRegistry = require('../../src/plugins/jobs/registry') as typeof import('../../src/plugins/jobs/registry')
    const push = require('../../src/plugins/builtin/pushPlugins') as typeof import('../../src/plugins/builtin/pushPlugins')
    const pushRuntime = require('../../src/services/push/runtime') as typeof import('../../src/services/push/runtime')
    assembly = {
      BUILTIN_PLUGINS: constants.BUILTIN_PLUGINS,
      createModuleCatalog: catalog.createModuleCatalog,
      moduleDescriptors: generatedCatalog.moduleDescriptors,
      resolve: registry.resolve,
      builtinPluginTaskMetadata: tasks.builtinPluginTaskMetadata,
      builtinPluginTasks: tasks.builtinPluginTasks,
      createPluginTaskRegistry: taskRegistry.createPluginTaskRegistry,
      getPluginSecretFields: taskRegistry.getPluginSecretFields,
      registerPluginTask: taskRegistry.registerPluginTask,
      BUILTIN_PUSH_PLUGINS: push.BUILTIN_PUSH_PLUGINS,
      createPushRuntime: pushRuntime.createPushRuntime
    }
  })
  return assembly
}

afterEach(() => {
  jest.dontMock(GENERATED_CATALOG)
  jest.dontMock(GENERATED_SERVER)
  jest.resetModules()
})

describe('generated backend assembly', () => {
  test('generated descriptors drive public metadata and catalog get/list', () => {
    const assembly = loadGeneratedAssembly()

    expect(assembly.BUILTIN_PLUGINS).toEqual([
      {
        modulePath: GENERATED_MODULE_PATH,
        name: 'Generated Probe',
        capabilities: ['generated-probe'],
        author: 'fixture-author',
        license: 'fixture-license',
        website: 'https://example.invalid/plugin'
      }
    ])

    const catalog = assembly.createModuleCatalog(assembly.moduleDescriptors)
    expect(catalog.list()).toHaveLength(1)
    expect(catalog.get(GENERATED_MODULE_PATH)).toMatchObject({
      name: 'Generated Probe',
      secretFields: ['credential'],
      task: { quotaNamespace: 'generated-quota', manualTrigger: false },
      push: { platform: 'huawei' }
    })
    expect(catalog.get('test/missing')).toBeNull()
  })

  test('generated event factories are resolvable through the production registry', async () => {
    const assembly = loadGeneratedAssembly()
    const plugin = assembly.resolve(GENERATED_MODULE_PATH, 42, 'Generated Instance')

    expect(plugin).toMatchObject({
      id: 42,
      name: 'Generated Instance',
      capabilities: ['generated-probe'],
      configExample: 'generated: true'
    })
    await expect(plugin!.onMessageCreate!({ userId: 7, now: '2026-10-25T00:00:00.000Z' }))
      .resolves.toEqual({ status: 'ok' })
  })

  test('task assembly merges manifest metadata with static and fresh runtime behaviors', async () => {
    const assembly = loadGeneratedAssembly()

    expect(assembly.builtinPluginTaskMetadata).toEqual([
      {
        modulePath: GENERATED_MODULE_PATH,
        supportedSubjectTypes: ['message'],
        quotaNamespace: 'generated-quota',
        secretFields: ['credential'],
        manualTrigger: false,
        outbound: { allowQuery: true }
      }
    ])
    expect(assembly.getPluginSecretFields(GENERATED_MODULE_PATH)).toEqual(['credential'])

    const staticDefinition = assembly.builtinPluginTasks[0]
    expect(staticDefinition).toMatchObject({
      modulePath: GENERATED_MODULE_PATH,
      supportedSubjectTypes: ['message'],
      quotaNamespace: 'generated-quota',
      secretFields: ['credential'],
      manualTrigger: false,
      outbound: { allowQuery: true }
    })
    await expect(staticDefinition.createTask({ config: null, job: null, host: null } as never))
      .rejects.toThrow('generated static task requires env')

    const first = assembly.createPluginTaskRegistry({ GENERATED_ENV_MARKER: 'first' } as unknown as Env)
    const second = assembly.createPluginTaskRegistry({ GENERATED_ENV_MARKER: 'second' } as unknown as Env)
    const firstDefinition = first.resolve(GENERATED_MODULE_PATH)!
    const secondDefinition = second.resolve(GENERATED_MODULE_PATH)!

    expect(firstDefinition).not.toBe(secondDefinition)
    expect(firstDefinition.outbound).toEqual({ allowHttp: true })
    const firstTask = await firstDefinition.createTask({ config: null, job: null, host: null } as never)
    const secondTask = await secondDefinition.createTask({ config: null, job: null, host: null } as never)
    await expect(firstTask.run({ attempt: 1, timeoutMs: 1000 })).resolves.toEqual({
      ok: true,
      result: { marker: 'first' }
    })
    await expect(secondTask.run({ attempt: 1, timeoutMs: 1000 })).resolves.toEqual({
      ok: true,
      result: { marker: 'second' }
    })
  })

  test('generated tasks reject duplicate registration while retaining the test overlay', () => {
    const assembly = loadGeneratedAssembly()
    const generated = assembly.builtinPluginTasks[0]

    expect(() => assembly.registerPluginTask(generated)).toThrow(/already registered/)

    const overlay = {
      modulePath: 'test/overlay',
      supportedSubjectTypes: ['message'],
      createTask: async () => ({ run: async () => ({ ok: true as const }) })
    }
    assembly.registerPluginTask(overlay)
    expect(assembly.createPluginTaskRegistry({} as Env).resolve(overlay.modulePath)).toBe(overlay)
  })

  test('generated push entries drive both the facade and provider runtime', async () => {
    const assembly = loadGeneratedAssembly()

    expect(assembly.BUILTIN_PUSH_PLUGINS).toHaveLength(1)
    expect(assembly.BUILTIN_PUSH_PLUGINS[0]).toMatchObject({
      modulePath: GENERATED_MODULE_PATH,
      platform: 'huawei'
    })

    const runtime = await assembly.createPushRuntime({} as never, {} as Env)
    expect(runtime.providers.get('huawei')).toMatchObject({ name: 'huawei' })
    expect(runtime.providers.getPolicy('huawei')).toEqual({ maxRetries: 7, retryBackoffMs: 700 })
  })

  test('production facades contain no builtin package identities or package imports', () => {
    const facades = [
      'src/constants/builtinPlugins.ts',
      'src/plugins/builtin/pluginTasks.ts',
      'src/plugins/builtin/pushPlugins.ts',
      'src/plugins/manager.ts'
    ]
    const packageIdentity = /(?:builtin\/|\.\/)(?:webhooker|displayer)/
    const offenders = facades.filter(file =>
      packageIdentity.test(readFileSync(path.join(process.cwd(), file), 'utf8'))
    )

    expect(offenders).toEqual([])
  })
})
