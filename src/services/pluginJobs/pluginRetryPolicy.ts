








import type { PluginTaskFailure } from '../../plugins/jobs/types.ts'

export const MAX_ATTEMPTS = 3


export const FALLBACK_DELAYS_MS: readonly number[] = [2000, 8000]

const MIN_DELAY_MS = 1000
const MAX_DELAY_MS = 60_000

export type RetryDecision =
  | { action: 'retry'; delaySeconds: number }
  | { action: 'dead' }
  | { action: 'failed' }

export interface RetryInput {
  failure: PluginTaskFailure

  attempt: number
  maxAttempts?: number
}

export function decideRetry(input: RetryInput): RetryDecision {
  const maxAttempts = input.maxAttempts ?? MAX_ATTEMPTS

  if (!input.failure.retriable) return { action: 'failed' }

  const attempt = normalizeAttempt(input.attempt)
  if (attempt >= maxAttempts) return { action: 'dead' }

  const fallback =
    FALLBACK_DELAYS_MS[Math.min(attempt - 1, FALLBACK_DELAYS_MS.length - 1)]

  return {
    action: 'retry',
    delaySeconds: Math.ceil(clampDelayMs(resolveDelayMs(input.failure.retryAfterMs, fallback)) / 1000)
  }
}

function normalizeAttempt(attempt: number): number {
  if (!Number.isFinite(attempt)) return 1
  return Math.max(1, Math.trunc(attempt))
}


function resolveDelayMs(retryAfterMs: number | undefined, fallback: number): number {
  if (typeof retryAfterMs === 'number' && !Number.isNaN(retryAfterMs)) return retryAfterMs
  return fallback
}

function clampDelayMs(ms: number): number {
  if (Number.isNaN(ms)) return MIN_DELAY_MS
  return Math.min(MAX_DELAY_MS, Math.max(MIN_DELAY_MS, ms))
}
