














import type { ReasoningEffort } from './contracts.ts'

export type WireFragment = Record<string, unknown>
export type OffMode = 'disabled' | 'minimum' | 'mandatory' | 'not-applicable'
export type TokenLimitField = 'max_tokens' | 'max_completion_tokens'

export interface DialectSettings {
  offMode: OffMode
  levels: Partial<Record<ReasoningEffort, WireFragment>>
  fallback?: Partial<Record<ReasoningEffort, ReasoningEffort>>
  tokenLimitField: TokenLimitField
  temperatureMode: 'send' | 'omit' | 'off-only'

  budget?: { param: 'thinking_budget'; max: number } | null
}

export interface DialectModelRule extends Partial<DialectSettings> {
  modelPrefix: string
}

export interface DialectEntry extends DialectSettings {
  hosts: string[]
  modelRules?: DialectModelRule[]
  docs: string
  verifiedAt: string
}

export interface ReasoningWire {
  body: WireFragment
  reasoningActive: boolean
  tokenLimitField: TokenLimitField
  sendTemperature: boolean
}

const effortFragment = (effort: string): WireFragment => ({ reasoning_effort: effort })


const REASONING_BUDGET_MAX = 25_600






const DEEPSEEK_DIALECT: DialectEntry = {
  hosts: ['api.deepseek.com'],
  offMode: 'disabled',
  levels: {
    off: { reasoning_effort: 'none' },
    low: effortFragment('low'),
    high: effortFragment('high'),
    max: effortFragment('max')
  },
  fallback: { medium: 'high' },
  tokenLimitField: 'max_tokens',
  temperatureMode: 'send',
  docs: 'https://api-docs.deepseek.com/api/create-chat-completion/',
  verifiedAt: '2026-10-25'
}













const OPENAI_DIALECT: DialectEntry = {
  hosts: ['api.openai.com'],
  offMode: 'disabled',
  levels: {
    off: effortFragment('none'),
    low: effortFragment('low'),
    medium: effortFragment('medium'),
    high: effortFragment('high')
  },
  fallback: { max: 'high' },
  tokenLimitField: 'max_completion_tokens',
  temperatureMode: 'off-only',
  modelRules: [

    { modelPrefix: 'gpt-5-pro', offMode: 'mandatory',
      levels: {
        off: effortFragment('high'),
        low: effortFragment('high'),
        medium: effortFragment('high'),
        high: effortFragment('high'),
        max: effortFragment('high')
      },
      temperatureMode: 'omit' },
    { modelPrefix: 'gpt-5.6', offMode: 'disabled',
      levels: { off: effortFragment('none'), max: effortFragment('max') },
      temperatureMode: 'off-only' },

    { modelPrefix: 'gpt-5.5', offMode: 'disabled',
      levels: { off: effortFragment('none'), max: effortFragment('xhigh') },
      temperatureMode: 'off-only' },
    { modelPrefix: 'gpt-5.4', offMode: 'disabled',
      levels: { off: effortFragment('none'), max: effortFragment('xhigh') },
      temperatureMode: 'off-only' },
    { modelPrefix: 'gpt-5.2', offMode: 'disabled',
      levels: { off: effortFragment('none'), max: effortFragment('xhigh') },
      temperatureMode: 'off-only' },
    { modelPrefix: 'gpt-5.1', offMode: 'disabled',
      levels: { off: effortFragment('none') },
      temperatureMode: 'off-only' },
    { modelPrefix: 'gpt-5', offMode: 'minimum',
      levels: { off: effortFragment('minimal') },
      temperatureMode: 'omit' },
    { modelPrefix: 'gpt-6-sol', offMode: 'disabled',
      levels: { off: effortFragment('none'), max: effortFragment('max') },
      temperatureMode: 'off-only' },

    { modelPrefix: 'gpt-6-luna', offMode: 'disabled',
      levels: { off: effortFragment('none'), max: effortFragment('max') },
      temperatureMode: 'off-only' },

    { modelPrefix: 'gpt-6.1', offMode: 'mandatory',
      levels: { off: effortFragment('low'), max: effortFragment('max') },
      temperatureMode: 'omit' },
    { modelPrefix: 'gpt-6-astra', offMode: 'mandatory',
      levels: { off: effortFragment('low'), max: effortFragment('max') },
      temperatureMode: 'omit' },

    { modelPrefix: 'o1', offMode: 'minimum', levels: { off: effortFragment('low') }, temperatureMode: 'omit' },
    { modelPrefix: 'o3', offMode: 'minimum', levels: { off: effortFragment('low') }, temperatureMode: 'omit' },
    { modelPrefix: 'o4', offMode: 'minimum', levels: { off: effortFragment('low') }, temperatureMode: 'omit' },


    { modelPrefix: 'o1-mini', offMode: 'mandatory',
      levels: { off: {}, low: {}, medium: {}, high: {}, max: {} },
      temperatureMode: 'omit' },
    { modelPrefix: 'o1-preview', offMode: 'mandatory',
      levels: { off: {}, low: {}, medium: {}, high: {}, max: {} },
      temperatureMode: 'omit' },

    { modelPrefix: 'gpt-4', offMode: 'not-applicable',
      levels: { off: {}, low: {}, medium: {}, high: {}, max: {} },
      tokenLimitField: 'max_tokens', temperatureMode: 'send' },
    { modelPrefix: 'gpt-3.5', offMode: 'not-applicable',
      levels: { off: {}, low: {}, medium: {}, high: {}, max: {} },
      tokenLimitField: 'max_tokens', temperatureMode: 'send' },
    { modelPrefix: 'chatgpt-4', offMode: 'not-applicable',
      levels: { off: {}, low: {}, medium: {}, high: {}, max: {} },
      tokenLimitField: 'max_tokens', temperatureMode: 'send' }
  ],
  docs: 'https://developers.openai.com/api/docs/guides/latest-model（?model=gpt-5.2 / gpt-5.6）；https://developers.openai.com/api/docs/models/gpt-5-pro',
  verifiedAt: '2026-10-25（gpt-5.4/5.5、gpt-6-luna、gpt-6-astra、o1/o4 未逐项确认，见规则注释）'
}






