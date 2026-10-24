import { describe, it, expect, vi } from 'vitest'
import {
  base64UrlEncode,
  base64UrlDecode,
  isEnhancedTokenForm,
  derivePublicForm,
} from '@/utils/enhancedToken'
import { resolveAppTokenState, type AppTokenState } from '@/utils/appToken'






const PRIVATE_FORM = 'gtfya.AQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'
const PUBLIC_FORM = 'gtfya.zswVB9wd3XKVlRwpCIjwla25BE0bc9aW5t8GXWg71Pw'

const PUBLIC_FORM_EQUIV = 'gtfya.zswVB9wd3XKVlRwpCIjwla25BE0bc9aW5t8GXWg71Py'

const bytes = (n: number, fill = 1) => new Uint8Array(n).fill(fill)
const form = (ident: string, payload: string) => `gtfy${ident}.${payload}`



describe('base64UrlEncode/base64UrlDecode', () => {
  it.each([
    [0],
    [1],
    [2],
    [3],
    [31],
    [32],
    [33],
    [255],
  ])('round-trip %i 字节', (size) => {
    const original = bytes(size, (size + 7) % 256)
    const decoded = base64UrlDecode(base64UrlEncode(original))
    expect(decoded).not.toBeNull()
    expect(Array.from(decoded!)).toEqual(Array.from(original))
  })

  it('空字节编解码:空数组编码为空串,空串解码为空字节数组(非 null)', () => {
    expect(base64UrlEncode(new Uint8Array(0))).toBe('')
    const decoded = base64UrlDecode('')
    expect(decoded).not.toBeNull()
    expect(decoded!.length).toBe(0)
  })

  it('固定 seed 编码值与后端一致', () => {
    const seed = bytes(32, 0)
    seed[0] = 1
    expect(base64UrlEncode(seed)).toBe(PRIVATE_FORM.slice('gtfya.'.length))
  })

  it.each([
    ['a'],
    ['abcde'],
    ['ab=c'],
    ['abc='],
    ['a+b'],
    ['a/b'],
  ])('解码拒绝非法输入 %s', (input) => {
    expect(base64UrlDecode(input)).toBeNull()
  })

  it('等价尾部编码解码为相同字节(先用本解码器验证,再供 resolver 字节比较测试)', () => {
    expect(PUBLIC_FORM.length).toBe(PUBLIC_FORM_EQUIV.length)
    const canonical = base64UrlDecode(PUBLIC_FORM.slice('gtfya.'.length))
    const variant = base64UrlDecode(PUBLIC_FORM_EQUIV.slice('gtfya.'.length))
    expect(canonical).not.toBeNull()
    expect(variant).not.toBeNull()
    expect(Array.from(variant!)).toEqual(Array.from(canonical!))

    expect(PUBLIC_FORM_EQUIV).not.toBe(PUBLIC_FORM)
  })
})



describe('isEnhancedTokenForm', () => {
  it.each([
    [undefined],
    [null],
    [123],
    [0],
    [true],
    [{ token: 'gtfya.abc' }],
    [['gtfya.abc']],
  ])('非字符串 → false (%s)', (input) => {
    expect(isEnhancedTokenForm(input)).toBe(false)
  })

  it.each([
    [''],
    ['A-app-token'],
    [' gtfya.abc'],
    ['GTFYa.abc'],
  ])('非 gtfy 前缀字符串 → false (%s)', (input) => {
    expect(isEnhancedTokenForm(input)).toBe(false)
  })

  it.each([
    ['gtfy'],
    ['gtfygarbage'],
    ['gtfya.abc'],
    ['gtfyc.abc'],
    ['gtfya.a.b.c'],
    ['gtfy.'],
  ])('任何 gtfy 前缀 → true (%s)', (input) => {
    expect(isEnhancedTokenForm(input)).toBe(true)
  })
})



