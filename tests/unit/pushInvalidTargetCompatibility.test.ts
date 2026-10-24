
import { processClaimedJob } from '../../src/services/push/sendPipeline'
import { PushOutboxJob } from '../../src/services/push/outboxService'
import type { PushProvider, ProviderSendResult } from '../../src/services/push/contracts'

const now = () => Date.parse('2026-10-19T00:00:00.000Z')
function invalidTargetResult(status: number): ProviderSendResult {
  return { ok: false, retriable: status === 429 || status >= 500, failureKind: 'invalid-target', errorCode: 'FIXTURE_INVALID_TARGET' }
}

function makeTarget() {
  return {
    kind: 'ready',
    clientId: 1,
    platform: 'fixture_a',
    deviceToken: 'db-token',
    tokenUpdatedAt: '2026-10-19T00:00:00.000Z',
    tokenStatus: 'active'
  }
}

function makeOutbox(withInvalidator: boolean) {
  const outbox: any = {
    getPushTargetByClientId: jest.fn().mockResolvedValue(makeTarget()),
    markSuccess: jest.fn().mockResolvedValue(undefined),
    scheduleRetry: jest.fn().mockResolvedValue(undefined),
    markDead: jest.fn().mockResolvedValue(undefined),
    suspend: jest.fn().mockResolvedValue(undefined)
  }
  if (withInvalidator) {
    outbox.invalidateClient = jest.fn().mockResolvedValue(undefined)
  }
  return outbox
}


function legacyJob(): PushOutboxJob {
  return {
    id: 1,
    userId: 7,
    messageId: 100,
    platform: 'fixture_a',
    clientId: null,
    payloadJson: JSON.stringify({
      userId: 7,
      platform: 'fixture_a',
      deviceToken: 'legacy-token',
      messageId: 100,
      appid: 42,
      date: '2026-10-19T00:00:00.000Z',
      title: 'hello',
      message: 'world'
    }),
    status: 'pending',
    attemptCount: 0,
    nextRetryAt: null,
    lastError: null,
    createdAt: null,
    updatedAt: null
  }
}

function boundJob(): PushOutboxJob {
  return {
    id: 1,
    userId: 7,
    messageId: 100,
    platform: 'fixture_a',
    clientId: 1,
    payloadJson: JSON.stringify({
      userId: 7,
      platform: 'fixture_a',
      messageId: 100,
      appid: 42,
      date: '2026-10-19T00:00:00.000Z',
      title: 'hello',
      message: 'world'
    }),
    status: 'pending',
    attemptCount: 0,
    nextRetryAt: null,
    lastError: null,
    createdAt: null,
    updatedAt: null
  }
}

type CompatCase = {
  scenario: string
  status: number
  action: 'dead' | 'retry'
  invalidations: number
}

const scenarios = [
  { name: 'legacy', legacy: true, withInvalidator: false },
  { name: 'non-legacy without invalidateClient', legacy: false, withInvalidator: false },
  { name: 'non-legacy with invalidateClient', legacy: false, withInvalidator: true }
] as const

const cases: CompatCase[] = []
for (const status of [200, 429, 500]) {
  for (const scenario of scenarios) {
    const fallbackAction: 'dead' | 'retry' = status === 200 ? 'dead' : 'retry'
    cases.push({
      scenario: scenario.name,
      status,

      action: scenario.withInvalidator ? 'dead' : fallbackAction,
      invalidations: scenario.withInvalidator ? 1 : 0
    })
  }
}

describe('invalid-target fallback matrix (plugin provider + final pipeline)', () => {
  test.each(cases)('$scenario | HTTP $status', async ({ scenario, status, action, invalidations }) => {
    const send = jest.fn().mockResolvedValue(invalidTargetResult(status))
    const provider: PushProvider = { name: 'fixture_a', send }

    const scenarioConfig = scenarios.find(s => s.name === scenario)!
    const outbox = makeOutbox(scenarioConfig.withInvalidator)
    const job = scenarioConfig.legacy ? legacyJob() : boundJob()

    const result = await processClaimedJob(
      {
        outbox,
        providers: {
          get: jest.fn().mockReturnValue(provider),
          getPolicy: jest.fn().mockReturnValue({ maxRetries: 3, retryBackoffMs: 2000 })
        },
        now
      } as any,
      job
    )

    expect(send).toHaveBeenCalledTimes(1)
    expect(result.action).toBe(action)

    if (invalidations === 1) {
      expect(outbox.invalidateClient).toHaveBeenCalledTimes(1)
      expect(outbox.invalidateClient).toHaveBeenCalledWith(1, expect.stringContaining('Invalid push token:'))
    } else {
      expect(outbox.invalidateClient).toBeUndefined()
    }


    if (action === 'dead') {
      expect(outbox.markDead).toHaveBeenCalledWith(1, 1, expect.any(String))
      expect(outbox.scheduleRetry).not.toHaveBeenCalled()
    } else {
      expect(outbox.scheduleRetry).toHaveBeenCalledWith(1, 1, expect.any(String), expect.any(String))
      expect(outbox.markDead).not.toHaveBeenCalled()
    }
  })
})

describe('FixtureB placeholder', () => {
  test('FixtureB placeholder remains a permanent failure', async () => {
    const provider: PushProvider = {
      name: 'fixture_b',
      send: async () => ({ ok: false, retriable: false, errorCode: 'FIXTURE_NOT_IMPLEMENTED' })
    }
    const result = await provider.send({
      userId: 1,
      platform: 'fixture_b',
      deviceToken: 'tok',
      messageId: 1,
      appid: 1,
      date: '2026-10-19T00:00:00.000Z',
      message: 'm'
    })

    expect(result).toMatchObject({ ok: false, retriable: false, errorCode: 'FIXTURE_NOT_IMPLEMENTED' })
    expect(result.failureKind).toBeUndefined()
  })
})