const OPENROUTER_DIALECT: DialectEntry = {
  hosts: ['openrouter.ai'],
  offMode: 'disabled',
  levels: {
    off: { reasoning: { effort: 'none' } },
    low: { reasoning: { effort: 'low' } },
    medium: { reasoning: { effort: 'medium' } },
    high: { reasoning: { effort: 'high' } },
    max: { reasoning: { effort: 'max' } }
  },
  budget: null,
  tokenLimitField: 'max_tokens',
  temperatureMode: 'send',
  modelRules: [
    { modelPrefix: 'google/gemini-3', offMode: 'mandatory', levels: { off: {} } },
    { modelPrefix: 'z-ai/glm-5.3', offMode: 'mandatory', levels: { off: {} } },
    { modelPrefix: 'moonshotai/kimi-k3', offMode: 'mandatory', levels: { off: {} } },
    { modelPrefix: 'openai/gpt-6.1', offMode: 'mandatory', levels: { off: {} } },
    { modelPrefix: 'openai/gpt-6-astra', offMode: 'mandatory', levels: { off: {} } },
    { modelPrefix: 'openai/gpt-5.1', offMode: 'disabled', levels: { off: { reasoning: { effort: 'none' } } } },
    { modelPrefix: 'openai/gpt-5.2', offMode: 'disabled', levels: { off: { reasoning: { effort: 'none' } } } },
    { modelPrefix: 'openai/gpt-5.4', offMode: 'disabled', levels: { off: { reasoning: { effort: 'none' } } } },
    { modelPrefix: 'openai/gpt-5.5', offMode: 'disabled', levels: { off: { reasoning: { effort: 'none' } } } },
    { modelPrefix: 'openai/gpt-5.6', offMode: 'disabled', levels: { off: { reasoning: { effort: 'none' } } } },
    { modelPrefix: 'openai/gpt-5', offMode: 'minimum', levels: { off: { reasoning: { effort: 'minimal' } } } },
    { modelPrefix: 'openai/gpt-4', offMode: 'not-applicable',
      levels: { off: {}, low: {}, medium: {}, high: {}, max: {} } }
  ],
  docs: 'https://openrouter.ai/docs/guides/best-practices/reasoning-tokens',
  verifiedAt: '2026-10-25'
}


