import { PluginContext } from './types.ts'

/*
 * 变量可用性表（不同事件类型）
 *
 * | 变量              | message.create | message.delete | application.create | client.create |
 * |-------------------|---------------|---------------|-------------------|---------------|
 * | #{USER_ID}        |       ✅       |       ✅       |         ✅         |       ✅       |
 * | #{NOW}            |       ✅       |       ✅       |         ✅         |       ✅       |
 * | #{MESSAGE}        |       ✅       |       ✅       |         ❌         |       ❌       |
 * | #{MESSAGE_ID}     |       ✅       |       ✅       |         ❌         |       ❌       |
 * | #{MESSAGE_TITLE}  |       ✅       |       ❌       |         ❌         |       ❌       |
 * | #{MESSAGE_PRIORITY}|      ✅       |       ❌       |         ❌         |       ❌       |
 * | #{APP_ID}         |       ✅       |       ✅       |         ❌         |       ❌       |
 * | #{APP_NAME}       |       ❌       |       ❌       |         ✅         |       ❌       |
 * | #{CLIENT_ID}      |       ❌       |       ❌       |         ❌         |       ✅       |
 * | #{CLIENT_NAME}    |       ❌       |       ❌       |         ❌         |       ✅       |
 *
 * 注：❌ 表示变量在此事件中不可用，会保持原样（如 #{MESSAGE}）
 */

// Variable resolver mapping: automatically resolves variables based on context data
const VARIABLE_MAP: Record<string, (ctx: PluginContext) => any> = {
  // Common variables (all events)
  'USER_ID': (ctx) => ctx.userId,
  'NOW': (ctx) => ctx.now,

  // Message event variables (message.create / message.delete)
  'MESSAGE': (ctx) => ctx.message?.content,
  'MESSAGE_ID': (ctx) => ctx.message?.id,
  'MESSAGE_TITLE': (ctx) => ctx.message?.title,
  'MESSAGE_PRIORITY': (ctx) => ctx.message?.priority,
  'APP_ID': (ctx) => ctx.message?.appId,
  'APP_NAME': (ctx) => ctx.application?.name,

  // Client create event variables (client.create)
  'CLIENT_ID': (ctx) => ctx.client?.id,
  'CLIENT_NAME': (ctx) => ctx.client?.name,
}

export function resolveVariables(value: any, ctx: PluginContext): any {
  // String: replace variables
  if (typeof value === 'string') {
    return value.replace(/#\{([A-Z_]+)\}/g, (_, varName) => {
      const resolver = VARIABLE_MAP[varName]
      const resolved = resolver ? resolver(ctx) : undefined
      // If variable resolves successfully, replace it; otherwise keep original
      return resolved !== undefined ? String(resolved) : `#{${varName}}`
    })
  }

  // Array: recursive processing
  if (Array.isArray(value)) {
    return value.map(item => resolveVariables(item, ctx))
  }

  // Object: recursive processing
  if (value && typeof value === 'object') {
    const result: Record<string, any> = {}
    for (const [key, val] of Object.entries(value)) {
      result[key] = resolveVariables(val, ctx)
    }
    return result
  }

  return value
}
