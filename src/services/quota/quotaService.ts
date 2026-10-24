










import { eq } from 'drizzle-orm'
import type { DrizzleDB } from '../../drizzle/index.ts'
import { systemState } from '../../models/index.ts'
import { QuotaUsageStore } from './quotaUsageStore.ts'

export const SUPPORTED_QUOTA_NAMESPACES = ['ai'] as const
export type QuotaNamespace = (typeof SUPPORTED_QUOTA_NAMESPACES)[number]

export const DEFAULT_DAILY_LIMIT = 1000

export interface QuotaServiceEnv {
  QUOTA_KV?: KVNamespace
}

export class QuotaNamespaceError extends Error {
  readonly code = 'invalid-namespace'

  constructor(namespace: string) {
    super(`unsupported quota namespace: ${namespace}`)
    this.name = 'QuotaNamespaceError'
  }
}

export type QuotaSource = 'override' | 'default'

export type QuotaCheckResult =
  | { status: 'ok'; limit: number; used: number; source: QuotaSource }
  | { status: 'exceeded'; limit: number; used: number; source: QuotaSource }
  | { status: 'read-failed' }
  | { status: 'invalid-limit' }

export type QuotaConsumeResult =
  | { status: 'consumed' }
  | { status: 'skipped' }
  | { status: 'write-failed' }

export type QuotaDescription =
  | {
      ok: true
      defaultLimit: number
      overrideLimit: number | null
      effectiveLimit: number
      usageDay: string | null
      usageCount: number
      usageToday: number
      source: QuotaSource
    }
  | { ok: false; reason: 'read-failed' | 'invalid-limit' }


export type QuotaUsageRow = {
  userId: number
  pluginId: number
  usageDay: string | null
  usageCount: number
}





export type QuotaNamespaceDescription =
  | { ok: true; rows: Array<Extract<QuotaDescription, { ok: true }>> }
  | { ok: false; reason: 'read-failed' | 'invalid-limit' }

export type QuotaOverrideResult =
  | { status: 'ok' }
  | { status: 'invalid' }
  | { status: 'write-failed' }

type LimitReadResult =
  | { ok: true; limit: number; source: QuotaSource }
  | { ok: false; reason: 'read-failed' | 'invalid-limit' }

type OverrideReadResult =
  | { kind: 'none' }
  | { kind: 'value'; limit: number }
  | { kind: 'invalid' }
  | { kind: 'read-failed' }


export function currentUtcDay(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10)
}





export function parseQuotaLimit(raw: string): number | null {
  const trimmed = raw.trim()
  if (!/^\d+$/.test(trimmed)) return null
  const value = Number(trimmed)
  return Number.isSafeInteger(value) ? value : null
}

function assertNamespace(namespace: string): QuotaNamespace {
  if (!(SUPPORTED_QUOTA_NAMESPACES as readonly string[]).includes(namespace)) {
    throw new QuotaNamespaceError(namespace)
  }
  return namespace as QuotaNamespace
}

function defaultLimitKey(namespace: QuotaNamespace): string {
  return `${namespace}_user_daily_limit`
}

function overrideKey(namespace: QuotaNamespace, userId: number): string {
  return `${namespace}:limit:${userId}`
}

export class QuotaService {
  private readonly usage: QuotaUsageStore

  constructor(
    private drizzle: DrizzleDB,
    private env: QuotaServiceEnv = {}
  ) {
    this.usage = new QuotaUsageStore(drizzle)
  }





  async check(namespace: string, userId: number, pluginId: number): Promise<QuotaCheckResult> {
    const ns = assertNamespace(namespace)

    const limit = await this.resolveLimit(ns, userId)
    if (!limit.ok) return { status: limit.reason }

    let used: number
    try {
      used = await this.usage.readUsage(pluginId, userId, currentUtcDay())
    } catch {
      return { status: 'read-failed' }
    }

    return {
      status: used >= limit.limit ? 'exceeded' : 'ok',
      limit: limit.limit,
      used,
      source: limit.source
    }
  }





  async consume(
    namespace: string,
    userId: number,
    pluginId: number,
    quotaConsumed: boolean
  ): Promise<QuotaConsumeResult> {
    assertNamespace(namespace)
    if (quotaConsumed === false) return { status: 'skipped' }

    const written = await this.usage.consumeUsage(pluginId, userId, currentUtcDay())
    return written ? { status: 'consumed' } : { status: 'write-failed' }
  }