describe('derivePublicForm', () => {
  it('固定 seed 向量:派生出规范 publicForm', () => {
    expect(derivePublicForm(PRIVATE_FORM)).toBe(PUBLIC_FORM)
  })

  it('兼容后端允许的其他 ident(含生成期替换的 "_")', () => {
    const seed = bytes(32, 0)
    seed[0] = 1
    const seedPayload = base64UrlEncode(seed)
    expect(derivePublicForm(form('b', seedPayload))).toBe(form('b', PUBLIC_FORM.slice('gtfya.'.length)))
    expect(derivePublicForm(form('_x', seedPayload))).toBe(form('_x', PUBLIC_FORM.slice('gtfya.'.length)))
  })

  it.each([
    [undefined],
    [null],
    [123],
    [true],
    [{ toString: () => 'gtfya.abc' }],
    [[]],
    [''],
    ['gtfygarbage'],
    ['gtfy'],
    [form('a', '')],
    ['gtfya.a.b'],
    ['gtfya.a.b.c'],
    [form('a', 'ab=c')],
    [form('a', '+++')],
    [form('a', 'a')],
    [form('a', base64UrlEncode(bytes(31, 9)))],
    [form('a', base64UrlEncode(bytes(33, 9)))],
  ])('非法/错误长度输入 → null,不抛出 (%s)', (input) => {
    expect(derivePublicForm(input)).toBeNull()
  })

  it('派生异常不抛出到 UI:敌意输入统一返回 null', () => {
    const hostile: unknown[] = [
      Symbol('x'),
      { [Symbol.toPrimitive]: () => { throw new Error('boom') } },
      'gtfya.' + 'A'.repeat(100000),
    ]
    for (const input of hostile) {
      expect(() => derivePublicForm(input)).not.toThrow()
      expect(derivePublicForm(input)).toBeNull()
    }
  })
})



describe('resolveAppTokenState — server 侧不可信输入', () => {
  it.each([
    [undefined],
    [null],
    [''],
    ['   '],
    [' \t\n '],
    [123],
    [0],
    [true],
    [{ token: 'x' }],
    [[]],
  ])('非字符串/空/全空白 → unknown (%s)', (input) => {
    expect(resolveAppTokenState(input, PRIVATE_FORM)).toEqual({ kind: 'unknown' })
  })

  it.each([
    ['gtfygarbage'],
    ['gtfy'],
    [form('a', '')],
    ['gtfya.a.b'],
    ['gtfya.a.b.c'],
    [form('a', 'ab=c')],
    [form('a', 'a+b')],
    [form('a', base64UrlEncode(bytes(31, 9)))],
    [form('a', base64UrlEncode(bytes(33, 9)))],
  ])('gtfy 前缀但非合法两段 32B publicForm → unknown,保留缓存 (%s)', (input) => {
    expect(resolveAppTokenState(input, PRIVATE_FORM)).toEqual({ kind: 'unknown' })
  })

  it('危险输入区分新逻辑:gtfygarbage 在旧"前缀+段数降级"下会变 legacy,现在必须是 unknown', () => {
    const state = resolveAppTokenState('gtfygarbage', null)
    expect(state.kind).toBe('unknown')
    expect(state).not.toEqual({ kind: 'legacy', token: 'gtfygarbage' })
  })

  it('非 gtfy 非空 server → legacy(原值透传,含空白)', () => {
    expect(resolveAppTokenState('A-app-token', null)).toEqual({ kind: 'legacy', token: 'A-app-token' })
    expect(resolveAppTokenState(' tok-1 ', PRIVATE_FORM)).toEqual({ kind: 'legacy', token: ' tok-1 ' })
  })
})

