











import { spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const manifestTargets = [
  { kind: 'root', file: 'package.json' },
  { kind: 'frontend', file: 'frontend/package.json' }
]
const sections = ['dependencies', 'devDependencies']

export function loadCoreDependencies() {
  const file = fileURLToPath(new URL('./coreDependencies.json', import.meta.url))
  const parsed = JSON.parse(readFileSync(file, 'utf8'))
  for (const { kind } of manifestTargets) {
    if (parsed[kind] === undefined || typeof parsed[kind] !== 'object') {
      throw new Error(`coreDependencies.json must describe the "${kind}" manifest`)
    }
    for (const section of sections) {
      const versions = parsed[kind][section] ?? {}
      if (typeof versions !== 'object') {
        throw new Error(`coreDependencies.json ${kind}.${section} must be a version map`)
      }
    }
  }
  return parsed
}

function dependencyOwnerKey(kind, section, name) {
  return `${kind}.${section}.${name}`
}





export function projectManifests({ rootDir, packages, target }) {
  if (target !== 'full' && target !== 'export') {
    throw new Error(`target must be 'full' or 'export', received ${JSON.stringify(target)}`)
  }
  const core = loadCoreDependencies()
  const projected = {}
  const owners = {}

  for (const { kind } of manifestTargets) {
    projected[kind] = {}
    for (const section of sections) {
      const merged = {}
      const declare = (owner, name, range) => {
        const existing = merged[name]
        if (existing === undefined) {
          merged[name] = range
          owners[dependencyOwnerKey(kind, section, name)] = [owner]
          return
        }
        if (existing !== range) {
          const holderList = owners[dependencyOwnerKey(kind, section, name)]
          throw new Error(
            `Dependency conflict at ${dependencyOwnerKey(kind, section, name)}: ` +
            `${holderList[holderList.length - 1]} declares ${existing}, ${owner} declares ${range}`
          )
        }
        owners[dependencyOwnerKey(kind, section, name)].push(owner)
      }
      for (const [name, range] of Object.entries(core[kind][section] ?? {})) {
        declare('core', name, range)
      }
      for (const record of packages) {
        const declared = record.manifest?.dependencies?.[kind]?.[section] ?? {}
        for (const [name, range] of Object.entries(declared)) {
          declare(record.slug, name, range)
        }
      }
      projected[kind][section] = Object.fromEntries(Object.keys(merged).sort().map(key => [key, merged[key]]))
    }
  }

  if (target === 'full') {
    assertFullCoverage({ rootDir, projected, owners })
  }
  return projected
}

function readManifestSections(rootDir, kind, file) {
  const manifestPath = path.resolve(rootDir, file)
  let manifest
  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  } catch (error) {
    throw new Error(`cannot read ${file} for dependency projection: ${error.message}`)
  }
  const sectionsContent = {}
  for (const section of sections) {
    const versions = manifest[section] ?? {}
    if (typeof versions !== 'object') {
      throw new Error(`${file} ${section} must be an object`)
    }
    sectionsContent[section] = versions
  }
  return sectionsContent
}






function assertFullCoverage({ rootDir, projected, owners }) {
  const problems = []
  for (const { kind, file } of manifestTargets) {
    const actual = readManifestSections(rootDir, kind, file)
    for (const section of sections) {
      const actualEntries = actual[section]
      const projectedEntries = projected[kind][section]
      for (const [name, range] of Object.entries(actualEntries)) {
        if (projectedEntries[name] === undefined) {
          problems.push(
            `${dependencyOwnerKey(kind, section, name)} is declared in ${file} but owned by ` +
            `neither core nor any plugin package`
          )
        } else if (projectedEntries[name] !== range) {
          const owner = owners[dependencyOwnerKey(kind, section, name)][0]
          problems.push(
            `${dependencyOwnerKey(kind, section, name)}: ${file} declares ${range} but ` +
            `projection owner "${owner}" declares ${projectedEntries[name]}`
          )
        }
      }
      for (const [name, range] of Object.entries(projectedEntries)) {
        if (actualEntries[name] === undefined) {
          const owner = owners[dependencyOwnerKey(kind, section, name)].find(holder => holder !== 'core') ?? 'core'
          problems.push(
            `${dependencyOwnerKey(kind, section, name)} is declared by "${owner}" but ` +
            `${file} does not declare it (expected ${range})`
          )
        }
      }
    }
  }
  if (problems.length > 0) {
    throw new Error(`full dependency projection does not cover the source manifests:\n${problems.join('\n')}`)
  }
}


export function lockfileProjectionArgs() {
  return ['install', '--package-lock-only', '--ignore-scripts', '--no-audit', '--no-fund']
}

const defaultRun = (args, cwd) =>
  new Promise((resolve, reject) => {
    const child = spawn('npm', args, { cwd, stdio: ['ignore', 'inherit', 'inherit'] })
    child.once('error', reject)
    child.once('exit', code => {
      if (code === 0) resolve()
      else reject(new Error(`npm ${args.join(' ')} failed in ${cwd} with exit code ${code}`))
    })
  })


export async function regenerateLockfiles({ rootDir, run = defaultRun }) {
  const args = lockfileProjectionArgs()
  await run(args, path.resolve(rootDir))
  await run(args, path.resolve(rootDir, 'frontend'))
}

function lockVersions(lockfile) {
  const packages = lockfile?.packages
  if (packages === undefined || typeof packages !== 'object') {
    throw new Error('lockfile projection requires an npm lockfileVersion >= 2 "packages" section')
  }
  const versions = new Map()
  for (const [key, entry] of Object.entries(packages)) {
    if (key === '' || !key.startsWith('node_modules/')) continue
    versions.set(key, entry?.version)
  }
  return versions
}






export function assertRetainedLockVersions({ source, projected, context }) {
  const sourceVersions = lockVersions(source)
  const projectedVersions = lockVersions(projected)
  const changed = []
  for (const [key, version] of sourceVersions) {
    const retained = projectedVersions.get(key)
    if (retained === undefined) continue
    if (retained !== version) {
      changed.push(`${key}: ${version} -> ${retained}`)
    }
  }
  if (changed.length > 0) {
    throw new Error(
      `retained lockfile entries changed locked versions (${context}):\n${changed.join('\n')}`
    )
  }
}
