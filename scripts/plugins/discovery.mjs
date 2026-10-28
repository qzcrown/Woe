import {
  existsSync,
  lstatSync,
  readFileSync,
  readdirSync,
  realpathSync
} from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { deepFreeze, pluginPackageError, validatePluginManifest } from './manifest.mjs'

function isInside(parent, candidate) {
  const relative = path.relative(parent, candidate)
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))
}

function assertRelativePath(slug, field, declaredPath) {
  if (declaredPath.includes('\0') || declaredPath.includes('\\')) {
    throw pluginPackageError(slug, field, `invalid package-relative path "${declaredPath}"`)
  }
  if (path.posix.isAbsolute(declaredPath) || path.win32.isAbsolute(declaredPath)) {
    throw pluginPackageError(slug, field, `absolute path is not allowed: "${declaredPath}"`)
  }
  if (declaredPath.split('/').includes('..')) {
    throw pluginPackageError(slug, field, `path escapes the package: "${declaredPath}"`)
  }
}

function assertRealPath(slug, field, packageDir, packageRealPath, declaredPath, kind) {
  assertRelativePath(slug, field, declaredPath)
  const target = path.resolve(packageDir, declaredPath)
  if (!isInside(packageDir, target)) {
    throw pluginPackageError(slug, field, `path escapes the package: "${declaredPath}"`)
  }

  const relative = path.relative(packageDir, target)
  let current = packageDir
  for (const segment of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, segment)
    let stat
    try {
      stat = lstatSync(current)
    } catch {
      throw pluginPackageError(slug, field, `declared path does not exist: "${declaredPath}"`)
    }
    if (stat.isSymbolicLink()) {
      throw pluginPackageError(slug, field, `symlink is not allowed: "${declaredPath}"`)
    }
    if (current !== target && !stat.isDirectory()) {
      throw pluginPackageError(slug, field, `path parent is not a directory: "${declaredPath}"`)
    }
  }

  let stat
  try {
    stat = lstatSync(target)
  } catch {
    throw pluginPackageError(slug, field, `declared path does not exist: "${declaredPath}"`)
  }
  if (kind === 'file' && !stat.isFile()) {
    throw pluginPackageError(slug, field, `declared entry is not a file: "${declaredPath}"`)
  }
  if (kind === 'directory' && !stat.isDirectory()) {
    throw pluginPackageError(slug, field, `declared path is not a directory: "${declaredPath}"`)
  }
  const targetRealPath = realpathSync(target)
  if (!isInside(packageRealPath, targetRealPath)) {
    throw pluginPackageError(slug, field, `real path escapes the package: "${declaredPath}"`)
  }
}

function declaredPaths(manifest) {
  const paths = []
  const add = (field, value, kind = 'file') => {
    if (value !== undefined) paths.push({ field, value, kind })
  }
  add('backend.event.entry', manifest.backend?.event?.entry)
  add('backend.task.entry', manifest.backend?.task?.entry)
  add('backend.push.entry', manifest.backend?.push?.entry)
  add('config.parser.entry', manifest.config?.parser?.entry)
  add('frontend.configEditor', manifest.frontend?.configEditor)
  add('frontend.messageActions', manifest.frontend?.messageActions)
  add('frontend.adminPanel', manifest.frontend?.adminPanel)
  for (const locale of ['en-US', 'zh-CN']) {
    add(`frontend.locales.${locale}`, manifest.frontend?.locales?.[locale])
  }
  add('assets', manifest.assets, 'any')
  add('docs', manifest.docs, 'any')
  return paths
}

function readManifest(slug, packageDir) {
  const manifestPath = path.join(packageDir, 'plugin.json')
  let stat
  try {
    stat = lstatSync(manifestPath)
  } catch {
    throw pluginPackageError(slug, 'plugin.json', `missing manifest at ${manifestPath}`)
  }
  if (stat.isSymbolicLink()) {
    throw pluginPackageError(slug, 'plugin.json', `symlink is not allowed: ${manifestPath}`)
  }
  if (!stat.isFile()) {
    throw pluginPackageError(slug, 'plugin.json', `manifest is not a file: ${manifestPath}`)
  }
  try {
    return JSON.parse(readFileSync(manifestPath, 'utf8'))
  } catch (error) {
    throw pluginPackageError(slug, 'plugin.json', `invalid JSON at ${manifestPath}: ${error.message}`)
  }
}

function resolveScanRoot(absoluteRoot, packageRoot) {
  if (typeof packageRoot !== 'string' || packageRoot.length === 0) {
    throw pluginPackageError(String(packageRoot), 'packageRoot', 'must be a non-empty relative path')
  }
  if (path.posix.isAbsolute(packageRoot) || path.win32.isAbsolute(packageRoot) || packageRoot.includes('\\')) {
    throw pluginPackageError(packageRoot, 'packageRoot', `must be a relative path contained in rootDir: "${packageRoot}"`)
  }
  if (packageRoot.split('/').includes('..')) {
    throw pluginPackageError(packageRoot, 'packageRoot', `path escapes rootDir: "${packageRoot}"`)
  }
  const scanRoot = path.resolve(absoluteRoot, packageRoot)
  if (!isInside(absoluteRoot, scanRoot)) {
    throw pluginPackageError(packageRoot, 'packageRoot', `path escapes rootDir: "${packageRoot}"`)
  }

  let rootRealPath
  try {
    rootRealPath = realpathSync(absoluteRoot)
  } catch {
    throw pluginPackageError(packageRoot, 'packageRoot', `rootDir does not exist: ${absoluteRoot}`)
  }
  let current = absoluteRoot
  for (const segment of path.relative(absoluteRoot, scanRoot).split(path.sep).filter(Boolean)) {
    current = path.join(current, segment)
    let stat
    try {
      stat = lstatSync(current)
    } catch (error) {
      if (error.code === 'ENOENT') return null
      throw error
    }
    if (stat.isSymbolicLink()) {
      throw pluginPackageError(packageRoot, 'packageRoot', `symlink is not allowed: ${current}`)
    }
    if (!stat.isDirectory()) {
      throw pluginPackageError(packageRoot, 'packageRoot', `path component is not a directory: ${current}`)
    }
  }

  const scanRealPath = realpathSync(scanRoot)
  if (!isInside(rootRealPath, scanRealPath)) {
    throw pluginPackageError(packageRoot, 'packageRoot', `real path escapes rootDir: ${scanRealPath}`)
  }
  return { scanRoot, scanRealPath }
}

