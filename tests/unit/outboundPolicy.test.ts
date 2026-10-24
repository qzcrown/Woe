





import {
  MAX_TIMEOUT_MS,
  OutboundHttpError,
  createOutboundHttp,
  validateOutboundUrl,
  type OutboundHttpErrorCode
} from '../../src/services/http/outboundPolicy'
import type { OutboundPolicyOptions } from '../../src/plugins/jobs/types'
import { maxResponseBytes } from '../../src/services/ai/envelope'

const rejectWith = (raw: string, reason: OutboundHttpErrorCode) => {
  expect(validateOutboundUrl(raw)).toEqual({ ok: false, reason })
}

const accept = (raw: string) => {
  const result = validateOutboundUrl(raw)
  expect(result.ok).toBe(true)
  if (result.ok) expect(result.url.href).toBe(new URL(raw).href)
}


const rejectUnder = (raw: string, reason: OutboundHttpErrorCode, policy: OutboundPolicyOptions) => {
  expect(validateOutboundUrl(raw, policy)).toEqual({ ok: false, reason })
}


const acceptUnder = (raw: string, policy: OutboundPolicyOptions) => {
  const result = validateOutboundUrl(raw, policy)
  expect(result.ok).toBe(true)
  if (result.ok) expect(result.url.href).toBe(new URL(raw).href)
}

describe('validateOutboundUrl', () => {
  it('只允许 https', () => {
    rejectWith('http://example.com/hook', 'insecure')
    rejectWith('ftp://example.com/hook', 'insecure')
    accept('https://example.com/hook')
  })

  it('拒绝 userinfo / query / fragment', () => {
    rejectWith('https://user:pass@example.com/hook', 'userinfo')
    rejectWith('https://user@example.com/hook', 'userinfo')
    rejectWith('https://example.com/hook?token=1', 'query')
    rejectWith('https://example.com/hook#frag', 'fragment')
  })

  it('拒绝 `..` 路径段，但不误伤含点号的文件名', () => {
    rejectWith('https://example.com/a/../b', 'traversal')
    rejectWith('https://example.com/..', 'traversal')
    rejectWith('https://example.com/a/%2E%2E/b', 'traversal')
    accept('https://example.com/a..b')
    accept('https://example.com/a.b/c')
  })

  it('拒绝反斜杠形态的 `..` 路径段（WHATWG 把 `\\` 当 `/`）', () => {
    rejectWith('https://example.com/a\\..\\b', 'traversal')
    rejectWith('https://example.com\\a\\..\\b', 'traversal')
    accept('https://example.com/a\\b..c\\d')
  })

  it('拒绝非法 URL', () => {
    rejectWith('', 'invalid')
    rejectWith('not a url', 'invalid')
    rejectWith('//example.com/hook', 'invalid')
  })

  it.each([
    'https://127.0.0.1/hook',
    'https://10.1.2.3/hook',
    'https://172.16.0.1/hook',
    'https://172.31.255.255/hook',
    'https://192.168.1.1/hook',
    'https://169.254.169.254/latest/meta-data',
    'https://0.0.0.0/hook',
    'https://100.64.0.1/hook',
    'https://100.127.255.255/hook',
    'https://224.0.0.1/hook',
    'https://239.255.255.255/hook',
    'https://240.0.0.1/hook',
    'https://255.255.255.255/hook'
  ])('拒绝私网/保留 IPv4：%s', (url) => {
    rejectWith(url, 'private-host')
  })

  it.each(['https://8.8.8.8/hook', 'https://172.32.0.1/hook', 'https://100.128.0.1/hook'])(
    '接受公网 IPv4：%s',
    (url) => {
      accept(url)
    }
  )

  it.each([

    'https://0x7f000001/hook',
    'https://2130706433/hook',
    'https://0177.0.0.1/hook',
    'https://127.1/hook',
    'https://0/hook'
  ])('拒绝被 URL 归一化为 loopback 的写法：%s', (url) => {
    rejectWith(url, 'private-host')
  })

  it.each(['https://012.0.0.1/hook', 'https://0x0a.0.0.1/hook'])(
    '拒绝被 URL 归一化为 10/8 的八进制/十六进制写法：%s',
    (url) => {
      rejectWith(url, 'private-host')
    }
  )



  it.each(['https://0x8.8.8.8/hook', 'https://010.0.0.1/hook'])(
    '接受被 URL 归一化为公网地址的写法：%s',
    (url) => {
      accept(url)
    }
  )

  it.each([
    'https://[::1]/hook',
    'https://[::]/hook',
    'https://[fc00::1]/hook',
    'https://[fd12:3456::1]/hook',
    'https://[fe80::1]/hook',
    'https://[::ffff:127.0.0.1]/hook',
    'https://[::ffff:10.0.0.1]/hook',
    'https://[::ffff:7f00:1]/hook'
  ])('拒绝 loopback/ULA/链路本地/IPv4-mapped IPv6：%s', (url) => {
    rejectWith(url, 'private-host')
  })

  it('接受公网 IPv6', () => {
    accept('https://[2001:4860:4860::8888]/hook')
    accept('https://[::ffff:8.8.8.8]/hook')
  })

  it.each([
    'https://localhost/hook',
    'https://LOCALHOST/hook',
    'https://localhost./hook',
    'https://x.localhost/hook',
    'https://foo.local/hook',
    'https://bar.internal/hook'
  ])('拒绝内部主机名：%s', (url) => {
    rejectWith(url, 'private-host')
  })

  it('接受普通公网域名', () => {
    accept('https://example.com/hook')
    accept('https://api.example.com/v1/chat/completions')
    accept('https://notlocalhost.com/hook')
  })
})

