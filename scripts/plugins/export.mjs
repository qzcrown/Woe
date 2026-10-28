



















import { createHash } from 'node:crypto'
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { discoverPluginPackageRecords } from './discovery.mjs'
import { loadCoreResources, loadOpsResources, renderWranglerExample } from './resourceConfig.mjs'
import {
  assertRetainedLockVersions,
  lockfileProjectionArgs,
  projectManifests,
  regenerateLockfiles
} from './projectDependencies.mjs'

const repositoryRoot = fileURLToPath(new URL('../../', import.meta.url))
const packageRootDir = 'src/plugins/builtin'

const excludedDirectoryNames = new Set([
  'node_modules',
  '.git',
  '.wrangler',
  '.worktrees',
  'dist',
  'coverage',
  'test-results',
  'dev-dist',
  'references'
])

const prunedAtAnyDepthDirectoryNames = new Set(['node_modules', 'dist', 'coverage', 'test-results', 'dev-dist'])

const excludedRootFiles = new Set([
  'wrangler.toml',
  'wrangler.resources.json',
  'wrangler.generated.json',
  '.plugin-generation.json',
  '.env',
  '.env.local',
  '.dev.vars',
  'dev-shim.ts',
  'pack.sh'
])
const excludedRelativeDirs = ['src/generated/plugins', 'frontend/src/generated/plugins', 'frontend/public/generated-plugins']
const exportManifestFile = 'export-manifest.json'

function isExcluded(relativePath) {
  const segments = relativePath.split('/')
  const top = segments[0]
  if (segments.some(segment => segment === '.plugin-tmp' || /\.(tmp|backup)-/.test(segment))) return true
  if (segments.length === 1 && top !== exportManifestFile) {
    if (excludedRootFiles.has(top)) return true
    if (excludedDirectoryNames.has(top)) return true
  }

  if (segments.some(segment => prunedAtAnyDepthDirectoryNames.has(segment))) return true
  if (top === 'public' && segments.length >= 1) return true
  if (excludedRelativeDirs.some(dir => relativePath === dir || relativePath.startsWith(`${dir}/`))) return true

  if (segments.some(segment => segment.startsWith('.') && segment !== '.gitignore')) return true
  return false
}

function listTree(rootDir) {
  const files = []
  const visit = directory => {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((left, right) =>
      left.name < right.name ? -1 : left.name > right.name ? 1 : 0
    )) {
      const absolute = path.join(directory, entry.name)
      if (entry.isDirectory()) visit(absolute)
      else if (entry.isFile()) files.push(absolute)
    }
  }
  visit(rootDir)
  return files
}


function copySourceTree({ rootDir, outDir }) {
  cpSync(rootDir, outDir, {
    recursive: true,
    filter: source => {
      const stat = statSync(source, { throwIfNoEntry: false })
      if (stat === undefined) return false
      if (stat.isDirectory()) {
        return !isExcluded(path.relative(rootDir, source).split(path.sep).join('/'))
      }
      return !isExcluded(path.relative(rootDir, source).split(path.sep).join('/'))
    }
  })
}