export function discoverPluginPackageRecords({ rootDir, packageRoot = 'src/plugins/builtin' }) {
  const absoluteRoot = path.resolve(rootDir)
  const resolved = resolveScanRoot(absoluteRoot, packageRoot)
  if (resolved === null) return Object.freeze([])
  const { scanRoot, scanRealPath } = resolved
  const records = []
  const modulePaths = new Map()
  const platforms = new Map()

  const entries = readdirSync(scanRoot, { withFileTypes: true }).sort((left, right) =>
    left.name < right.name ? -1 : left.name > right.name ? 1 : 0
  )
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue
    const packageDir = path.join(scanRoot, entry.name)
    if (entry.isSymbolicLink()) {
      throw pluginPackageError(entry.name, 'packageDir', `symlink is not allowed: ${packageDir}`)
    }
    if (!entry.isDirectory()) continue
    const packageRealPath = realpathSync(packageDir)
    if (!isInside(scanRealPath, packageRealPath) || path.dirname(packageRealPath) !== scanRealPath) {
      throw pluginPackageError(entry.name, 'packageDir', `real path escapes the scan root: ${packageDir}`)
    }

    const manifest = validatePluginManifest(readManifest(entry.name, packageDir), entry.name)
    for (const declared of declaredPaths(manifest)) {
      assertRealPath(entry.name, declared.field, packageDir, packageRealPath, declared.value, declared.kind)
    }

    if (modulePaths.has(manifest.modulePath)) {
      throw pluginPackageError(
        entry.name,
        'modulePath',
        `duplicate identity "${manifest.modulePath}" also declared by "${modulePaths.get(manifest.modulePath)}"`
      )
    }
    modulePaths.set(manifest.modulePath, entry.name)

    const platform = manifest.backend?.push?.platform
    if (platform !== undefined) {
      if (platform === 'web' || platform === 'unknown') {
        throw pluginPackageError(entry.name, 'backend.push.platform', `reserved platform "${platform}"`)
      }
      if (platforms.has(platform)) {
        throw pluginPackageError(
          entry.name,
          'backend.push.platform',
          `duplicate platform "${platform}" also declared by "${platforms.get(platform)}"`
        )
      }
      platforms.set(platform, entry.name)
    }
    records.push({ slug: entry.name, packageDir, manifest: deepFreeze(manifest) })
  }

  records.sort((left, right) => left.manifest.modulePath < right.manifest.modulePath ? -1 : left.manifest.modulePath > right.manifest.modulePath ? 1 : 0)
  return deepFreeze(records)
}

export function discoverPluginPackages(options) {
  return deepFreeze(discoverPluginPackageRecords(options).map(record => record.manifest))
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}







export function backendTestIgnorePattern(slugs, { packageRoot = 'src/plugins/builtin' } = {}) {
  const rootPrefix = packageRoot.split('/').map(escapeRegExp).join('/')
  const patternRoot = `<rootDir>/${rootPrefix}`
  const scanned = [...new Set(slugs)].sort()
  if (scanned.length === 0) return patternRoot
  const alternatives = scanned.map(escapeRegExp).join('|')
  return `${patternRoot}/(?!(${alternatives})/tests/backend/)`
}






export function frontendTestDirs(records, { packageRoot = 'src/plugins/builtin' } = {}) {
  return records
    .filter(record => existsSync(path.join(record.packageDir, 'tests/frontend')))
    .map(record => `${packageRoot}/${record.slug}/tests/frontend`)
    .sort()
}

const repositoryRoot = fileURLToPath(new URL('../../', import.meta.url))





function runCli() {
  const usage =
    'Usage: node scripts/plugins/discovery.mjs ' +
    '<--print-jest-ignore | --print-frontend-test-dirs | --print-packages> [--root <dir>]'
  const args = process.argv.slice(2)
  let mode = null
  let rootDir = repositoryRoot
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === '--root') {
      if (index + 1 >= args.length) throw new Error(usage)
      rootDir = path.resolve(args[index + 1])
      index += 1
    } else if (['--print-jest-ignore', '--print-frontend-test-dirs', '--print-packages'].includes(args[index])) {
      if (mode !== null) throw new Error(usage)
      mode = args[index]
    } else {
      throw new Error(usage)
    }
  }
  if (mode === null) throw new Error(usage)

  const records = discoverPluginPackageRecords({ rootDir, packageRoot: 'src/plugins/builtin' })
  if (mode === '--print-jest-ignore') {
    process.stdout.write(backendTestIgnorePattern(records.map(record => record.slug)))
  } else if (mode === '--print-frontend-test-dirs') {
    process.stdout.write(JSON.stringify(frontendTestDirs(records)))
  } else {
    process.stdout.write(JSON.stringify(records.map(record => record.manifest)))
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    runCli()
  } catch (error) {
    process.stderr.write(`${error.message}\n`)
    process.exitCode = 1
  }
}
