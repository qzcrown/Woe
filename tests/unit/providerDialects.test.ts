









import {
  FALLBACK_DIALECT,
  buildReasoningWire,
  resolveDialect,
  resolveWorkersAiDialect
} from '../../src/services/ai/providerDialects'
import type { DialectEntry } from '../../src/services/ai/providerDialects'
import type { ReasoningEffort } from '../../src/services/ai/contracts'

const efforts: ReasoningEffort[] = ['off', 'low', 'medium', 'high', 'max']

type Case = {
  name: string
  baseUrl: string
  model: string
  effort: ReasoningEffort
  body: Record<string, unknown>
  active: boolean
}

const cases: Case[] = [
  { name: 'DeepSeek off', baseUrl: 'https://api.deepseek.com', model: 'deepseek-flash',
    effort: 'off', body: { reasoning_effort: 'none' }, active: false },
  { name: 'DeepSeek medium 回落 high', baseUrl: 'https://api.deepseek.com', model: 'deepseek-flash',
    effort: 'medium', body: { reasoning_effort: 'high' }, active: true },
  { name: 'GPT-5 mini 最低档仍思考', baseUrl: 'https://api.openai.com', model: 'gpt-5-mini',
    effort: 'off', body: { reasoning_effort: 'minimal' }, active: true },
  { name: 'GPT-5.1 真实关闭', baseUrl: 'https://api.openai.com', model: 'gpt-5.1',
    effort: 'off', body: { reasoning_effort: 'none' }, active: false },
  { name: 'GPT-4 非思考模型', baseUrl: 'https://api.openai.com', model: 'gpt-4.1-mini',
    effort: 'high', body: {}, active: false },
  { name: 'OpenRouter 只发 effort', baseUrl: 'https://openrouter.ai/api/v1', model: 'deepseek/deepseek-flash',
    effort: 'high', body: { reasoning: { effort: 'high' } }, active: true },
  { name: 'OpenRouter 强制思考', baseUrl: 'https://openrouter.ai/api/v1', model: 'google/gemini-3',
    effort: 'off', body: {}, active: true },
  { name: 'Gemini 2.5 Flash 可关闭', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    model: 'gemini-2.5-flash', effort: 'off', body: { reasoning_effort: 'none' }, active: false },
  { name: 'Gemini 2.5 Pro minimal 仍思考', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    model: 'gemini-2.5-pro', effort: 'off', body: { reasoning_effort: 'minimal' }, active: true },
  { name: 'GLM 强制思考', baseUrl: 'https://api.bigmodel.cn', model: 'glm-5.3',
    effort: 'off', body: {}, active: true },
  { name: 'Kimi K3 medium', baseUrl: 'https://api.moonshot.cn', model: 'kimi-k3',
    effort: 'medium', body: { reasoning_effort: 'high' }, active: true },
  { name: '百炼 Qwen 预算', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen3.8-max',
    effort: 'high', body: { enable_thinking: true, thinking_budget: 25_600 }, active: true },
  { name: '百炼 Kimi K3 不发不支持的预算', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'kimi-k3',
    effort: 'off', body: {}, active: true },
  { name: '方舟 off', baseUrl: 'https://ark.cn-beijing.volcengine.com/api/v3', model: 'doubao-seed-1.6',
    effort: 'off', body: { thinking: { type: 'disabled' } }, active: false },
  { name: 'xAI 4.7 max', baseUrl: 'https://api.x.ai/v1', model: 'grok-4.7',
    effort: 'max', body: { reasoning_effort: 'xhigh' }, active: true }
]

describe('resolveDialect + buildReasoningWire 快照表', () => {
  it.each(cases)('$name', ({ baseUrl, model, effort, body, active }) => {
    const wire = buildReasoningWire(resolveDialect(baseUrl, model), effort, 25_600)
    expect(wire.body).toEqual(body)
    expect(wire.reasoningActive).toBe(active)
  })
})