describe('validateOutboundUrl 策略开关（design §4.1）', () => {
  it('缺省策略保持严格：http/私网/query 一律拒绝（与不传 policy 等价）', () => {
    rejectUnder('http://example.com/hook', 'insecure', {})
    rejectUnder('https://127.0.0.1/hook', 'private-host', {})
    rejectUnder('https://example.com/hook?token=1', 'query', {})

    expect(validateOutboundUrl('http://example.com/hook', {})).toEqual(
      validateOutboundUrl('http://example.com/hook')
    )
  })

  it('allowHttp 放行 http://，但其他 scheme 仍拒绝', () => {
    acceptUnder('http://example.com/hook', { allowHttp: true })
    acceptUnder('http://api.example.com/v1', { allowHttp: true })
    rejectUnder('ftp://example.com/hook', 'insecure', { allowHttp: true })
    rejectUnder('ws://example.com/hook', 'insecure', { allowHttp: true })
  })

  it('allowPrivateNetwork 放行静态私网/环回/链路本地/内部主机名与 IPv4-mapped IPv6', () => {
    const policy = { allowPrivateNetwork: true }
    acceptUnder('https://127.0.0.1/hook', policy)
    acceptUnder('https://10.1.2.3/hook', policy)
    acceptUnder('https://192.168.1.1/hook', policy)
    acceptUnder('https://169.254.169.254/latest/meta-data', policy)
    acceptUnder('https://[::1]/hook', policy)
    acceptUnder('https://[fc00::1]/hook', policy)
    acceptUnder('https://[::ffff:10.0.0.1]/hook', policy)
    acceptUnder('https://localhost/hook', policy)
    acceptUnder('https://foo.internal/hook', policy)

    acceptUnder('https://8.8.8.8/hook', policy)
    acceptUnder('https://example.com/hook', policy)
  })

  it('allowQuery 放行 query string；userinfo/fragment/遍历仍拒绝', () => {
    const policy = { allowQuery: true }
    acceptUnder('https://example.com/hook?token=1&x=2', policy)
    acceptUnder('https://example.com/hook?', policy)
    rejectUnder('https://user:pass@example.com/hook?x=1', 'userinfo', policy)
    rejectUnder('https://example.com/hook?x=1#frag', 'fragment', policy)
    rejectUnder('https://example.com/a/../b?x=1', 'traversal', policy)
  })

  it('开关彼此独立：allowHttp 不放行私网，allowPrivateNetwork 不放行 http', () => {
    rejectUnder('http://10.0.0.1/hook', 'private-host', { allowHttp: true })
    rejectUnder('http://127.0.0.1/hook', 'insecure', { allowPrivateNetwork: true })
  })

  it('三个开关同时放行：http + 私网 + query 组合通过', () => {
    acceptUnder('http://192.168.1.1/hook?token=1', {
      allowHttp: true,
      allowPrivateNetwork: true,
      allowQuery: true
    })
  })
})

