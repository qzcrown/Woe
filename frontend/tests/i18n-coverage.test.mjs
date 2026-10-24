import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'
import { pathToFileURL } from 'node:url'

const frontendRoot = path.resolve('frontend')
const frontendSrcRoot = path.join(frontendRoot, 'src')
const backendSrcRoot = path.resolve('src')

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

const literalTranslationKeyPattern = /(?<![\w$])(?:\$t|t)\(\s*["']([^"'`]+)["']/g

const collectLiteralTranslationKeys = async () => {
  const files = await walkFiles(frontendSrcRoot)
  const keys = new Set()

  for (const filePath of files) {
    const content = await fs.readFile(filePath, 'utf8')
    for (const match of content.matchAll(literalTranslationKeyPattern)) {
      keys.add(match[1])
    }
  }

  return [...keys].sort()
}

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

const loadLocales = async () => {
  const enUS = (await importModule(path.join(frontendSrcRoot, 'locales', 'en-US.ts'))).default
  const zhCN = (await importModule(path.join(frontendSrcRoot, 'locales', 'zh-CN.ts'))).default
  return { enUS, zhCN }
}

test('frontend literal translation keys exist in both locales', async () => {
  const { enUS, zhCN } = await loadLocales()
  const [usedKeys, enKeys, zhKeys] = await Promise.all([
    collectLiteralTranslationKeys(),
    Promise.resolve(new Set(flattenLocaleKeys(enUS))),
    Promise.resolve(new Set(flattenLocaleKeys(zhCN)))
  ])

  const missingInEnUS = usedKeys.filter((key) => !enKeys.has(key))
  const missingInZhCN = usedKeys.filter((key) => !zhKeys.has(key))

  assert.deepEqual(missingInEnUS, [])
  assert.deepEqual(missingInZhCN, [])
})

test('en-US and zh-CN locale files expose the same translation keys', async () => {
  const { enUS, zhCN } = await loadLocales()
  const enKeys = new Set(flattenLocaleKeys(enUS))
  const zhKeys = new Set(flattenLocaleKeys(zhCN))

  const onlyInEnUS = [...enKeys].filter((key) => !zhKeys.has(key)).sort()
  const onlyInZhCN = [...zhKeys].filter((key) => !enKeys.has(key)).sort()

  assert.deepEqual(onlyInEnUS, [])
  assert.deepEqual(onlyInZhCN, [])
})

test('client token status types and locale entries stay aligned', async () => {
  const { enUS, zhCN } = await loadLocales()
  const backendStatuses = (await extractBackendClientTokenStatuses()).sort()
  const frontendStatuses = (await extractFrontendClientTokenStatuses()).sort()
  const enStatusKeys = Object.keys(enUS.clients.status).sort()
  const zhStatusKeys = Object.keys(zhCN.clients.status).sort()

  assert.deepEqual(frontendStatuses, backendStatuses)
  assert.deepEqual(enStatusKeys, backendStatuses)
  assert.deepEqual(zhStatusKeys, backendStatuses)
})

test('vue templates and toast calls contain no hardcoded UI strings', async () => {
  const files = await walkFiles(frontendSrcRoot)
  const vueFiles = files.filter((f) => f.endsWith('.vue'))
  const violations = []

  const textNodePattern = />([^<>{}]*[A-Za-z]{2,}[^<>{}]*)</

  const uiAttrPattern = /(?<![:\w-])(placeholder|title|label|aria-label|text|alt)="([^"{}]*[A-Za-z]{2,}[^"{}]*)"/
  const toastLiteralPattern = /['"`][A-Za-z][A-Za-z .,:!?'\-]*['"`]/

  const brandTerms = new Set(['Woe'])

  for (const filePath of vueFiles) {
    const content = await fs.readFile(filePath, 'utf8')
    const rel = path.relative(frontendSrcRoot, filePath)
    const lines = content.split('\n')
    const templateStart = lines.findIndex((l) => l.trim() === '<template>')
    const templateEnd = lines.map((l) => l.trim()).lastIndexOf('</template>')

    lines.forEach((line, idx) => {
      const inTemplate = templateStart !== -1 && idx > templateStart && idx < templateEnd
      const bare = line.replace(/<!--[\s\S]*?--!?>/g, '').replace(/&[a-zA-Z]+;/g, '')

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

  assert.deepEqual(violations, [])
})