describe('resolveAppTokenState — local 侧与 valid/invalid 判定', () => {
  it('本地缺失(null/undefined)/空串/非字符串 → unknown', () => {
    expect(resolveAppTokenState(PUBLIC_FORM, null)).toEqual({ kind: 'unknown' })
    expect(resolveAppTokenState(PUBLIC_FORM, undefined)).toEqual({ kind: 'unknown' })
    expect(resolveAppTokenState(PUBLIC_FORM, '')).toEqual({ kind: 'unknown' })
    expect(resolveAppTokenState(PUBLIC_FORM, '   ')).toEqual({ kind: 'unknown' })
    expect(resolveAppTokenState(PUBLIC_FORM, 123)).toEqual({ kind: 'unknown' })
    expect(resolveAppTokenState(PUBLIC_FORM, {})).toEqual({ kind: 'unknown' })
  })

  it('固定向量:派生一致 → valid,token 为本地 privateForm', () => {
    const state: AppTokenState = resolveAppTokenState(PUBLIC_FORM, PRIVATE_FORM)
    expect(state).toEqual({ kind: 'valid', token: PRIVATE_FORM })
  })

  it('等价尾部编码的 server 值按公钥字节比对 → valid,不误判轮换', () => {
    expect(resolveAppTokenState(PUBLIC_FORM_EQUIV, PRIVATE_FORM)).toEqual({
      kind: 'valid',
      token: PRIVATE_FORM,
    })
  })

  it('本地 privateForm 的等价尾部编码经规范重编码后匹配 → valid', () => {
    const seed = bytes(32, 0)
    seed[0] = 1
    const seedPayload = base64UrlEncode(seed)
    const localEquiv = form('a', seedPayload.slice(0, seedPayload.length - 1) + 'C')

    expect(base64UrlDecode(localEquiv.slice('gtfya.'.length))).not.toBeNull()
    expect(localEquiv).not.toBe(PRIVATE_FORM)
    expect(resolveAppTokenState(PUBLIC_FORM, localEquiv)).toEqual({ kind: 'valid', token: localEquiv })
  })

  it('兼容后端允许的其他 ident:同 ident 同公钥字节 → valid', () => {
    const seed = bytes(32, 0)
    seed[0] = 1
    expect(resolveAppTokenState(form('b', PUBLIC_FORM.slice('gtfya.'.length)), form('b', base64UrlEncode(seed))))
      .toEqual({ kind: 'valid', token: form('b', base64UrlEncode(seed)) })
  })

  it('不同 seed(同 ident 不同密钥)→ invalid;不同密钥各自成对时 valid', () => {

    const seed2 = bytes(32, 0)
    seed2[0] = 2
    const privateForm2 = form('a', base64UrlEncode(seed2))
    const publicForm2 = derivePublicForm(privateForm2)
    expect(publicForm2).not.toBeNull()
    expect(publicForm2).not.toBe(PUBLIC_FORM)

    expect(resolveAppTokenState(PUBLIC_FORM, privateForm2)).toEqual({ kind: 'invalid' })

    expect(resolveAppTokenState(publicForm2, privateForm2)).toEqual({
      kind: 'valid',
      token: privateForm2,
    })
  })

  it.each([
    ['公钥误存为本地 seed', PUBLIC_FORM],
    ['旧格式本地值', 'A-app-token'],
    ['四段签名形式本地值', `gtfya.${PUBLIC_FORM.slice('gtfya.'.length)}.1700000000.${base64UrlEncode(bytes(64, 3))}`],
    ['三段本地值', 'gtfya.abc.def'],
  ])('合法 gtfy server + %s → invalid(缓存确属过期)', (_name, local) => {
    expect(resolveAppTokenState(PUBLIC_FORM, local)).toEqual({ kind: 'invalid' })
  })

  it('ident 不同 → invalid(即使公钥字节一致)', () => {
    const seed = bytes(32, 0)
    seed[0] = 1

    expect(
      resolveAppTokenState(PUBLIC_FORM, form('b', base64UrlEncode(seed)))
    ).toEqual({ kind: 'invalid' })
  })

  it('纯函数:不触碰 localStorage(unknown/invalid 路径的缓存处置归调用方)', () => {
    const setSpy = vi.spyOn(Storage.prototype, 'setItem')
    const removeSpy = vi.spyOn(Storage.prototype, 'removeItem')
    try {
      resolveAppTokenState(PUBLIC_FORM, PRIVATE_FORM)
      resolveAppTokenState(PUBLIC_FORM, null)
      resolveAppTokenState('gtfygarbage', PRIVATE_FORM)
      resolveAppTokenState(PUBLIC_FORM, 'A-app-token')
      resolveAppTokenState('A-app-token', PRIVATE_FORM)
      expect(setSpy).not.toHaveBeenCalled()
      expect(removeSpy).not.toHaveBeenCalled()
    } finally {
      setSpy.mockRestore()
      removeSpy.mockRestore()
    }
  })
})
