import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const rootDir = path.resolve(__dirname, '../..')
const packageScratchPrefix = path.join(rootDir, 'src/plugins/builtin/scratch-fixture-')
const backendScratchPrefix = path.join(rootDir, 'src/generated/plugins.backup-review-')
const frontendScratchPrefix = path.join(rootDir, 'frontend/src/generated/plugins.tmp-review-')
const generatedArtifacts = [
  'src/generated/plugins/catalog.ts',
  'src/generated/plugins/server.ts',
  'frontend/src/generated/plugins/catalog.ts',
  'frontend/src/generated/plugins/ui.ts',
  'frontend/src/generated/plugins/locales.ts',
  '.plugin-generation.json'
].map(relativePath => path.join(rootDir, relativePath))


const sentinelRoot = path.join(rootDir, 'src/plugins/builtin/scratch-fixture')
const sentinelFile = path.join(sentinelRoot, 'sentinel.txt')
const SENTINEL_CONTENT = 'sentinel owned by pluginScratchExclusion test\n'

const posix = (value: string) => value.split(path.sep).join('/')
const relative = (value: string) => posix(path.relative(rootDir, value))

const ownedPaths = new Set<string>()
let needsRegeneration = false

const regeneratePlugins = () => {
  execFileSync(process.execPath, [path.join(rootDir, 'scripts/plugins/generate.mjs')], {
    cwd: rootDir,
    stdio: 'ignore'
  })
}


const createOwnedDir = (prefix: string): string => {
  const directory = mkdtempSync(prefix)
  ownedPaths.add(directory)
  needsRegeneration = true
  return directory
}

const cleanupOwned = () => {
  if (ownedPaths.size === 0) return
  for (const directory of ownedPaths) rmSync(directory, { recursive: true, force: true })
  ownedPaths.clear()
  if (needsRegeneration) {
    needsRegeneration = false

    regeneratePlugins()
  }
}

type ScratchFixture = {
  root: string
  slug: string
  modulePath: string
  backendScratch: string
  frontendScratch: string
  packageFrontendScratch: string
  packageTestScratch: string
}

const createFixture = (): ScratchFixture => {
  const packageRoot = createOwnedDir(packageScratchPrefix)
  const slug = path.basename(packageRoot)
  const modulePath = `builtin/${slug}`
  writeFileSync(path.join(packageRoot, 'plugin.json'), JSON.stringify({
    modulePath,
    name: 'Scratch Fixture',
    capabilities: ['test'],
    author: 'test',
    license: 'GPL-3.0-only',
    website: 'https://example.invalid'
  }))

  const packageFrontendScratch = path.join(packageRoot, 'frontend/plugins.tmp-review')
  const packageTestScratch = path.join(packageRoot, 'tests/frontend/plugins.backup-review')
  mkdirSync(packageFrontendScratch, { recursive: true })
  mkdirSync(packageTestScratch, { recursive: true })
  writeFileSync(path.join(packageFrontendScratch, 'stale.ts'), 'export const stalePackage = 1\n')
  writeFileSync(path.join(packageTestScratch, 'stale.test.ts'), "throw new Error('stale-package-test-executed')\n")

  const backendScratch = createOwnedDir(backendScratchPrefix)
  const frontendScratch = createOwnedDir(frontendScratchPrefix)
  writeFileSync(path.join(backendScratch, 'stale.test.ts'), "throw new Error('stale-test-executed')\n")
  writeFileSync(path.join(frontendScratch, 'stale.ts'), 'export const stale = 1\n')

  return {
    root: packageRoot,
    slug,
    modulePath,
    backendScratch,
    frontendScratch,
    packageFrontendScratch,
    packageTestScratch
  }
}

let sentinelOwned = false
let sentinelSnapshot: string | null = null