const GEMINI_DIALECT: DialectEntry = {
  hosts: ['generativelanguage.googleapis.com'],
  offMode: 'minimum',
  levels: {
    off: effortFragment('minimal'),
    low: effortFragment('low'),
    medium: effortFragment('medium'),
    high: effortFragment('high')
  },
  fallback: { max: 'high' },
  tokenLimitField: 'max_tokens',
  temperatureMode: 'send',
  modelRules: [
    { modelPrefix: 'gemini-2.5-flash', offMode: 'disabled', levels: { off: effortFragment('none') } }
  ],
  docs: 'https://ai.google.dev/gemini-api/docs/openai',
  verifiedAt: '2026-10-25'
}


const GLM_DIALECT: DialectEntry = {
  hosts: ['api.bigmodel.cn'],
  offMode: 'disabled',
  levels: {
    off: { thinking: { type: 'disabled' } },
    low: effortFragment('low'),
    high: effortFragment('high'),
    max: effortFragment('max')
  },
  fallback: { medium: 'high' },
  tokenLimitField: 'max_tokens',
  temperatureMode: 'send',
  modelRules: [{ modelPrefix: 'glm-5.3', offMode: 'mandatory', levels: { off: {} } }],
  docs: 'https://docs.bigmodel.cn/cn/guide/capabilities/thinking-mode',
  verifiedAt: '2026-10-25'
}












const KIMI_DIALECT: DialectEntry = {
  hosts: ['api.moonshot.cn', 'api.moonshot.ai'],
  offMode: 'disabled',
  levels: {
    off: { thinking: { type: 'disabled' } },
    low: {},
    medium: {},
    high: {},
    max: {}
  },
  tokenLimitField: 'max_tokens',
  temperatureMode: 'omit',
  modelRules: [
    {
      modelPrefix: 'kimi-k3',
      offMode: 'mandatory',
      levels: {
        off: {},
        low: effortFragment('low'),
        medium: effortFragment('high'),
        high: effortFragment('high'),
        max: effortFragment('max')
      }
    },
    {
      modelPrefix: 'kimi-k2.7',
      offMode: 'mandatory',
      levels: { off: {}, low: {}, medium: {}, high: {}, max: {} }
    }
  ],
  docs: 'https://platform.kimi.ai/docs/api/models-overview；https://platform.kimi.ai/docs/guide/use-thinking-models',
  verifiedAt: '2026-10-25'
}







const DASHSCOPE_DIALECT: DialectEntry = {
  hosts: ['dashscope.aliyuncs.com'],
  offMode: 'disabled',
  levels: {
    off: { enable_thinking: false },
    low: { enable_thinking: true },
    medium: { enable_thinking: true },
    high: { enable_thinking: true },
    max: { enable_thinking: true }
  },
  tokenLimitField: 'max_tokens',
  temperatureMode: 'send',
  modelRules: [

    { modelPrefix: 'qwen3.8-2.4t', offMode: 'mandatory', levels: { off: {} } },
    { modelPrefix: 'qwen3.8-', budget: { param: 'thinking_budget', max: REASONING_BUDGET_MAX } },
    { modelPrefix: 'qwen3.7-', budget: { param: 'thinking_budget', max: REASONING_BUDGET_MAX } },
    { modelPrefix: 'qwen3.6-', budget: { param: 'thinking_budget', max: REASONING_BUDGET_MAX } },
    { modelPrefix: 'qwen3.5-', budget: { param: 'thinking_budget', max: REASONING_BUDGET_MAX } },
    { modelPrefix: 'qwen3-', budget: { param: 'thinking_budget', max: REASONING_BUDGET_MAX } },
    { modelPrefix: 'glm-5.3', offMode: 'mandatory', levels: { off: {} } },
    { modelPrefix: 'kimi-k3', offMode: 'mandatory', levels: { off: {} } },
    { modelPrefix: 'kimi-k2.7-code', offMode: 'mandatory', levels: { off: {} } }
  ],
  docs: 'https://help.aliyun.com/zh/model-studio/deep-thinking',
  verifiedAt: '2026-10-25'
}







