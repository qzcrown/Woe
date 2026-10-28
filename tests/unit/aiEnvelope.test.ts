







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

describe('parseOpenAiChatCompletion 预算耗尽分类', () => {

  const withLength = (message: Record<string, unknown>, usage?: unknown) => ({
    choices: [{ message: { role: 'assistant', ...message }, finish_reason: 'length' }],
    ...(usage === undefined ? {} : { usage })
  })

  it.each([
    ['reasoning_content 为非空字符串', withLength({ content: '', reasoning_content: 'thought trail' })],
    ['reasoning 为非空字符串', withLength({ content: '', reasoning: 'thought trail' })],
    [
      '两个思考字段均无，usage 数值证据',
      withLength({ content: '' }, { completion_tokens: 256, completion_tokens_details: { reasoning_tokens: 256 } })
    ],
    ['content=null 且 reasoning_content 证据', withLength({ content: null, reasoning_content: 't' })],
    ['content 缺失 且 reasoning 证据', withLength({ reasoning: 't' })],
    [
      'content=null 且 usage 数值证据',
      withLength({ content: null }, { completion_tokens: 8, completion_tokens_details: { reasoning_tokens: 8 } })
    ]
  ])('%s → reasoning-starved', (_label, payload) => {
    expect(parseOpenAiChatCompletion(payload, 200)).toStrictEqual({
      ok: false,
      failureKind: 'reasoning-starved',
      httpStatus: 200
    })
  })

  it.each([
    ['content=42 即使有思考字段', withLength({ content: 42, reasoning_content: 't' })],
    ['content 为对象 即使有思考字段', withLength({ content: { a: 1 }, reasoning: 't' })],
    ['content 为数组 即使有思考字段', withLength({ content: ['x'], reasoning_content: 't' })],
    ['空思考字段且无 usage', withLength({ content: '', reasoning_content: '', reasoning: '' })],
    [
      "reasoning_tokens='256'（字符串）",
      withLength({ content: '' }, { completion_tokens: 256, completion_tokens_details: { reasoning_tokens: '256' } })
    ],
    [
      'reasoning_tokens=NaN',
      withLength({ content: '' }, { completion_tokens: 256, completion_tokens_details: { reasoning_tokens: Number.NaN } })
    ],
    [
      'reasoning_tokens=Infinity',
      withLength(
        { content: '' },
        { completion_tokens: 256, completion_tokens_details: { reasoning_tokens: Number.POSITIVE_INFINITY } }
      )
    ],
    [
      'reasoning_tokens=-1',
      withLength({ content: '' }, { completion_tokens: 256, completion_tokens_details: { reasoning_tokens: -1 } })
    ],
    [
      'reasoning_tokens=0',
      withLength({ content: '' }, { completion_tokens: 256, completion_tokens_details: { reasoning_tokens: 0 } })
    ],
    [
      'reasoning_tokens=0.5（非整数）',
      withLength({ content: '' }, { completion_tokens: 256, completion_tokens_details: { reasoning_tokens: 0.5 } })
    ],
    [
      'reasoning_tokens>completion_tokens',
      withLength({ content: '' }, { completion_tokens: 256, completion_tokens_details: { reasoning_tokens: 300 } })
    ],
    [
      '缺少 completion_tokens',
      withLength({ content: '' }, { completion_tokens_details: { reasoning_tokens: 10 } })
    ],
    [
      "completion_tokens='256'（非法）",
      withLength({ content: '' }, { completion_tokens: '256', completion_tokens_details: { reasoning_tokens: 10 } })
    ],
    [
      'completion_tokens_details 非对象',
      withLength({ content: '' }, { completion_tokens: 10, completion_tokens_details: 'nope' })
    ],
    ['usage 非对象且无其他证据', withLength({ content: '' }, 'not-an-object')],
    [
      'finish_reason=stop 即使有思考证据',
      { choices: [{ message: { role: 'assistant', content: '', reasoning_content: 't' }, finish_reason: 'stop' }] }
    ],
    [
      'finish_reason 缺失即使有思考证据',
      { choices: [{ message: { role: 'assistant', content: '', reasoning_content: 't' } }] }
    ]
  ])('%s → invalid-envelope', (_label, payload) => {
    expect(parseOpenAiChatCompletion(payload, 200)).toStrictEqual({
      ok: false,
      failureKind: 'invalid-envelope',
      httpStatus: 200
    })
  })

  it('无 httpStatus：结果只有 ok/failureKind，不出现 httpStatus 键', () => {
    const result = parseOpenAiChatCompletion(withLength({ content: '', reasoning_content: 'x' }))
    expect(result).toStrictEqual({ ok: false, failureKind: 'reasoning-starved' })
    expect('httpStatus' in result).toBe(false)
  })

  it('有 httpStatus：精确形状（httpStatus=200）', () => {
    const result = parseOpenAiChatCompletion(withLength({ content: '', reasoning_content: 'x' }), 200)
    expect(result).toStrictEqual({ ok: false, failureKind: 'reasoning-starved', httpStatus: 200 })
  })

  it("content='[]' 且有思考字段 → success，text='[]'，不返回思考字段", () => {
    const result = parseOpenAiChatCompletion({
      choices: [
        {
          message: { role: 'assistant', content: '[]', reasoning_content: 'private thought' },
          finish_reason: 'length'
        }
      ]
    })
    expect(result).toStrictEqual({ ok: true, text: '[]' })
  })

  it('思考原文（敏感哨兵）不进入失败结果', () => {
    const SENTINEL = 'SENTINEL-reasoning-raw-1a2b3c'
    const result = parseOpenAiChatCompletion(
      withLength({ content: '', reasoning_content: `hidden chain ${SENTINEL}` }),
      200
    )
    expect(result.ok).toBe(false)
    expect(JSON.stringify(result)).not.toContain(SENTINEL)
  })
})

