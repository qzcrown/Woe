







import {
  TAG_MAX_COUNT,
  TAGS_EXTRAS_KEY,
  mergeTags,
  readExtrasForTags,
  readTags
} from '../../src/services/messageTagsService'
import {
  TAG_MAX_CODEPOINTS,
  codepointLength,
  isValidTag,
  normalizeTagList
} from '../../src/services/messageTagRules'

describe('messageTagRules', () => {
  test('码点计数按 Unicode 码点而不是 UTF-16 单元', () => {
    expect(codepointLength('abc')).toBe(3)
    expect(codepointLength('😀')).toBe(1)
    expect(codepointLength('😀a')).toBe(2)
  })

  test('单项规则：trim 后非空且不超过 64 码点', () => {
    expect(isValidTag('工作')).toBe(true)
    expect(isValidTag('a'.repeat(64))).toBe(true)
    expect(isValidTag('a'.repeat(65))).toBe(false)
    expect(isValidTag('😀'.repeat(64))).toBe(true)
    expect(isValidTag('😀'.repeat(65))).toBe(false)
    expect(isValidTag('   ')).toBe(false)
    expect(isValidTag('  ok  ')).toBe(true)
    expect(isValidTag(42)).toBe(false)
    expect(isValidTag(null)).toBe(false)
  })

  test('去重保持首次出现顺序并 trim', () => {
    expect(normalizeTagList([' b ', 'a', 'b', '  ', 'c'])).toEqual(['b', 'a', 'c'])
    expect(normalizeTagList(['x', ' x ', 'y'])).toEqual(['x', 'y'])
  })

  test('TAG_MAX_COUNT 由规则模块唯一定义（service 只 re-export）', () => {
    expect(TAG_MAX_COUNT).toBe(10)
    expect(TAG_MAX_CODEPOINTS).toBe(64)
  })
})

describe('readExtrasForTags', () => {
  test('null/空串视为尚未写入任何标签', () => {
    expect(readExtrasForTags(null)).toEqual({ ok: true, extras: {} })
    expect(readExtrasForTags(undefined)).toEqual({ ok: true, extras: {} })
    expect(readExtrasForTags('   ')).toEqual({ ok: true, extras: {} })
  })

  test('合法对象原样返回', () => {
    expect(readExtrasForTags('{"a":1}')).toEqual({ ok: true, extras: { a: 1 } })
  })

  test('非法 JSON 与非对象顶层都是 corrupted（不静默重建）', () => {
    expect(readExtrasForTags('not-json')).toEqual({ ok: false, reason: 'corrupted' })
    expect(readExtrasForTags('[1,2]')).toEqual({ ok: false, reason: 'corrupted' })
    expect(readExtrasForTags('"text"')).toEqual({ ok: false, reason: 'corrupted' })
    expect(readExtrasForTags('null')).toEqual({ ok: false, reason: 'corrupted' })
  })
})

describe('readTags', () => {
  test('缺省与空对象都返回空数组', () => {
    expect(readTags(undefined)).toEqual({ ok: true, tags: [] })
    expect(readTags({})).toEqual({ ok: true, tags: [] })
  })

  test('合法字符串数组返回原值（读侧不改写历史身份）', () => {
    expect(readTags({ [TAGS_EXTRAS_KEY]: ['a', '  b  '] })).toEqual({
      ok: true,
      tags: ['a', '  b  ']
    })
  })

  test('非数组 / 含非字符串 / 全空白项 -> invalid-tags', () => {
    expect(readTags({ [TAGS_EXTRAS_KEY]: 'a' })).toEqual({ ok: false, reason: 'invalid-tags' })
    expect(readTags({ [TAGS_EXTRAS_KEY]: ['a', 1] })).toEqual({
      ok: false,
      reason: 'invalid-tags'
    })
    expect(readTags({ [TAGS_EXTRAS_KEY]: ['   '] })).toEqual({
      ok: false,
      reason: 'invalid-tags'
    })
  })

  test('总上限 TAG_MAX_COUNT 在读侧同样强制：超过即 invalid-tags（不截断）', () => {
    const full = Array.from({ length: TAG_MAX_COUNT }, (_, i) => `t${i}`)
    expect(readTags({ [TAGS_EXTRAS_KEY]: [] })).toEqual({ ok: true, tags: [] })
    expect(readTags({ [TAGS_EXTRAS_KEY]: full })).toEqual({ ok: true, tags: full })


    expect(readTags({ [TAGS_EXTRAS_KEY]: [...full, 'overflow'] })).toEqual({
      ok: false,
      reason: 'invalid-tags'
    })

    const eleven = Array.from({ length: TAG_MAX_COUNT + 1 }, (_, i) => `tag-${i}`)
    expect(readTags({ [TAGS_EXTRAS_KEY]: eleven })).toEqual({
      ok: false,
      reason: 'invalid-tags'
    })
  })
})

describe('mergeTags', () => {
  test('追加去重、trim，保持既有顺序', () => {
    expect(mergeTags(['a'], [' a ', 'b', 'b'])).toEqual({
      ok: true,
      tags: ['a', 'b'],
      changed: true
    })
  })

  test('没有新标签时 changed=false', () => {
    expect(mergeTags(['a', 'b'], ['b', ' a '])).toEqual({
      ok: true,
      tags: ['a', 'b'],
      changed: false
    })
  })

  test('已有 10 个标签时追加第 11 个 fail-loud（不截断）', () => {
    const existing = Array.from({ length: TAG_MAX_COUNT }, (_, i) => `t${i}`)
    expect(mergeTags(existing, ['overflow'])).toEqual({
      ok: false,
      reason: 'capacity-exceeded'
    })
  })

  test('容量已满但没有新项时仍为 unchanged', () => {
    const existing = Array.from({ length: TAG_MAX_COUNT }, (_, i) => `t${i}`)
    expect(mergeTags(existing, ['t0', ' t1 '])).toEqual({
      ok: true,
      tags: existing,
      changed: false
    })
  })
})