const ARK_DIALECT: DialectEntry = {
  hosts: ['ark.volcengine.com', 'ark.cn-beijing.volcengine.com'],
  offMode: 'disabled',
  levels: {
    off: { thinking: { type: 'disabled' } },
    low: { thinking: { type: 'auto' } },
    medium: { thinking: { type: 'auto' } },
    high: { thinking: { type: 'auto' } },
    max: { thinking: { type: 'auto' } }
  },
  tokenLimitField: 'max_tokens',
  temperatureMode: 'send',
  docs: 'https://www.volcengine.com/docs/ark/deep-thinking；https://www.volcengine.com/docs/82379/1298454',
  verifiedAt: '2026-10-25（官方页 JS 渲染，内容经官方域文档索引核对）'
}


const XAI_DIALECT: DialectEntry = {
  hosts: ['api.x.ai'],
  offMode: 'mandatory',
  levels: {
    off: {},
    low: effortFragment('low'),
    medium: effortFragment('medium'),
    high: effortFragment('high')
  },
  fallback: { max: 'high' },
  tokenLimitField: 'max_tokens',
  temperatureMode: 'send',
  modelRules: [
    { modelPrefix: 'grok-4.7', levels: { max: effortFragment('xhigh') } },
    { modelPrefix: 'grok-4.6', levels: { max: effortFragment('xhigh') } }
  ],
  docs: 'https://docs.x.ai/developers/model-capabilities/text/reasoning',
  verifiedAt: '2026-10-25'
}

const HTTP_DIALECTS: DialectEntry[] = [
  DEEPSEEK_DIALECT,
  OPENAI_DIALECT,
  OPENROUTER_DIALECT,
  GEMINI_DIALECT,
  GLM_DIALECT,
  KIMI_DIALECT,
  DASHSCOPE_DIALECT,
  ARK_DIALECT,
  XAI_DIALECT
]






export const FALLBACK_DIALECT: DialectEntry = {
  hosts: [],
  offMode: 'disabled',
  levels: {
    off: effortFragment('none'),
    low: effortFragment('low'),
    medium: effortFragment('medium'),
    high: effortFragment('high')
  },
  fallback: { max: 'high' },
  tokenLimitField: 'max_tokens',
  temperatureMode: 'send',
  docs: '未匹配任何已列 hostname 时的尽力适配，不对应具体官方端点',
  verifiedAt: '未验证（不对应任何具体端点）'
}





type WorkersAiRule = DialectEntry & { modelPrefix: string }






const WORKERS_AI_RULES: WorkersAiRule[] = [
  {
    modelPrefix: '@cf/meta/llama-3.3-',
    hosts: [],
    offMode: 'not-applicable',
    levels: { off: {}, low: {}, medium: {}, high: {}, max: {} },
    tokenLimitField: 'max_tokens',
    temperatureMode: 'send',
    docs: 'https://developers.cloudflare.com/workers-ai/models/llama-3.3-70b-instruct-fp8-fast/',
    verifiedAt: '2026-10-25'
  },
  {
    modelPrefix: '@cf/meta/llama-3.2-',
    hosts: [],
    offMode: 'not-applicable',
    levels: { off: {}, low: {}, medium: {}, high: {}, max: {} },
    tokenLimitField: 'max_tokens',
    temperatureMode: 'send',
    docs: 'https://developers.cloudflare.com/workers-ai/models/llama-3.2-3b-instruct/',
    verifiedAt: '2026-10-25'
  },
  {
    modelPrefix: '@cf/meta/llama-3.1-',
    hosts: [],
    offMode: 'not-applicable',
    levels: { off: {}, low: {}, medium: {}, high: {}, max: {} },
    tokenLimitField: 'max_tokens',
    temperatureMode: 'send',
    docs: 'https://developers.cloudflare.com/workers-ai/models/llama-3.1-8b-instruct-fast/',
    verifiedAt: '2026-10-25'
  },
  {
    modelPrefix: '@cf/meta/llama-3-',
    hosts: [],
    offMode: 'not-applicable',
    levels: { off: {}, low: {}, medium: {}, high: {}, max: {} },
    tokenLimitField: 'max_tokens',
    temperatureMode: 'send',
    docs: 'https://developers.cloudflare.com/workers-ai/models/llama-3-8b-instruct/',
    verifiedAt: '2026-10-25'
  },
  {
    modelPrefix: '@cf/qwen/qwen3-30b-a3b-fp8',
    hosts: [],
    offMode: 'mandatory',
    levels: { off: {}, low: {}, medium: {}, high: {}, max: {} },
    tokenLimitField: 'max_tokens',
    temperatureMode: 'send',
    docs: 'https://developers.cloudflare.com/workers-ai/models/qwen3-30b-a3b-fp8/',
    verifiedAt: '2026-10-25（原生关闭参数未核实，不宣称用户能通过 off 关闭）'
  }
]