describe('createOutboundHttp', () => {
  const url = 'https://api.example.com/v1/chat/completions'

  it('非法 URL 抛可识别错误且不调用 fetch', async () => {
    const fetchMock = jest.fn()
    const http = createOutboundHttp({ fetch: fetchMock })

    await expect(http.fetch({ url: 'http://example.com', timeoutMs: 1000 })).rejects.toMatchObject({
      code: 'insecure'
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('强制 redirect: manual 并原样返回 3xx', async () => {
    const fetchMock = jest.fn(
      async () =>
        new Response('', {
          status: 302,
          headers: { location: 'https://elsewhere.example.com' }
        })
    ) as jest.Mock
    const http = createOutboundHttp({ fetch: fetchMock })

    const response = await http.fetch({ url, timeoutMs: 1000 })

    expect(response.status).toBe(302)
    expect(response.headers.get('location')).toBe('https://elsewhere.example.com')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ redirect: 'manual' })
  })

  it('成功响应被缓冲，调用方可再次读取 body', async () => {
    const fetchMock = jest.fn(
      async () =>
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        })
    )
    const http = createOutboundHttp({ fetch: fetchMock })

    const response = await http.fetch({ url, timeoutMs: 1000 })

    expect(response.headers.get('content-type')).toBe('application/json')
    expect(await response.text()).toBe('{"ok":true}')
  })



  it.each([205, 204, 304])('%i 无 body 响应正常返回，不被误判为 network', async (status) => {
    const fetchMock = jest.fn(async () => new Response(null, { status }))
    const http = createOutboundHttp({ fetch: fetchMock })

    const outcome = await http.fetch({ url, timeoutMs: 1_000 }).then(
      (response) => ({ ok: true as const, response }),
      (error: unknown) => ({ ok: false as const, error })
    )

    expect(outcome.ok).toBe(true)
    if (!outcome.ok) throw outcome.error
    expect(outcome.response.status).toBe(status)
    expect(await outcome.response.text()).toBe('')
  })

  it('超时抛 timeout 并清理 timer', async () => {
    jest.useFakeTimers()
    try {
      const fetchMock = jest.fn(
        (_url: string, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () => {
              reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))
            })
          })
      )
      const http = createOutboundHttp({ fetch: fetchMock as never })

      const promise = http.fetch({ url, timeoutMs: 1_000 })
      const assertion = expect(promise).rejects.toMatchObject({ code: 'timeout' })

      await Promise.resolve()
      jest.advanceTimersByTime(1_000)
      await assertion

      expect(jest.getTimerCount()).toBe(0)
    } finally {
      jest.useRealTimers()
    }
  })

  it('成功后不残留 timeout timer', async () => {
    jest.useFakeTimers()
    try {
      const fetchMock = jest.fn(async () => new Response('ok', { status: 200 }))
      const http = createOutboundHttp({ fetch: fetchMock })

      await http.fetch({ url, timeoutMs: 5_000 })

      expect(jest.getTimerCount()).toBe(0)
    } finally {
      jest.useRealTimers()
    }
  })

  it('超过 1 MB 响应体被拒绝', async () => {
    const fetchMock = jest.fn(
      async () => new Response('x'.repeat(maxResponseBytes + 1), { status: 200 })
    )
    const http = createOutboundHttp({ fetch: fetchMock })

    await expect(http.fetch({ url, timeoutMs: 1_000 })).rejects.toMatchObject({
      code: 'too-large'
    })
  })

  it('cancel 失败不能掩盖 too-large（cancel reject 不得升级为 network）', async () => {
    const oversized = new Uint8Array(maxResponseBytes + 1)
    const fakeResponse = {
      status: 200,
      statusText: 'OK',
      headers: new Headers(),
      body: {
        getReader: () => {
          let read = false
          return {
            read: async () => {
              if (read) return { done: true, value: undefined }
              read = true
              return { done: false, value: oversized }
            },
            cancel: async () => {
              throw new Error('cancel failed')
            },
            releaseLock: () => {}
          }
        }
      }
    } as unknown as Response

    const http = createOutboundHttp({ fetch: jest.fn(async () => fakeResponse) })

    const error = await http.fetch({ url, timeoutMs: 1_000 }).then(
      () => undefined,
      (err: unknown) => err
    )

    expect(error).toBeInstanceOf(OutboundHttpError)
    expect((error as OutboundHttpError).code).toBe('too-large')
  })

  it('网络错误归一为 network', async () => {
    const fetchMock = jest.fn(async () => {
      throw new TypeError('fetch failed')
    })
    const http = createOutboundHttp({ fetch: fetchMock })

    await expect(http.fetch({ url, timeoutMs: 1_000 })).rejects.toMatchObject({
      code: 'network'
    })
  })



  it.each([
    ['零', 0],
    ['负值', -1000],
    ['小数 0.5', 0.5],
    ['小数 1.5', 1.5],
    ['Infinity', Infinity],
    ['NaN', NaN],
    ['恰好超过上限 1ms', MAX_TIMEOUT_MS + 1],
    ['远超上限', 999_999]
  ])('非法 timeoutMs（%s）拒绝为 invalid-timeout 且不调用 fetch', async (_label, timeoutMs) => {
    const fetchMock = jest.fn()
    const http = createOutboundHttp({ fetch: fetchMock })

    await expect(http.fetch({ url, timeoutMs })).rejects.toMatchObject({
      code: 'invalid-timeout'
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('恰好等于 MAX_TIMEOUT_MS 是合法边界值', async () => {
    jest.useFakeTimers()
    try {
      const fetchMock = jest.fn(
        (_url: string, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () => {
              reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))
            })
          })
      )
      const http = createOutboundHttp({ fetch: fetchMock as never })

      const promise = http.fetch({ url, timeoutMs: MAX_TIMEOUT_MS })
      const assertion = expect(promise).rejects.toMatchObject({ code: 'timeout' })

      await Promise.resolve()
      jest.advanceTimersByTime(MAX_TIMEOUT_MS - 1)
      expect(fetchMock.mock.calls[0][1]?.signal?.aborted).toBe(false)

      jest.advanceTimersByTime(1)
      await assertion
      expect(jest.getTimerCount()).toBe(0)
    } finally {
      jest.useRealTimers()
    }
  })

  it('上限以内的 timeoutMs 原样生效（回归）', async () => {
    jest.useFakeTimers()
    try {
      const fetchMock = jest.fn(
        (_url: string, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () => {
              reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))
            })
          })
      )
      const http = createOutboundHttp({ fetch: fetchMock as never })

      const promise = http.fetch({ url, timeoutMs: 20_000 })
      const assertion = expect(promise).rejects.toMatchObject({ code: 'timeout' })

      await Promise.resolve()
      jest.advanceTimersByTime(19_999)
      expect(fetchMock.mock.calls[0][1]?.signal?.aborted).toBe(false)

      jest.advanceTimersByTime(1)
      await assertion
    } finally {
      jest.useRealTimers()
    }
  })

  it('错误信息只含固定 code，不含 URL/body', async () => {
    const fetchMock = jest.fn()
    const http = createOutboundHttp({ fetch: fetchMock })

    const error = await http.fetch({ url: 'https://example.com/a/../b', timeoutMs: 1000 }).then(
      () => undefined,
      (err: unknown) => err
    )

    expect(error).toBeInstanceOf(OutboundHttpError)
    const outboundError = error as OutboundHttpError
    expect(outboundError.message).toBe('traversal')
    expect(outboundError.message).not.toContain('example.com')
  })

  describe('policy 参数（design §4.1：createOutboundHttp 接受 OutboundPolicyOptions）', () => {
    it('策略放行的目标会真正出站（http + query）', async () => {
      const fetchMock = jest.fn(async () => new Response('ok', { status: 200 }))
      const http = createOutboundHttp({
        fetch: fetchMock,
        policy: { allowHttp: true, allowQuery: true }
      })

      const response = await http.fetch({ url: 'http://example.com/hook?token=1', timeoutMs: 1000 })

      expect(response.status).toBe(200)
      expect(fetchMock).toHaveBeenCalledTimes(1)
      expect(fetchMock).toHaveBeenCalledWith(
        'http://example.com/hook?token=1',
        expect.objectContaining({ redirect: 'manual' })
      )
    })

    it('策略未放行的维度仍在出站前拒绝', async () => {
      const fetchMock = jest.fn()
      const http = createOutboundHttp({ fetch: fetchMock, policy: { allowQuery: true } })

      await expect(http.fetch({ url: 'http://example.com/hook', timeoutMs: 1000 })).rejects.toMatchObject({
        code: 'insecure'
      })
      await expect(
        http.fetch({ url: 'https://127.0.0.1/hook', timeoutMs: 1000 })
      ).rejects.toMatchObject({ code: 'private-host' })
      expect(fetchMock).not.toHaveBeenCalled()
    })
  })
})