describe('hostname 匹配', () => {
  it('大写 hostname 命中（大小写归一）', () => {
    const dialect = resolveDialect('HTTPS://API.DEEPSEEK.COM/chat/completions', 'deepseek-flash')
    expect(dialect).not.toBeNull()
    const wire = buildReasoningWire(dialect, 'off', 0)
    expect(wire.body).toEqual({ reasoning_effort: 'none' })
    expect(wire.reasoningActive).toBe(false)
  })

  it('相似恶意后缀不命中（精确 hostname 匹配，走 fallback）', () => {
    expect(resolveDialect('https://api.deepseek.com.example.org/v1', 'deepseek-flash')).toBeNull()
    const wire = buildReasoningWire(
      resolveDialect('https://api.deepseek.com.example.org/v1', 'deepseek-flash'),
      'off',
      0
    )
    expect(wire.body).toEqual({ reasoning_effort: 'none' })
    expect(wire.tokenLimitField).toBe('max_tokens')
  })

  it('路径不改变匹配', () => {
    const dialect = resolveDialect('https://api.deepseek.com/some/other/path', 'deepseek-flash')
    expect(dialect).not.toBeNull()
    const wire = buildReasoningWire(dialect, 'off', 0)
    expect(wire.body).toEqual({ reasoning_effort: 'none' })
  })
})

describe('模型匹配（大小写与最长前缀）', () => {
  it('GPT-5.1 大写归一后命中更长前缀，不落到 gpt-5 minimal', () => {
    const wire = buildReasoningWire(resolveDialect('https://api.openai.com/v1', 'GPT-5.1'), 'off', 0)
    expect(wire.body).toEqual({ reasoning_effort: 'none' })
    expect(wire.reasoningActive).toBe(false)
  })

  it('GLM-5.3-FLASH 大写归一后命中 mandatory', () => {
    const wire = buildReasoningWire(resolveDialect('https://api.bigmodel.cn/v1', 'GLM-5.3-FLASH'), 'off', 0)
    expect(wire.body).toEqual({})
    expect(wire.reasoningActive).toBe(true)
  })
})

describe('OpenAI 模型级请求信息', () => {
  const openai = 'https://api.openai.com/v1'

  it('gpt-5-mini/off：max_completion_tokens、不发温度', () => {
    const wire = buildReasoningWire(resolveDialect(openai, 'gpt-5-mini'), 'off', 0)
    expect(wire.tokenLimitField).toBe('max_completion_tokens')
    expect(wire.sendTemperature).toBe(false)
    expect(wire.body).toEqual({ reasoning_effort: 'minimal' })
  })

  it('gpt-5.1/off：off-only 在真实关闭时发温度', () => {
    const wire = buildReasoningWire(resolveDialect(openai, 'gpt-5.1'), 'off', 0)
    expect(wire.sendTemperature).toBe(true)
  })

  it('gpt-5.1/high：思考时不发温度', () => {
    const wire = buildReasoningWire(resolveDialect(openai, 'gpt-5.1'), 'high', 0)
    expect(wire.sendTemperature).toBe(false)
  })

  it('o3/off：最低档 low 仍思考且不发温度', () => {
    const wire = buildReasoningWire(resolveDialect(openai, 'o3'), 'off', 0)
    expect(wire.body).toEqual({ reasoning_effort: 'low' })
    expect(wire.reasoningActive).toBe(true)
    expect(wire.sendTemperature).toBe(false)
  })

  it('gpt-4.1/high：max_tokens、发温度、无思考字段', () => {
    const wire = buildReasoningWire(resolveDialect(openai, 'gpt-4.1'), 'high', 25_600)
    expect(wire.tokenLimitField).toBe('max_tokens')
    expect(wire.sendTemperature).toBe(true)
    expect(wire.body).toEqual({})
    expect(wire.reasoningActive).toBe(false)
  })
})