function mergeModelRule(entry: DialectEntry, rule: DialectModelRule): DialectEntry {
  const { modelPrefix: _modelPrefix, levels, fallback, ...plain } = rule
  const merged: DialectEntry = { ...entry, ...plain }
  if (levels !== undefined) merged.levels = { ...entry.levels, ...levels }
  if (fallback !== undefined) merged.fallback = { ...entry.fallback, ...fallback }
  return merged
}

function applyModelRules(entry: DialectEntry, model: string): DialectEntry {
  const rules = entry.modelRules
  if (rules === undefined || rules.length === 0) return entry
  const normalized = model.toLowerCase()
  const longestFirst = [...rules].sort((a, b) => b.modelPrefix.length - a.modelPrefix.length)
  const rule = longestFirst.find((candidate) => normalized.startsWith(candidate.modelPrefix))
  if (rule === undefined) return entry
  return mergeModelRule(entry, rule)
}





export function resolveDialect(baseUrl: string, model: string): DialectEntry | null {
  let hostname: string
  try {
    hostname = new URL(baseUrl).hostname.toLowerCase()
  } catch {
    return null
  }
  const entry = HTTP_DIALECTS.find((candidate) => candidate.hosts.includes(hostname))
  if (entry === undefined) return null
  return applyModelRules(entry, model)
}


export function resolveWorkersAiDialect(model: string): DialectEntry | null {
  const normalized = model.toLowerCase()
  const longestFirst = [...WORKERS_AI_RULES].sort(
    (a, b) => b.modelPrefix.length - a.modelPrefix.length
  )
  const matched = longestFirst.find((candidate) => normalized.startsWith(candidate.modelPrefix))
  if (matched === undefined) return null
  const { modelPrefix: _modelPrefix, ...entry } = matched
  return entry
}





function resolveLevelFragment(entry: DialectSettings, effort: ReasoningEffort): WireFragment {
  const visited = new Set<ReasoningEffort>()
  let current: ReasoningEffort | undefined = effort
  while (current !== undefined && !visited.has(current)) {
    visited.add(current)
    const fragment = entry.levels[current]
    if (fragment !== undefined) return { ...fragment }
    current = entry.fallback?.[current]
  }
  const highFragment = entry.levels.high
  return highFragment !== undefined ? { ...highFragment } : {}
}












export function buildReasoningWire(
  dialect: DialectEntry | null,
  effort: ReasoningEffort,
  reasoningTokens: number
): ReasoningWire {
  const entry = dialect ?? FALLBACK_DIALECT
  let body: WireFragment = {}
  let reasoningActive: boolean

  if (entry.offMode === 'not-applicable') {
    reasoningActive = false
  } else if (effort === 'off') {
    const offFragment = entry.levels.off
    body = offFragment !== undefined ? { ...offFragment } : {}
    reasoningActive = entry.offMode !== 'disabled'
  } else {
    body = resolveLevelFragment(entry, effort)
    reasoningActive = true
  }

  const budget = entry.budget
  if (reasoningActive && reasoningTokens > 0 && budget !== undefined && budget !== null) {
    body = { ...body, [budget.param]: Math.min(reasoningTokens, budget.max) }
  }

  return {
    body,
    reasoningActive,
    tokenLimitField: entry.tokenLimitField,
    sendTemperature:
      entry.temperatureMode === 'send'
        ? true
        : entry.temperatureMode === 'omit'
          ? false
          : !reasoningActive
  }
}
