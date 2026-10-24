





import {
  MAX_ATTEMPTS,
  decideRetry
} from '../../src/services/pluginJobs/pluginRetryPolicy.ts'

describe('pluginRetryPolicy', () => {
  test('MAX_ATTEMPTS is 3 (wrangler max_retries=2)', () => {
    expect(MAX_ATTEMPTS).toBe(3)
  })

  test('attempt 1 uses 2s fallback', () => {
    expect(
      decideRetry({
        failure: { errorCode: 'provider-network', retriable: true },
        attempt: 1
      })
    ).toEqual({ action: 'retry', delaySeconds: 2 })
  })

  test('attempt 2 uses 8s fallback', () => {
    expect(
      decideRetry({
        failure: { errorCode: 'provider-network', retriable: true },
        attempt: 2
      })
    ).toEqual({ action: 'retry', delaySeconds: 8 })
  })

  test('attempt 3 is dead (no more retries)', () => {
    expect(
      decideRetry({
        failure: { errorCode: 'provider-network', retriable: true },
        attempt: 3
      })
    ).toEqual({ action: 'dead' })
  })

  test('attempts beyond max are still dead', () => {
    expect(
      decideRetry({
        failure: { errorCode: 'provider-network', retriable: true },
        attempt: 7
      })
    ).toEqual({ action: 'dead' })
  })

  test('non-retriable failure is failed even on attempt 1', () => {
    expect(
      decideRetry({
        failure: { errorCode: 'provider-auth', retriable: false },
        attempt: 1
      })
    ).toEqual({ action: 'failed' })
  })

  test('retryAfterMs takes priority over the fallback table', () => {
    expect(
      decideRetry({
        failure: { errorCode: 'provider-rate-limit', retriable: true, retryAfterMs: 5000 },
        attempt: 1
      })
    ).toEqual({ action: 'retry', delaySeconds: 5 })
  })

  test('retryAfterMs below 1s is clamped up to 1 second', () => {
    expect(
      decideRetry({
        failure: { errorCode: 'provider-rate-limit', retriable: true, retryAfterMs: 100 },
        attempt: 1
      })
    ).toEqual({ action: 'retry', delaySeconds: 1 })
  })

  test('retryAfterMs above 60s is clamped down to 60 seconds', () => {
    expect(
      decideRetry({
        failure: { errorCode: 'provider-rate-limit', retriable: true, retryAfterMs: 120_000 },
        attempt: 1
      })
    ).toEqual({ action: 'retry', delaySeconds: 60 })
  })

  test('fractional milliseconds round up to whole seconds', () => {
    expect(
      decideRetry({
        failure: { errorCode: 'provider-rate-limit', retriable: true, retryAfterMs: 2500 },
        attempt: 1
      })
    ).toEqual({ action: 'retry', delaySeconds: 3 })
  })

  test('negative retryAfterMs falls back to the 1s clamp floor', () => {
    expect(
      decideRetry({
        failure: { errorCode: 'provider-rate-limit', retriable: true, retryAfterMs: -5000 },
        attempt: 1
      })
    ).toEqual({ action: 'retry', delaySeconds: 1 })
  })

  test('NaN retryAfterMs is ignored and the attempt fallback applies', () => {
    expect(
      decideRetry({
        failure: { errorCode: 'provider-rate-limit', retriable: true, retryAfterMs: Number.NaN },
        attempt: 2
      })
    ).toEqual({ action: 'retry', delaySeconds: 8 })
  })

  test('Infinity retryAfterMs is clamped to the 60s ceiling', () => {
    expect(
      decideRetry({
        failure: { errorCode: 'provider-rate-limit', retriable: true, retryAfterMs: Number.POSITIVE_INFINITY },
        attempt: 1
      })
    ).toEqual({ action: 'retry', delaySeconds: 60 })
  })

  test('maxAttempts can be overridden by the caller', () => {
    expect(
      decideRetry({
        failure: { errorCode: 'provider-network', retriable: true },
        attempt: 2,
        maxAttempts: 2
      })
    ).toEqual({ action: 'dead' })
  })
})