beforeAll(() => {
  if (existsSync(sentinelRoot)) {

    if (existsSync(sentinelFile)) sentinelSnapshot = readFileSync(sentinelFile, 'utf8')
    return
  }
  sentinelOwned = true
  mkdirSync(sentinelRoot, { recursive: true })
  writeFileSync(path.join(sentinelRoot, 'plugin.json'), JSON.stringify({
    modulePath: 'builtin/scratch-fixture',
    name: 'Scratch Fixture Sentinel',
    capabilities: ['test'],
    author: 'test',
    license: 'GPL-3.0-only',
    website: 'https://example.invalid'
  }))
  writeFileSync(sentinelFile, SENTINEL_CONTENT)
})

afterAll(() => {
  try {

    expect(existsSync(sentinelRoot)).toBe(true)
    if (sentinelSnapshot !== null) {
      expect(existsSync(sentinelFile)).toBe(true)
      expect(readFileSync(sentinelFile, 'utf8')).toBe(sentinelSnapshot)
    }
  } finally {
    if (sentinelOwned) {
      sentinelOwned = false
      rmSync(sentinelRoot, { recursive: true, force: true })
    }


    regeneratePlugins()
  }
})

describe('generated scratch directories stay outside collection', () => {
  afterEach(cleanupOwned)

  test('TypeScript, Vitest and Jest ignore stale tmp/backup directories', () => {
    const fixture = createFixture()

    const backend = execFileSync(path.join(rootDir, 'node_modules/.bin/tsc'), ['--noEmit', '--listFilesOnly'], {
      cwd: rootDir,
      encoding: 'utf8'
    })
    expect(backend).not.toContain(relative(path.join(fixture.backendScratch, 'stale.test.ts')))

    const frontend = execFileSync(path.join(rootDir, 'frontend/node_modules/.bin/vue-tsc'), [
      '--noEmit', '--listFilesOnly', '-p', 'frontend/tsconfig.json'
    ], { cwd: rootDir, encoding: 'utf8' })
    expect(frontend).not.toContain(relative(path.join(fixture.frontendScratch, 'stale.ts')))
    expect(frontend).not.toContain(relative(path.join(fixture.packageFrontendScratch, 'stale.ts')))



    const vitest = spawnSync(path.join(rootDir, 'frontend/node_modules/.bin/vitest'), [
      'run', `../src/plugins/builtin/${fixture.slug}/tests/frontend/plugins.backup-review/stale.test.ts`,
      '--passWithNoTests'
    ], { cwd: path.join(rootDir, 'frontend'), encoding: 'utf8' })
    expect(vitest.status).toBe(0)
    expect(`${vitest.stdout}\n${vitest.stderr}`).toMatch(/No test files found/i)

    const jestFiles = execFileSync(path.join(rootDir, 'node_modules/.bin/jest'), [
      '--listTests', '--runInBand'
    ], { cwd: rootDir, encoding: 'utf8' })
    expect(jestFiles).not.toContain(relative(path.join(fixture.packageTestScratch, 'stale.test.ts')))
  })

  test('removes owned fixtures and generated references after assertion or child-process failure', () => {
    const readGenerated = () => generatedArtifacts.map(file => readFileSync(file, 'utf8')).join('\n')
    const fingerprint = path.join(rootDir, '.plugin-generation.json')
    const expectNoResidue = (fixture: ScratchFixture) => {
      expect(existsSync(fixture.root)).toBe(false)
      expect(existsSync(fixture.backendScratch)).toBe(false)
      expect(existsSync(fixture.frontendScratch)).toBe(false)
      expect(readGenerated()).not.toContain(fixture.slug)
    }


    const assertCleanupAfter = (injectFailure: () => void) => {
      const fixture = createFixture()
      const fingerprintBefore = readFileSync(fingerprint, 'utf8')
      try {
        regeneratePlugins()
        expect(readGenerated()).toContain(fixture.slug)
        injectFailure()
      } finally {
        cleanupOwned()
      }
      expectNoResidue(fixture)
      expect(readFileSync(fingerprint, 'utf8')).toBe(fingerprintBefore)
    }

    assertCleanupAfter(() => expect(() => expect(true).toBe(false)).toThrow())
    assertCleanupAfter(() => expect(() => execFileSync(process.execPath, ['-e', 'process.exit(9)'])).toThrow())
  })
})
