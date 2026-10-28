









import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const sourceExtensions = new Set(['.ts', '.mts', '.cts', '.vue'])
const importSpecifierPatterns = [
  /(?:import|export)\s[^;()'"]*?from\s*['"]([^'"]+)['"]/g,
  /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  /\bimport\s*['"]([^'"]+)['"]/g,
  /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g
]

function isInside(parent, candidate) {
  const relative = path.relative(parent, candidate)
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))
}

function collectSourceFiles(directory, prune) {
  let entries
  try {
    entries = readdirSync(directory, { withFileTypes: true })
  } catch {
    return []
  }
  const files = []
  for (const entry of entries.sort((left, right) => (left.name < right.name ? -1 : left.name > right.name ? 1 : 0))) {
    const absolute = path.join(directory, entry.name)
    if (entry.isSymbolicLink()) continue
    if (entry.isDirectory()) {
      if (prune && prune(absolute)) continue
      files.push(...collectSourceFiles(absolute, prune))
    } else if (sourceExtensions.has(path.extname(entry.name))) {
      files.push({ absolute })
    }
  }
  return files
}

function localImportSpecifiers(contents) {
  const specifiers = new Set()
  for (const pattern of importSpecifierPatterns) {
    pattern.lastIndex = 0
    for (const match of contents.matchAll(pattern)) {
      const specifier = match[1]
      if (specifier.startsWith('.') || specifier.startsWith('@/')) specifiers.add(specifier)
    }
  }
  return specifiers
}

function firstOwnerOf(packageDirs, resolvedPath) {
  for (const [slug, packageDir] of packageDirs) {
    if (isInside(packageDir, resolvedPath)) return slug
  }
  return undefined
}





export function collectBoundaryViolations({ rootDir, records }) {
  const absoluteRoot = path.resolve(rootDir)
  const packageDirs = records.map(record => [record.slug, path.resolve(record.packageDir)])
  const violations = []
  const scanFile = (file, ownerScope) => {
    let contents
    try {
      contents = readFileSync(file.absolute, 'utf8')
    } catch {
      return
    }
    for (const specifier of localImportSpecifiers(contents)) {
      const resolved = specifier.startsWith('@/')
        ? path.resolve(absoluteRoot, 'frontend/src', specifier.slice(2))
        : path.resolve(path.dirname(file.absolute), specifier)
      const target = firstOwnerOf(packageDirs, resolved)
      if (target === undefined) continue
      if (ownerScope === 'core') {
        violations.push(
          `${path.relative(absoluteRoot, file.absolute)} -> ${specifier}: ` +
          `core must not import plugin package paths (hit package "${target}")`
        )
      } else if (target !== ownerScope) {
        violations.push(
          `${path.relative(absoluteRoot, file.absolute)} -> ${specifier}: ` +
          `package "${ownerScope}" must not import package "${target}"`
        )
      }
    }
  }

  const coreRoots = ['src', 'frontend/src']
  for (const coreRoot of coreRoots) {
    const root = path.join(absoluteRoot, coreRoot)
    const prune = directory => {

      if (directory === path.join(absoluteRoot, 'src/generated')) return true
      if (directory === path.join(absoluteRoot, 'frontend/src/generated')) return true

      return packageDirs.some(([, packageDir]) => directory === packageDir)
    }
    for (const file of collectSourceFiles(root, prune)) {
      scanFile(file, 'core')
    }
  }

  for (const [slug, packageDir] of packageDirs) {
    for (const file of collectSourceFiles(packageDir, () => false)) {
      scanFile(file, slug)
    }
  }
  return violations
}




export function checkBoundaries({ rootDir, records }) {
  const violations = collectBoundaryViolations({ rootDir, records })
  if (violations.length > 0) {
    throw new Error(`plugin package boundary violations:\n${violations.join('\n')}`)
  }
  let coreFiles = 0
  for (const coreRoot of ['src', 'frontend/src']) {
    const root = path.join(path.resolve(rootDir), coreRoot)
    const prune = directory =>
      directory === path.join(path.resolve(rootDir), 'src/generated') ||
      directory === path.join(path.resolve(rootDir), 'frontend/src/generated') ||
      records.some(record => directory === path.resolve(record.packageDir))
    coreFiles += collectSourceFiles(root, prune).length
  }
  const packageFiles = records.reduce(
    (total, record) => total + collectSourceFiles(path.resolve(record.packageDir), () => false).length,
    0
  )
  return { coreFiles, packageFiles }
}

const repositoryRoot = fileURLToPath(new URL('../../', import.meta.url))

async function runCli() {
  const { discoverPluginPackageRecords } = await import('./discovery.mjs')
  const records = discoverPluginPackageRecords({ rootDir: repositoryRoot, packageRoot: 'src/plugins/builtin' })
  checkBoundaries({ rootDir: repositoryRoot, records })
  process.stdout.write('Plugin package boundaries OK\n')
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runCli().catch(error => {
    process.stderr.write(`${error.message}\n`)
    process.exitCode = 1
  })
}