describe('全五档构造（九个 HTTP 条目）', () => {
  const endpoints: Array<[string, string, string]> = [
    ['DeepSeek', 'https://api.deepseek.com', 'deepseek-flash'],
    ['OpenAI', 'https://api.openai.com/v1', 'gpt-5.1'],
    ['OpenRouter', 'https://openrouter.ai/api/v1', 'deepseek/deepseek-flash'],
    ['Gemini', 'https://generativelanguage.googleapis.com/v1beta/openai', 'gemini-2.5-pro'],
    ['GLM', 'https://api.bigmodel.cn/v1', 'glm-5.3'],
    ['Kimi', 'https://api.moonshot.cn/v1', 'kimi-k3'],
    ['百炼', 'https://dashscope.aliyuncs.com/compatible-mode/v1', 'qwen3.8-max'],
    ['方舟', 'https://ark.cn-beijing.volcengine.com/api/v3', 'doubao-seed-1.6'],
    ['xAI', 'https://api.x.ai/v1', 'grok-4.7']
  ]

  it.each(endpoints)('%s 逐档可构造', (_label, baseUrl, model) => {
    const dialect = resolveDialect(baseUrl, model)
    expect(dialect).not.toBeNull()
    for (const effort of efforts) {
      const wire = buildReasoningWire(dialect, effort, 25_600)
      expect(typeof wire.body).toBe('object')
      expect(typeof wire.reasoningActive).toBe('boolean')
    }
  })

  it('OpenRouter 任一档都没有 reasoning.max_tokens', () => {
    const dialect = resolveDialect('https://openrouter.ai/api/v1', 'deepseek/deepseek-flash')
    for (const effort of efforts) {
      const wire = buildReasoningWire(dialect, effort, 25_600)
      expect(wire.body).toEqual({ reasoning: { effort: expect.any(String) } })
      expect((wire.body.reasoning as Record<string, unknown>).max_tokens).toBeUndefined()
    }
  })
})

describe('独立预算 thinking_budget', () => {
  const dashscope = 'https://dashscope.aliyuncs.com/compatible-mode/v1'

  it('Qwen high 且 reasoningTokens=0 不附 thinking_budget', () => {
    const wire = buildReasoningWire(resolveDialect(dashscope, 'qwen3.8-max'), 'high', 0)
    expect(wire.body).toEqual({ enable_thinking: true })
  })

  it('reasoningTokens=99_999 clamp 到预算上限 25_600', () => {
    const wire = buildReasoningWire(resolveDialect(dashscope, 'qwen3.8-max'), 'high', 99_999)
    expect(wire.body).toEqual({ enable_thinking: true, thinking_budget: 25_600 })
  })

  it('off 真关闭（active=false）不附预算', () => {
    const wire = buildReasoningWire(resolveDialect(dashscope, 'qwen3.8-max'), 'off', 25_600)
    expect(wire.body).toEqual({ enable_thinking: false })
  })

  it('百炼 Kimi K3 high 不附不支持的 thinking_budget', () => {
    const wire = buildReasoningWire(resolveDialect(dashscope, 'kimi-k3'), 'high', 25_600)
    expect(wire.body).toEqual({ enable_thinking: true })
  })
})

