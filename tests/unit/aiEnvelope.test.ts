







import {
  mapHttpStatusToFailureKind,
  maxResponseBytes,
  parseOpenAiChatCompletion,
  parseRetryAfterMs,
  parseWorkersAiText
} from '../../src/services/ai/envelope'

describe('parseOpenAiChatCompletion', () => {
  it('提取 choices[0].message.content 与 usage', () => {
    const result = parseOpenAiChatCompletion(
      {
        choices: [{ message: { role: 'assistant', content: 'hello' } }],
        usage: { prompt_tokens: 11, completion_tokens: 7 }
      },
      200
    )

    expect(result).toEqual({
      ok: true,
      text: 'hello',
      httpStatus: 200,
      usage: { inputTokens: 11, outputTokens: 7 }
    })
  })

  it('缺少 usage 时不带 usage 字段', () => {
    const result = parseOpenAiChatCompletion({ choices: [{ message: { content: 'hi' } }] })

    expect(result).toEqual({ ok: true, text: 'hi' })
    expect('usage' in result).toBe(false)
  })

  it.each([
    ['null root', null],
    ['非对象 root', 'not-json'],
    ['数组 root', []],
    ['缺少 choices', {}],
    ['choices 非数组', { choices: 'nope' }],
    ['空 choices', { choices: [] }],
    ['缺少 message', { choices: [{ text: 'hi' }] }],
    ['content 为 null', { choices: [{ message: { content: null } }] }],
    ['content 非字符串', { choices: [{ message: { content: 42 } }] }],
    ['content 为空串', { choices: [{ message: { content: '' } }] }]
  ])('%s → invalid-envelope', (_label, payload) => {
    expect(parseOpenAiChatCompletion(payload, 200)).toEqual({
      ok: false,
      failureKind: 'invalid-envelope',
      httpStatus: 200
    })
  })

  it('未知对象不抛错，返回 invalid-envelope', () => {
    const payload = { choices: [{ message: { content: {} } }], usage: { prompt_tokens: 'x' } }

    expect(() => parseOpenAiChatCompletion(payload)).not.toThrow()
    expect(parseOpenAiChatCompletion(payload)).toEqual({
      ok: false,
      failureKind: 'invalid-envelope'
    })
  })
})

describe('parseWorkersAiText', () => {
  it('提取 response 并归一 prompt_tokens/completion_tokens', () => {
    expect(
      parseWorkersAiText({ response: 'world', usage: { prompt_tokens: 3, completion_tokens: 5 } })
    ).toEqual({ ok: true, text: 'world', usage: { inputTokens: 3, outputTokens: 5 } })
  })

  it('支持 input_tokens/output_tokens 形式', () => {
    expect(
      parseWorkersAiText({ response: 'world', usage: { input_tokens: 2, output_tokens: 4 } })
    ).toEqual({ ok: true, text: 'world', usage: { inputTokens: 2, outputTokens: 4 } })
  })

  it('usage 缺失时不带 usage 字段', () => {
    const result = parseWorkersAiText({ response: 'world' })

    expect(result).toEqual({ ok: true, text: 'world' })
    expect('usage' in result).toBe(false)
  })

  it.each([
    ['null root', null],
    ['数组 root', []],
    ['缺少 response', {}],
    ['response 非字符串', { response: 123 }],
    ['response 为空串', { response: '' }]
  ])('%s → invalid-envelope', (_label, payload) => {
    expect(parseWorkersAiText(payload)).toEqual({
      ok: false,
      failureKind: 'invalid-envelope'
    })
  })
})

describe('mapHttpStatusToFailureKind', () => {
  it.each([
    [401, 'auth'],
    [403, 'auth'],
    [402, 'quota'],
    [429, 'rate_limit'],
    [404, 'model'],
    [301, 'config'],
    [302, 'config'],
    [307, 'config'],
    [500, 'network'],
    [503, 'network'],
    [418, 'unknown']
  ] as const)('%i → %s', (status, kind) => {
    expect(mapHttpStatusToFailureKind(status)).toBe(kind)
  })

  it('400 且 body 提示 model 不存在 → model', () => {
    expect(
      mapHttpStatusToFailureKind(
        400,
        JSON.stringify({ error: { message: 'The model `gpt-x` does not exist' } })
      )
    ).toBe('model')
  })

  it('400 其他原因 → config', () => {
    expect(mapHttpStatusToFailureKind(400, JSON.stringify({ error: 'bad request' }))).toBe(
      'config'
    )
    expect(mapHttpStatusToFailureKind(400)).toBe('config')
  })
})

describe('parseRetryAfterMs', () => {
  it('整数秒 → 毫秒', () => {
    expect(parseRetryAfterMs('30', 0)).toBe(30_000)
    expect(parseRetryAfterMs(' 30 ', 0)).toBe(30_000)
  })

  it('HTTP-date → 相对 now 的毫秒', () => {
    const now = Date.parse('2015-10-21T07:23:00Z')
    expect(parseRetryAfterMs('Wed, 21 Oct 2015 07:28:00 GMT', now)).toBe(300_000)
  })

  it('过去的 HTTP-date 收敛为 0', () => {
    const now = Date.parse('2015-10-21T07:28:00Z')
    expect(parseRetryAfterMs('Wed, 21 Oct 2015 07:23:00 GMT', now)).toBe(0)
  })

  it.each([null, '', 'abc', '-5', '30.5'])('非法值 %p → undefined', (value) => {
    expect(parseRetryAfterMs(value, 0)).toBeUndefined()
  })
})

describe('maxResponseBytes', () => {
  it('固定为 1 MB', () => {
    expect(maxResponseBytes).toBe(1024 * 1024)
  })
})