  async describeUserQuota(
    namespace: string,
    userId: number,
    pluginId: number
  ): Promise<QuotaDescription> {
    const ns = assertNamespace(namespace)

    let state: { usageDay: string | null; usageCount: number }
    try {
      state = await this.usage.readUsageState(pluginId, userId)
    } catch {
      return { ok: false, reason: 'read-failed' }
    }

    const described = await this.describeNamespaceQuotas(ns, [
      { userId, pluginId, usageDay: state.usageDay, usageCount: state.usageCount }
    ])
    if (!described.ok) return { ok: false, reason: described.reason }
    return described.rows[0]
  }









  async describeNamespaceQuotas(
    namespace: string,
    rows: QuotaUsageRow[]
  ): Promise<QuotaNamespaceDescription> {
    const ns = assertNamespace(namespace)

    const defaultLimit = await this.readDefaultLimit(ns)
    if (!defaultLimit.ok) return { ok: false, reason: defaultLimit.reason }

    const described = await Promise.all(
      rows.map(async (row) => {
        const override = await this.readOverride(ns, row.userId)
        if (override.kind === 'invalid') {
          return { ok: false as const, reason: 'invalid-limit' as const }
        }
        if (override.kind === 'read-failed') {
          return { ok: false as const, reason: 'read-failed' as const }
        }

        const overrideLimit = override.kind === 'value' ? override.limit : null
        const source: QuotaSource = overrideLimit === null ? 'default' : 'override'

        return {
          ok: true as const,
          defaultLimit: defaultLimit.limit,
          overrideLimit,
          effectiveLimit: overrideLimit === null ? defaultLimit.limit : overrideLimit,
          usageDay: row.usageDay,
          usageCount: row.usageCount,
          usageToday: row.usageDay === currentUtcDay() ? row.usageCount : 0,
          source
        }
      })
    )

    const failure = described.find((row) => !row.ok)
    if (failure && !failure.ok) return { ok: false, reason: failure.reason }

    return { ok: true, rows: described as Array<Extract<QuotaDescription, { ok: true }>> }
  }





  async setUserOverride(
    namespace: string,
    userId: number,
    limit: number | null
  ): Promise<QuotaOverrideResult> {
    const ns = assertNamespace(namespace)

    if (limit !== null && (!Number.isSafeInteger(limit) || limit < 0)) {
      return { status: 'invalid' }
    }

    const kv = this.env.QUOTA_KV
    if (!kv) {

      return limit === null ? { status: 'ok' } : { status: 'write-failed' }
    }

    try {
      const key = overrideKey(ns, userId)
      if (limit === null) {
        await kv.delete(key)
      } else {
        await kv.put(key, String(limit))
      }
      return { status: 'ok' }
    } catch {
      return { status: 'write-failed' }
    }
  }

  private async resolveLimit(namespace: QuotaNamespace, userId: number): Promise<LimitReadResult> {
    const override = await this.readOverride(namespace, userId)

    if (override.kind === 'value') {
      return { ok: true, limit: override.limit, source: 'override' }
    }
    if (override.kind === 'invalid') {
      return { ok: false, reason: 'invalid-limit' }
    }
    if (override.kind === 'read-failed') {
      return { ok: false, reason: 'read-failed' }
    }

    return this.readDefaultLimit(namespace)
  }

  private async readOverride(
    namespace: QuotaNamespace,
    userId: number
  ): Promise<OverrideReadResult> {
    const kv = this.env.QUOTA_KV
    if (!kv) return { kind: 'none' }

    let raw: string | null
    try {
      raw = await kv.get(overrideKey(namespace, userId))
    } catch {
      return { kind: 'read-failed' }
    }


    if (raw === null || raw === undefined) return { kind: 'none' }

    const parsed = parseQuotaLimit(raw)
    return parsed === null ? { kind: 'invalid' } : { kind: 'value', limit: parsed }
  }

  private async readDefaultLimit(namespace: QuotaNamespace): Promise<LimitReadResult> {
    let row: { value: string } | undefined

    try {
      row = await this.drizzle
        .select({ value: systemState.value })
        .from(systemState)
        .where(eq(systemState.key, defaultLimitKey(namespace)))
        .get()
    } catch {
      return { ok: false, reason: 'read-failed' }
    }

    if (!row) return { ok: true, limit: DEFAULT_DAILY_LIMIT, source: 'default' }

    const parsed = parseQuotaLimit(row.value)
    return parsed === null
      ? { ok: false, reason: 'invalid-limit' }
      : { ok: true, limit: parsed, source: 'default' }
  }
}
