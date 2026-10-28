import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'

const repositoryRoot = fileURLToPath(new URL('../../', import.meta.url))
const frontendSrcRoot = path.join(repositoryRoot, 'frontend/src')
const backendSrcRoot = path.join(repositoryRoot, 'src')
const builtinPackageRoot = path.join(repositoryRoot, 'src/plugins/builtin')

const importModule = async (filePath) => import(pathToFileURL(filePath).href)

const flattenLocaleKeys = (value, prefix = '') => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return prefix ? [prefix] : []
  }

  return Object.entries(value).flatMap(([key, child]) => {
    const nextPrefix = prefix ? `${prefix}.${key}` : key
    return flattenLocaleKeys(child, nextPrefix)
  })
}

const walkFiles = async (dir) => {
  const entries = await fs.readdir(dir, { withFileTypes: true })
  const files = []

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      files.push(...await walkFiles(fullPath))
      continue
    }

    if (/\.(vue|ts)$/.test(entry.name)) {
      files.push(fullPath)
    }
  }

  return files
}





const discoverPackageDirs = async () => {
  const entries = await fs.readdir(builtinPackageRoot, { withFileTypes: true })
  return entries
    .filter(entry => entry.isDirectory() && !entry.name.startsWith('.'))
    .map(entry => path.join(builtinPackageRoot, entry.name))
    .sort()
}

const readPackageManifest = async (packageDir) =>
  JSON.parse(await fs.readFile(path.join(packageDir, 'plugin.json'), 'utf8'))


const packageFrontendSourceFiles = async (packageDir) => {
  const manifest = await readPackageManifest(packageDir)
  const frontendRoot = path.join(packageDir, 'frontend')
  if (!existsSync(frontendRoot)) return []
  const localeFiles = new Set(
    Object.values(manifest.frontend?.locales ?? {}).map(entry => path.resolve(packageDir, entry))
  )
  const files = await walkFiles(frontendRoot)
  return files.filter(file => !localeFiles.has(file))
}

