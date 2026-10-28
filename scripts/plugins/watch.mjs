

















import { spawn } from 'node:child_process'
import { watch } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { generatePluginArtifacts } from './generate.mjs'
import { generateWranglerConfig } from './resourceConfig.mjs'
import { resolveWranglerEnvironment } from './wrangler.mjs'

const repositoryRoot = fileURLToPath(new URL('../../', import.meta.url))

const watchedFiles = new Set([
  'scripts/plugins/assertGenerated.mjs',
  'scripts/plugins/coreResources.json',
  'scripts/plugins/discovery.mjs',
  'scripts/plugins/generate.mjs',
  'scripts/plugins/manifest.mjs',
  'scripts/plugins/resourceConfig.mjs',
  'scripts/plugins/wrangler.mjs',
  'wrangler.resources.json',
  'resources.json'
])
const watchedExtensions = new Set(['.ts', '.vue', '.json', '.mjs', '.sql'])
const packageRoot = path.join(repositoryRoot, 'src/plugins/builtin')

function isWatched(relativeFile) {
  if (watchedFiles.has(relativeFile)) return true
  if (relativeFile.startsWith('src/plugins/builtin/')) {
    return watchedExtensions.has(path.extname(relativeFile))
  }
  return false
}






export function waitForExit(child) {
  return new Promise(resolve => {
    if (child.exitCode !== null || child.signalCode !== null) {
      resolve()
      return
    }
    let settled = false
    const done = () => {
      if (settled) return
      settled = true
      resolve()
    }
    child.once('exit', done)
    child.once('error', done)
  })
}

const defaultKillGraceMs = 5000






export function createDevSupervisor({
  spawnChild,
  regenerate,
  onExit,
  restartDebounceMs = 300,
  killGraceMs = defaultKillGraceMs,
  logger = message => process.stderr.write(`${message}\n`)
}) {
  let child = null
  let restarting = false
  let stopped = false
  let debounce = null



  const attachExitForwarding = next => {
    next.once('exit', code => {
      if (!stopped && !restarting && code !== null) onExit(code)
    })
  }

  const start = () => {
    child = spawnChild()
    attachExitForwarding(child)
    return child
  }

  const killChild = async dying => {
    const exited = waitForExit(dying)
    dying.kill('SIGTERM')
    setTimeout(() => dying.kill('SIGKILL'), killGraceMs).unref()
    await exited
  }

  const restart = async () => {
    if (restarting || stopped) return
    restarting = true
    logger('\n[watch] inputs changed - regenerating and restarting wrangler dev\n')
    if (child !== null) await killChild(child)
    try {
      await regenerate()
    } catch (error) {


      logger(
        `[watch] regeneration failed (dev process stays down; fix the inputs and save again to retry): ${error.message}\n`
      )
      restarting = false
      return
    }
    start()
    restarting = false
  }

  return {
    start,
    notifyChange() {
      if (stopped) return
      if (debounce !== null) clearTimeout(debounce)
      debounce = setTimeout(() => {
        debounce = null
        restart().catch(error => logger(`[watch] restart failed unexpectedly: ${error.message}\n`))
      }, restartDebounceMs)
    },
    isRestarting: () => restarting,
    async stop() {
      stopped = true
      if (debounce !== null) {
        clearTimeout(debounce)
        debounce = null
      }
      if (child !== null) await killChild(child)
    }
  }
}

async function main() {
  const argv = process.argv.slice(2)
  const doubleDash = argv.indexOf('--')
  const wranglerArgs = doubleDash === -1 ? ['dev'] : argv.slice(doubleDash + 1)
  const { targetEnvironment, childEnv } = resolveWranglerEnvironment({ argv: wranglerArgs, env: process.env })

  const regenerate = async () => {
    await generatePluginArtifacts({ rootDir: repositoryRoot, check: false })
    generateWranglerConfig({ rootDir: repositoryRoot, targetEnvironment })
  }



  const spawnDev = () => {
    const child = spawn(
      process.execPath,
      [path.join(repositoryRoot, 'scripts/plugins/wrangler.mjs'), ...wranglerArgs, '-e', targetEnvironment],
      {
        cwd: repositoryRoot,
        env: childEnv,
        stdio: 'inherit'
      }
    )
    child.once('error', error => {
      process.stderr.write(`[watch] failed to start wrangler dev: ${error.message}\n`)
      process.exitCode = 1
    })
    return child
  }

  const supervisor = createDevSupervisor({
    spawnChild: spawnDev,
    regenerate,
    onExit: code => process.exit(code)
  })

  await regenerate()
  process.stderr.write(`[watch] target environment: ${targetEnvironment}\n`)
  supervisor.start()

  const watchers = [
    watch(packageRoot, { recursive: true }, (event, filename) => {
      if (!filename || isWatched(path.join('src/plugins/builtin', String(filename)))) supervisor.notifyChange()
    }),
    watch(path.join(repositoryRoot, 'scripts/plugins'), { recursive: false }, (event, filename) => {
      if (!filename || isWatched(path.join('scripts/plugins', String(filename)))) supervisor.notifyChange()
    }),
    watch(repositoryRoot, { recursive: false }, (event, filename) => {
      if (!filename || watchedFiles.has(String(filename))) supervisor.notifyChange()
    })
  ]
  for (const watcher of watchers) watcher.once('error', () => {})

  const shutdown = async () => {
    for (const watcher of watchers) watcher.close()
    await supervisor.stop()
    process.exit(0)
  }
  process.once('SIGINT', () => {
    shutdown()
  })
  process.once('SIGTERM', () => {
    shutdown()
  })


  await new Promise(() => {})
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    process.stderr.write(`${error.message}\n`)
    process.exitCode = 1
  })
}