describe('parseWorkersAiText', () => {





  const qwen3NativeChoices = (): Record<string, unknown> => ({
    id: 'chatcmpl-redacted-0001',
    object: 'chat.completion',
    created: 1_761_182_400,
    model: '@cf/qwen/qwen3-30b-a3b-fp8',
    choices: [
      {
        index: 0,
        finish_reason: 'stop',
        stop_reason: null,
        logprobs: null,
        message: {
          role: 'assistant',
          content: '["工作"]',
          reasoning_content: 'redacted-reasoning-trace'
        }
      }
    ],
    usage: { prompt_tokens: 12, completion_tokens: 34, total_tokens: 46 }
  })

  it('原生 choices envelope：提取 choices[0].message.content 并归一 usage', () => {
    expect(parseWorkersAiText(qwen3NativeChoices())).toEqual({
      ok: true,
      text: '["工作"]',
      usage: { inputTokens: 12, outputTokens: 34 }
    })
  })

  it('原生 choices 预算耗尽 → reasoning-starved', () => {
    const payload = qwen3NativeChoices()
    payload.choices = [
      {
        index: 0,
        finish_reason: 'length',
        message: { role: 'assistant', content: '', reasoning_content: 'redacted-reasoning-trace' }
      }
    ]
    payload.usage = { prompt_tokens: 12, completion_tokens: 256, total_tokens: 268 }

    expect(parseWorkersAiText(payload)).toStrictEqual({
      ok: false,
      failureKind: 'reasoning-starved'
    })
  })

  it('同时有合法 response 与合法 choices：choices 优先', () => {
    const payload = {
      response: 'legacy-text',
      choices: [{ index: 0, message: { role: 'assistant', content: '["工作"]' } }]
    }

    expect(parseWorkersAiText(payload)).toEqual({ ok: true, text: '["工作"]' })
  })

  it.each([
    ['choices 非数组', { response: 'still-valid', choices: 'nope' }],
    ['choices 为空数组', { response: 'still-valid', choices: [] }],
    ['choice 缺少 message', { response: 'still-valid', choices: [{ index: 0 }] }],
    ['content 为空串', { response: 'still-valid', choices: [{ message: { content: '' } }] }]
  ])('存在但非法的 choices（%s）→ invalid-envelope，不回退 response', (_label, payload) => {
    expect(parseWorkersAiText(payload)).toStrictEqual({
      ok: false,
      failureKind: 'invalid-envelope'
    })
  })

  it('原型链上的 choices 非 own 键，仍走 response 分支', () => {
    const payload = Object.assign(Object.create({ choices: [{ message: { content: 'proto' } }] }) as object, {
      response: 'world'
    })

    expect(parseWorkersAiText(payload)).toEqual({ ok: true, text: 'world' })
  })

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