const literalTranslationKeyPattern = /(?<![\w$])(?:\$t|t)\(\s*["']([^"'`]+)["']/g

const consumeLiteralKeys = async (files) => {
  const keys = new Set()

  for (const filePath of files) {
    const content = await fs.readFile(filePath, 'utf8')
    for (const match of content.matchAll(literalTranslationKeyPattern)) {
      keys.add(match[1])
    }
  }

  return [...keys].sort()
}


const collectUsedLiteralKeys = async () => {
  const files = [...await walkFiles(frontendSrcRoot)]
  for (const packageDir of await discoverPackageDirs()) {
    files.push(...await packageFrontendSourceFiles(packageDir))
  }
  return consumeLiteralKeys(files)
}

const loadCoreLocales = async () => {
  const enUS = (await importModule(path.join(frontendSrcRoot, 'locales', 'en-US.ts'))).default
  const zhCN = (await importModule(path.join(frontendSrcRoot, 'locales', 'zh-CN.ts'))).default
  return { enUS, zhCN }
}






const collectAvailableKeys = async (packageDirs) => {
  const merged = { 'en-US': new Set(), 'zh-CN': new Set() }
  const addLocaleFile = async (file, locale) => {
    const loaded = await importModule(file)
    for (const key of flattenLocaleKeys(loaded.default)) merged[locale].add(key)
  }
  await addLocaleFile(path.join(frontendSrcRoot, 'locales', 'en-US.ts'), 'en-US')
  await addLocaleFile(path.join(frontendSrcRoot, 'locales', 'zh-CN.ts'), 'zh-CN')
  for (const packageDir of packageDirs) {
    const manifest = await readPackageManifest(packageDir)
    for (const locale of ['en-US', 'zh-CN']) {
      const entry = manifest.frontend?.locales?.[locale]
      if (entry !== undefined) {
        await addLocaleFile(path.resolve(packageDir, entry), locale)
      }
    }
  }
  return merged
}







const PINNED_PACKAGE_ONLY_USAGE_KEYS = {}
const PINNED_PACKAGE_ONLY_LOCALE_KEYS = {}

const extractQuotedLiterals = (text) => {
  const matches = [...text.matchAll(/['"]([^'"]+)['"]/g)]
  return matches.map(([, value]) => value)
}

const extractBackendClientTokenStatuses = async () => {
  const content = await fs.readFile(path.join(backendSrcRoot, 'types', 'index.ts'), 'utf8')
  const match = content.match(/tokenStatus\?:\s*([^;]+);/)
  assert.ok(match, 'Expected backend client tokenStatus union in src/types/index.ts')
  return extractQuotedLiterals(match[1])
}

const extractFrontendClientTokenStatuses = async () => {
  const content = await fs.readFile(path.join(frontendSrcRoot, 'types', 'index.ts'), 'utf8')
  const match = content.match(/export type ClientTokenStatus =\s*([^\n]+)/)
  assert.ok(match, 'Expected frontend ClientTokenStatus union in frontend/src/types/index.ts')
  return extractQuotedLiterals(match[1])
}

test('frontend literal translation keys exist in both locales', async () => {
  const packageDirs = await discoverPackageDirs()
  const [usedKeys, available] = await Promise.all([
    collectUsedLiteralKeys(),
    collectAvailableKeys(packageDirs)
  ])



  const presentSlugs = new Set(packageDirs.map(dir => path.basename(dir)))
  for (const [slug, keys] of Object.entries(PINNED_PACKAGE_ONLY_USAGE_KEYS)) {
    if (!presentSlugs.has(slug)) continue
    for (const key of keys) {
      assert.ok(
        usedKeys.includes(key),
        `literal key collection must cover package frontend sources (${slug}): ${key}`
      )
    }
  }

  const missingInEnUS = usedKeys.filter((key) => !available['en-US'].has(key))
  const missingInZhCN = usedKeys.filter((key) => !available['zh-CN'].has(key))

  assert.deepEqual(missingInEnUS, [])
  assert.deepEqual(missingInZhCN, [])
})

test('manifest client platform labels resolve inside their own package locale', async () => {
  for (const packageDir of await discoverPackageDirs()) {
    const manifest = await readPackageManifest(packageDir)
    const labels = manifest.frontend?.clientPlatformLabels ?? {}
    const available = await collectAvailableKeys([packageDir])
    for (const [platform, key] of Object.entries(labels)) {
      assert.ok(
        available['en-US'].has(key),
        `${path.basename(packageDir)} label "${platform}" key ${key} must exist in its en-US locale`
      )
      assert.ok(
        available['zh-CN'].has(key),
        `${path.basename(packageDir)} label "${platform}" key ${key} must exist in its zh-CN locale`
      )
    }
  }
})

test('en-US and zh-CN locale files expose the same translation keys', async () => {
  const { enUS, zhCN } = await loadCoreLocales()
  const enKeys = new Set(flattenLocaleKeys(enUS))
  const zhKeys = new Set(flattenLocaleKeys(zhCN))

  const onlyInEnUS = [...enKeys].filter((key) => !zhKeys.has(key)).sort()
  const onlyInZhCN = [...zhKeys].filter((key) => !enKeys.has(key)).sort()

  assert.deepEqual(onlyInEnUS, [])
  assert.deepEqual(onlyInZhCN, [])
})

test('every plugin locale contribution keeps en-US and zh-CN aligned', async () => {
  for (const packageDir of await discoverPackageDirs()) {
    const manifest = await readPackageManifest(packageDir)
    const entries = manifest.frontend?.locales ?? {}
    const locales = await Promise.all(
      Object.entries(entries).map(async ([locale, entry]) => {
        const loaded = await importModule(path.resolve(packageDir, entry))
        return [locale, new Set(flattenLocaleKeys(loaded.default))]
      })
    )
    if (locales.length === 0) continue
    const [first, ...rest] = locales.map(([, keys]) => keys)
    for (const keys of rest) {
      const missing = [...first].filter((key) => !keys.has(key)).sort()
      const extra = [...keys].filter((key) => !first.has(key)).sort()
      assert.deepEqual(missing, [])
      assert.deepEqual(extra, [])
    }
  }
})

test('client token status types and locale entries stay aligned', async () => {
  const { enUS, zhCN } = await loadCoreLocales()
  const backendStatuses = (await extractBackendClientTokenStatuses()).sort()
  const frontendStatuses = (await extractFrontendClientTokenStatuses()).sort()
  const enStatusKeys = Object.keys(enUS.clients.status).sort()
  const zhStatusKeys = Object.keys(zhCN.clients.status).sort()

  assert.deepEqual(frontendStatuses, backendStatuses)
  assert.deepEqual(enStatusKeys, backendStatuses)
  assert.deepEqual(zhStatusKeys, backendStatuses)
})

test('locale key sets stay pinned for the full, per-removal and zero-plugin scenarios', async () => {
  const allPackageDirs = await discoverPackageDirs()
  const full = await collectAvailableKeys(allPackageDirs)
  const zero = await collectAvailableKeys([])
  const { enUS, zhCN } = await loadCoreLocales()
  const coreKeys = {
    'en-US': new Set(flattenLocaleKeys(enUS)),
    'zh-CN': new Set(flattenLocaleKeys(zhCN))
  }

  const presentSlugs = new Set(allPackageDirs.map(dir => path.basename(dir)))


  for (const [slug, keys] of Object.entries(PINNED_PACKAGE_ONLY_LOCALE_KEYS)) {
    for (const key of keys) {
      if (presentSlugs.has(slug)) {
        assert.ok(full['en-US'].has(key), `full scenario must provide ${key}`)
        assert.ok(full['zh-CN'].has(key), `full scenario must provide ${key} (zh-CN)`)
      } else {
        assert.ok(!full['en-US'].has(key), `removed ${slug} must not provide ${key}`)
        assert.ok(!full['zh-CN'].has(key), `removed ${slug} must not provide ${key} (zh-CN)`)
      }
    }
  }


  for (const locale of ['en-US', 'zh-CN']) {
    assert.deepEqual([...zero[locale]].sort(), [...coreKeys[locale]].sort())
    for (const keys of Object.values(PINNED_PACKAGE_ONLY_LOCALE_KEYS)) {
      for (const key of keys) {
        assert.ok(!zero[locale].has(key), `zero-plugin scenario must not provide ${key}`)
      }
    }
  }


  for (const slug of presentSlugs) {
    const remaining = allPackageDirs.filter((dir) => path.basename(dir) !== slug)
    const without = await collectAvailableKeys(remaining)
    for (const key of PINNED_PACKAGE_ONLY_LOCALE_KEYS[slug] ?? []) {
      assert.ok(!without['en-US'].has(key), `removing ${slug} must drop ${key}`)
      assert.ok(!without['zh-CN'].has(key), `removing ${slug} must drop ${key} (zh-CN)`)
    }
    for (const [other, keys] of Object.entries(PINNED_PACKAGE_ONLY_LOCALE_KEYS)) {
      if (other === slug || !presentSlugs.has(other)) continue
      for (const key of keys) {
        assert.ok(without['en-US'].has(key), `${key} must stay after removing ${slug}`)
      }
    }
  }


  const coreUsedKeys = await consumeLiteralKeys(await walkFiles(frontendSrcRoot))
  const unresolved = coreUsedKeys.filter((key) => !coreKeys['en-US'].has(key))
  assert.deepEqual(unresolved, [])
})

const scanForHardcodedUiStrings = async (files, sourceRoot) => {
  const vueFiles = files.filter((f) => f.endsWith('.vue'))
  const violations = []

  const textNodePattern = />([^<>{}]*[A-Za-z]{2,}[^<>{}]*)</

  const uiAttrPattern = /(?<![:\w-])(placeholder|title|label|aria-label|text|alt)="([^"{}]*[A-Za-z]{2,}[^"{}]*)"/
  const toastLiteralPattern = /['"`][A-Za-z][A-Za-z .,:!?'\-]*['"`]/

  const brandTerms = new Set(['Woe'])

  for (const filePath of vueFiles) {
    const content = await fs.readFile(filePath, 'utf8')
    const rel = path.relative(sourceRoot, filePath)
    const lines = content.split('\n')
    const templateStart = lines.findIndex((l) => l.trim() === '<template>')
    const templateEnd = lines.map((l) => l.trim()).lastIndexOf('</template>')

    lines.forEach((line, idx) => {
      const inTemplate = templateStart !== -1 && idx > templateStart && idx < templateEnd
      const bare = line.replace(/<!--.*?-->/g, '').replace(/&[a-zA-Z]+;/g, '')

      if (inTemplate) {
        const textHit = bare.match(textNodePattern)
        if (textHit && textHit[1].trim().length >= 2 && !brandTerms.has(textHit[1].trim())) {
          violations.push(`${rel}:${idx + 1} text: ${textHit[1].trim().slice(0, 40)}`)
        }
        const attrHit = bare.match(uiAttrPattern)
        if (attrHit) {
          violations.push(`${rel}:${idx + 1} attr ${attrHit[1]}: ${attrHit[2].slice(0, 40)}`)
        }
      }

      const isToastCall = /showError\(|showSuccess\(|showWarning\(/.test(bare)
      if (isToastCall && toastLiteralPattern.test(bare) && !/\bt\(/.test(bare)) {
        violations.push(`${rel}:${idx + 1} toast literal: ${bare.trim().slice(0, 60)}`)
      }
      if (isToastCall && /\|\|\s*['"`]/.test(bare)) {
        violations.push(`${rel}:${idx + 1} toast fallback: ${bare.trim().slice(0, 60)}`)
      }
    })
  }

  return violations
}

test('vue templates and toast calls contain no hardcoded UI strings', async () => {
  const packageRoots = []
  const coreFiles = await walkFiles(frontendSrcRoot)
  for (const packageDir of await discoverPackageDirs()) {
    const files = await packageFrontendSourceFiles(packageDir)
    if (files.length > 0) packageRoots.push({ files, root: path.join(packageDir, 'frontend') })
  }

  const violations = [
    ...await scanForHardcodedUiStrings(coreFiles, frontendSrcRoot),
    ...await Promise.all(packageRoots.map(({ files, root }) => scanForHardcodedUiStrings(files, root)))
  ].flat()

  assert.deepEqual(violations, [])
})