function writeJson(file, value) {
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`)
}





export async function exportSourceTree({ rootDir = repositoryRoot, outDir, remove = [], lockfileRunner }) {
  const absoluteRoot = path.resolve(rootDir)
  const absoluteOut = path.resolve(outDir)
  if (typeof outDir !== 'string' || outDir.length === 0) {
    throw new Error('exportSourceTree: outDir is required')
  }
  if (existsSync(absoluteOut)) {
    throw new Error(`export target directory already exists: ${absoluteOut}`)
  }

  const sourceRecords = discoverPluginPackageRecords({ rootDir: absoluteRoot, packageRoot: packageRootDir })
  const knownSlugs = sourceRecords.map(record => record.slug)
  const unknown = remove.filter(slug => !knownSlugs.includes(slug))
  if (unknown.length > 0) {
    throw new Error(
      `Unknown --remove packages: ${unknown.join(', ')}; available packages: ${knownSlugs.sort().join(', ')}`
    )
  }

  copySourceTree({ rootDir: absoluteRoot, outDir: absoluteOut })
  for (const slug of remove) {
    rmSync(path.join(absoluteOut, packageRootDir, slug), { recursive: true, force: true })
  }


  const records = discoverPluginPackageRecords({ rootDir: absoluteOut, packageRoot: packageRootDir })
  const removedModules = sourceRecords
    .filter(record => remove.includes(record.slug))
    .map(record => record.manifest.modulePath)


  const projection = projectManifests({ rootDir: absoluteOut, packages: records, target: 'export' })
  for (const [kind, file] of [
    ['root', 'package.json'],
    ['frontend', 'frontend/package.json']
  ]) {
    const manifestPath = path.join(absoluteOut, file)
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
    manifest.dependencies = projection[kind].dependencies
    manifest.devDependencies = projection[kind].devDependencies
    writeJson(manifestPath, manifest)
  }
  writeFileSync(
    path.join(absoluteOut, 'template.toml'),
    renderWranglerExample({
      core: loadCoreResources(),
      records,
      resources: loadOpsResources({ rootDir: absoluteOut })
    })
  )




  if (lockfileRunner !== null) {
    if (lockfileRunner === undefined) {
      await regenerateLockfiles({ rootDir: absoluteOut })
    } else {
      const args = lockfileProjectionArgs()
      await lockfileRunner(args, absoluteOut)
      await lockfileRunner(args, path.join(absoluteOut, 'frontend'))
    }
    for (const [kind, file, sourceFile] of [
      ['root', 'package-lock.json', path.join(absoluteRoot, 'package-lock.json')],
      ['frontend', 'frontend/package-lock.json', path.join(absoluteRoot, 'frontend/package-lock.json')]
    ]) {
      assertRetainedLockVersions({
        source: JSON.parse(readFileSync(sourceFile, 'utf8')),
        projected: JSON.parse(readFileSync(path.join(absoluteOut, file), 'utf8')),
        context: `${kind} export projection`
      })
    }
  }


  const files = listTree(absoluteOut)
    .map(file => ({
      path: path.relative(absoluteOut, file).split(path.sep).join('/'),
      sha256: createHash('sha256').update(readFileSync(file)).digest('hex')
    }))
    .sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0))
  const audit = {


    $comment:
      'Snapshot audit: this tree was copied from the working directory as-is (including uncommitted changes); hashes are only meaningful within this export directory.',
    remove: [...remove].sort(),
    modules: records.map(record => record.manifest.modulePath).sort(),
    removedModules: removedModules.sort(),
    packages: records.map(record => ({ slug: record.slug, modulePath: record.manifest.modulePath })).sort((left, right) =>
      left.slug < right.slug ? -1 : left.slug > right.slug ? 1 : 0
    ),
    files
  }
  writeJson(path.join(absoluteOut, exportManifestFile), audit)

  return {
    outDir: absoluteOut,
    removed: [...remove].sort(),
    modules: audit.modules,
    fileCount: files.length
  }
}

async function runCli() {
  const usage =
    'Usage: node scripts/plugins/export.mjs --out <dir> [--remove <slug>]... [--skip-lockfiles]\n' +
    'public 裁剪导出示例：node scripts/plugins/export.mjs --out <dir> --remove <private-slug>...'
  const args = process.argv.slice(2)
  let outDir
  const remove = []
  let skipLockfiles = false
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === '--out') {
      outDir = args[++index]
      if (outDir === undefined) throw new Error(usage)
    } else if (args[index] === '--remove') {
      const slug = args[++index]
      if (slug === undefined) throw new Error(usage)
      remove.push(slug)
    } else if (args[index] === '--skip-lockfiles') {
      skipLockfiles = true
    } else {
      throw new Error(usage)
    }
  }
  if (outDir === undefined) throw new Error(usage)

  const summary = await exportSourceTree({
    rootDir: repositoryRoot,
    outDir,
    remove,
    lockfileRunner: skipLockfiles ? null : undefined
  })
  process.stdout.write(
    `${JSON.stringify(
      { outDir: summary.outDir, removed: summary.removed, modules: summary.modules, fileCount: summary.fileCount },
      null,
      2
    )}\n`
  )
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runCli().catch(error => {
    process.stderr.write(`${error.message}\n`)
    process.exitCode = 1
  })
}