describe('mandatory 与 minimum', () => {
  it('强制思考 off 不误回落 high、不发 none（GLM-5.3）', () => {
    const wire = buildReasoningWire(resolveDialect('https://api.bigmodel.cn/v1', 'glm-5.3'), 'off', 0)
    expect(wire.body).toEqual({})
    expect(wire.reasoningActive).toBe(true)
  })

  it('GPT-5-pro 的显式 off=high 单独锁定，所有档位均 high 且不发温度', () => {
    for (const effort of efforts) {
      const wire = buildReasoningWire(resolveDialect('https://api.openai.com/v1', 'gpt-5-pro'), effort, 0)
      expect(wire.body).toEqual({ reasoning_effort: 'high' })
      expect(wire.reasoningActive).toBe(true)
      expect(wire.sendTemperature).toBe(false)
    }
  })

  it('Gemini3/off 仍思考（基础 minimum → minimal）', () => {
    const wire = buildReasoningWire(
      resolveDialect('https://generativelanguage.googleapis.com/v1beta/openai', 'gemini-3-pro'),
      'off',
      0
    )
    expect(wire.body).toEqual({ reasoning_effort: 'minimal' })
    expect(wire.reasoningActive).toBe(true)
  })

  it('GPT-6.1/off 发 low 且不发温度', () => {
    const wire = buildReasoningWire(resolveDialect('https://api.openai.com/v1', 'gpt-6.1'), 'off', 0)
    expect(wire.body).toEqual({ reasoning_effort: 'low' })
    expect(wire.reasoningActive).toBe(true)
    expect(wire.sendTemperature).toBe(false)
  })
})

describe('o1 历史型号', () => {
  it('o1-mini/o1-preview 使用更长规则，所有档位不发 reasoning_effort', () => {
    for (const model of ['o1-mini', 'o1-preview']) {
      for (const effort of efforts) {
        const wire = buildReasoningWire(resolveDialect('https://api.openai.com/v1', model), effort, 0)
        expect(wire.body).toEqual({})
        expect(wire.reasoningActive).toBe(true)
        expect(wire.tokenLimitField).toBe('max_completion_tokens')
      }
    }
  })

  it('o1 本身 off=low，不被更长规则影响', () => {
    const wire = buildReasoningWire(resolveDialect('https://api.openai.com/v1', 'o1'), 'off', 0)
    expect(wire.body).toEqual({ reasoning_effort: 'low' })
    expect(wire.reasoningActive).toBe(true)
  })
})

describe('无匹配 HTTP 端点（fallback）', () => {
  it('未知域名 resolveDialect 返回 null，不把未知域名标已验证', () => {
    expect(resolveDialect('https://llm.example-vendor.example.com/v1', 'some-model')).toBeNull()
    expect(resolveDialect('not a url', 'some-model')).toBeNull()
  })

  it('null → fallback：off 发 none、max_tokens、发温度', () => {
    const wire = buildReasoningWire(null, 'off', 25_600)
    expect(wire.body).toEqual({ reasoning_effort: 'none' })
    expect(wire.reasoningActive).toBe(false)
    expect(wire.tokenLimitField).toBe('max_tokens')
    expect(wire.sendTemperature).toBe(true)
  })

  it('null → fallback：max 回落 high，无独立预算', () => {
    const wire = buildReasoningWire(null, 'max', 25_600)
    expect(wire.body).toEqual({ reasoning_effort: 'high' })
    expect(wire.reasoningActive).toBe(true)
    expect(wire.body.thinking_budget).toBeUndefined()
  })

  it('FALLBACK_DIALECT 不冒充任何已验证端点', () => {
    expect(FALLBACK_DIALECT.hosts).toEqual([])
  })
})

describe('Workers AI 原生 binding', () => {
  it('已列 Llama → not-applicable（不发思考字段、保留温度）', () => {
    const dialect = resolveWorkersAiDialect('@cf/meta/llama-3.3-70b-instruct-fp8-fast')
    expect(dialect).not.toBeNull()
    const wire = buildReasoningWire(dialect, 'off', 25_600)
    expect(wire.body).toEqual({})
    expect(wire.reasoningActive).toBe(false)
    expect(wire.tokenLimitField).toBe('max_tokens')
    expect(wire.sendTemperature).toBe(true)
  })

  it('Qwen3 → mandatory、空 body（不臆测原生关闭参数）', () => {
    const dialect = resolveWorkersAiDialect('@cf/qwen/qwen3-30b-a3b-fp8')
    expect(dialect).not.toBeNull()
    for (const effort of efforts) {
      const wire = buildReasoningWire(dialect, effort, 25_600)
      expect(wire.body).toEqual({})
      expect(wire.reasoningActive).toBe(true)
    }
  })

  it('未知原生模型 → null', () => {
    expect(resolveWorkersAiDialect('@cf/meta/llama-4-sky-9b')).toBeNull()
    expect(resolveWorkersAiDialect('@cf/unknown/model-x')).toBeNull()
  })
})

describe('纯函数与静态条目安全', () => {
  it('连续不同档位调用不污染静态条目', () => {
    const dialect = resolveDialect('https://dashscope.aliyuncs.com/compatible-mode/v1', 'qwen3.8-max')
    const first = buildReasoningWire(dialect, 'high', 99_999)
    expect(first.body).toEqual({ enable_thinking: true, thinking_budget: 25_600 })
    const second = buildReasoningWire(dialect, 'high', 0)
    expect(second.body).toEqual({ enable_thinking: true })
    const third = buildReasoningWire(dialect, 'off', 25_600)
    expect(third.body).toEqual({ enable_thinking: false })
    const fourth = buildReasoningWire(dialect, 'high', 0)
    expect(fourth.body).toEqual({ enable_thinking: true })
  })

  it('有环 fallback 安全终止（最终取 high 或空片段）', () => {
    const cyclic: DialectEntry = {
      hosts: [],
      docs: 'synthetic（测试构造）',
      verifiedAt: 'unverified',
      offMode: 'disabled',
      levels: { off: { reasoning_effort: 'none' }, high: { reasoning_effort: 'high' } },
      fallback: { low: 'medium', medium: 'low' },
      tokenLimitField: 'max_tokens',
      temperatureMode: 'send'
    }
    const wire = buildReasoningWire(cyclic, 'low', 0)
    expect(wire.body).toEqual({ reasoning_effort: 'high' })
    expect(wire.reasoningActive).toBe(true)
  })
})

describe('官方文档核验修订（2026-10-25）', () => {
  it('方舟非关闭档位发 thinking:{type:"auto"}（官方 enabled/disabled/auto）', () => {
    const wire = buildReasoningWire(
      resolveDialect('https://ark.cn-beijing.volcengine.com/api/v3', 'doubao-seed-1.6'),
      'low',
      25_600
    )
    expect(wire.body).toEqual({ thinking: { type: 'auto' } })
    expect(wire.reasoningActive).toBe(true)
  })

  it('方舟两个官方 hostname 均命中', () => {
    expect(resolveDialect('https://ark.volcengine.com/api/v3', 'doubao-seed-1.6')).not.toBeNull()
    expect(resolveDialect('https://ark.cn-beijing.volcengine.com/api/v3', 'doubao-seed-1.6')).not.toBeNull()
  })

  it('Kimi thinking 模型温度固定（官方参数表），不发 temperature', () => {
    const k3 = buildReasoningWire(resolveDialect('https://api.moonshot.cn/v1', 'kimi-k3'), 'high', 0)
    expect(k3.sendTemperature).toBe(false)
    const k26 = buildReasoningWire(resolveDialect('https://api.moonshot.ai/v1', 'kimi-k2.6'), 'off', 0)
    expect(k26.sendTemperature).toBe(false)
    expect(k26.body).toEqual({ thinking: { type: 'disabled' } })
  })

  it('Kimi k2.7 前缀 mandatory：off 空片段仍思考，全档不发温度（继承基础 omit）', () => {
    const dialect = resolveDialect('https://api.moonshot.cn', 'kimi-k2.7')
    expect(dialect?.offMode).toBe('mandatory')
    const off = buildReasoningWire(dialect, 'off', 25_600)
    expect(off.body).toEqual({})
    expect(off.reasoningActive).toBe(true)
    for (const effort of efforts) {
      const wire = buildReasoningWire(dialect, effort, 25_600)
      expect(wire.body).toEqual({})
      expect(wire.reasoningActive).toBe(true)
      expect(wire.sendTemperature).toBe(false)
    }
  })
})
