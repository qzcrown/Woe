











import { processClaimedJob } from '../../src/services/push/sendPipeline'
import { PushOutboxJob } from '../../src/services/push/outboxService'
import {
  DEFAULT_PUSH_DELIVERY_POLICY,
  ProviderResolver,
  PushDeliveryPolicy,
  PushPlatform,
  SUSPEND_RETRY_AT_DELAY_MS
} from '../../src/services/push/contracts'


const T0 = Date.parse('2026-10-19T00:00:00.000Z')
const now = () => T0


function makeTarget(overrides: Record<string, any> = {}) {
  return {
    kind: 'ready',
    clientId: 1,
    platform: 'fixture_a',
    deviceToken: 'db-token',
    tokenUpdatedAt: '2026-09-24T00:00:00.000Z',
    tokenStatus: 'active',
    ...overrides
  }
}

function makeOutbox(lookup: any = makeTarget()) {
  return {
    getPushTargetByClientId: jest.fn().mockResolvedValue(lookup),
    markSuccess: jest.fn().mockResolvedValue(undefined),
    scheduleRetry: jest.fn().mockResolvedValue(undefined),
    markDead: jest.fn().mockResolvedValue(undefined),
    suspend: jest.fn().mockResolvedValue(undefined),
    invalidateClient: jest.fn().mockResolvedValue(undefined)
  }
}


function makeJob(overrides: Partial<PushOutboxJob> = {}): PushOutboxJob {
  const platform = overrides.platform ?? 'fixture_a'
  return {
    id: 1,
    userId: 7,
    messageId: 100,
    platform,
    clientId: 1,
    payloadJson: JSON.stringify({
      userId: 7,
      platform,
      messageId: 100,
      appid: 42,
      date: '2026-09-24T10:00:00.000Z',
      title: 'hello',
      message: 'world'
    }),
    status: 'pending',
    attemptCount: 0,
    nextRetryAt: null,
    lastError: null,
    createdAt: null,
    updatedAt: null,
    ...overrides
  }
}







function makeProviders(
  send?: jest.Mock,
  options: { platform?: PushPlatform; policies?: Partial<Record<PushPlatform, PushDeliveryPolicy>>; provider?: 'present' | 'missing' } = {}
) {
  const platform = options.platform ?? 'fixture_a'
  const sendFn = send ?? jest.fn().mockResolvedValue({ ok: true, retriable: false })
  const policies = options.policies ?? {}
  const provider = options.provider ?? 'present'
  const providers = {
    get: jest.fn().mockImplementation((p: PushPlatform) =>
      provider === 'present' && p === platform ? { name: platform, send: sendFn } : null
    ),
    getPolicy: jest.fn().mockImplementation((p: PushPlatform) =>
      policies[p] ?? { ...DEFAULT_PUSH_DELIVERY_POLICY }
    )
  }
  return { providers, send: sendFn }
}

function makeDeps(outbox: ReturnType<typeof makeOutbox>, providers: ProviderResolver, overrides: Record<string, any> = {}) {
  return {
    outbox,
    providers,
    now,
    ...overrides
  }
}

describe('processClaimedJob 发送时解析（新形态载荷，无 deviceToken 快照）', () => {
  test('ready 目标 → provider 收到发送时读取的 DB token，markSuccess，返回 success', async () => {
    const outbox = makeOutbox()
    const { providers } = makeProviders()

    const deps = makeDeps(outbox, providers)
    const result = await processClaimedJob(deps, makeJob())

    expect(providers.get).toHaveBeenCalledWith('fixture_a')
    expect(result).toEqual({ action: 'success' })
    expect(outbox.markSuccess).toHaveBeenCalledWith(1)

    const sendInput = providers.get.mock.results[0].value.send.mock.calls[0][0]
    expect(sendInput.deviceToken).toBe('db-token')
    expect(outbox.markDead).not.toHaveBeenCalled()
  })

  test('旧形态载荷（含 deviceToken）但行有 client_id → 仍用当前 DB token 发送（忽略载荷快照）', async () => {
    const outbox = makeOutbox()
    const { providers } = makeProviders()
    const job = makeJob({
      payloadJson: JSON.stringify({
        userId: 7,
        platform: 'fixture_a',
        deviceToken: 'stale-payload-token',
        messageId: 100,
        appid: 42,
        date: '2026-09-24T10:00:00.000Z',
        message: 'world'
      })
    })

    await processClaimedJob(makeDeps(outbox, providers), job)

    const sendInput = providers.get.mock.results[0].value.send.mock.calls[0][0]
    expect(sendInput.deviceToken).toBe('db-token')
  })
})

describe('processClaimedJob 发送前闸门（不调 provider，attemptCount 原值）', () => {
  test('deleted → dead Undeliverable: client deleted', async () => {
    const outbox = makeOutbox({ kind: 'deleted', clientId: 1 })
    const { providers } = makeProviders()

    const result = await processClaimedJob(makeDeps(outbox, providers), makeJob({ attemptCount: 2 }))

    expect(result).toEqual({ action: 'dead' })
    expect(outbox.markDead).toHaveBeenCalledWith(1, 2, 'Undeliverable: client deleted')
    expect(providers.get).not.toHaveBeenCalled()
  })

  test('inactive → dead Suppressed: client push disabled (token_status=inactive)', async () => {
    const outbox = makeOutbox(makeTarget({ kind: 'inactive', tokenStatus: 'inactive' }))
    const { providers } = makeProviders()

    const result = await processClaimedJob(makeDeps(outbox, providers), makeJob({ attemptCount: 1 }))

    expect(result).toEqual({ action: 'dead' })
    expect(outbox.markDead).toHaveBeenCalledWith(1, 1, 'Suppressed: client push disabled (token_status=inactive)')
    expect(providers.get).not.toHaveBeenCalled()
  })

  test('invalid（非 active 的其他状态）→ dead Suppressed 文案动态记录实际 token_status', async () => {
    const outbox = makeOutbox(makeTarget({ kind: 'inactive', tokenStatus: 'invalid' }))
    const { providers } = makeProviders()

    const result = await processClaimedJob(makeDeps(outbox, providers), makeJob({ attemptCount: 1 }))

    expect(result).toEqual({ action: 'dead' })
    expect(outbox.markDead).toHaveBeenCalledWith(1, 1, 'Suppressed: client push disabled (token_status=invalid)')
    expect(providers.get).not.toHaveBeenCalled()
  })

  test('no-token（device_token 为空串）→ dead Undeliverable: no device token', async () => {
    const outbox = makeOutbox(makeTarget({ kind: 'no-token', deviceToken: '' }))
    const { providers } = makeProviders()

    const result = await processClaimedJob(makeDeps(outbox, providers), makeJob({ attemptCount: 3 }))

    expect(result).toEqual({ action: 'dead' })
    expect(outbox.markDead).toHaveBeenCalledWith(1, 3, 'Undeliverable: no device token')
    expect(providers.get).not.toHaveBeenCalled()
  })

  test('目标 platform 与行 platform 不一致 → dead Undeliverable: client platform changed（不把 FixtureB token 交给 FixtureA provider）', async () => {
    const outbox = makeOutbox(makeTarget({ platform: 'fixture_b' }))
    const { providers } = makeProviders()

    const result = await processClaimedJob(makeDeps(outbox, providers), makeJob({ attemptCount: 0 }))

    expect(result).toEqual({ action: 'dead' })
    expect(outbox.markDead).toHaveBeenCalledWith(1, 0, 'Undeliverable: client platform changed')
    expect(providers.get).not.toHaveBeenCalled()
  })

  test('历史 platform=unknown 的目标也能被读取并按平台变化判 dead（不抛类型错误）', async () => {
    const outbox = makeOutbox(makeTarget({ platform: 'unknown' }))
    const { providers } = makeProviders()

    await processClaimedJob(makeDeps(outbox, providers), makeJob())

    expect(outbox.markDead).toHaveBeenCalledWith(1, 0, 'Undeliverable: client platform changed')
    expect(providers.get).not.toHaveBeenCalled()
  })
})

describe('processClaimedJob legacy 分支（client_id 为空的历史行）', () => {
  const legacyJob = (payloadExtra: Record<string, any> = {}, overrides: Partial<PushOutboxJob> = {}) =>
    makeJob({
      clientId: null,
      payloadJson: JSON.stringify({
        userId: 7,
        platform: 'fixture_a',
        ...payloadExtra,
        messageId: 100,
        appid: 42,
        date: '2026-09-24T10:00:00.000Z',
        message: 'world'
      }),
      ...overrides
    })

  test('载荷含非空 deviceToken → 用该快照发送，成功；不读 getPushTargetByClientId', async () => {
    const outbox = makeOutbox()
    const { providers } = makeProviders()

    const result = await processClaimedJob(
      makeDeps(outbox, providers),
      legacyJob({ deviceToken: 'legacy-token' })
    )

    expect(result).toEqual({ action: 'success' })
    expect(outbox.getPushTargetByClientId).not.toHaveBeenCalled()
    const sendInput = providers.get.mock.results[0].value.send.mock.calls[0][0]
    expect(sendInput.deviceToken).toBe('legacy-token')
  })

  test('载荷无 deviceToken → dead Undeliverable: no client binding（attemptCount 原值）', async () => {
    const outbox = makeOutbox()
    const { providers } = makeProviders()

    const result = await processClaimedJob(makeDeps(outbox, providers), legacyJob({}, { attemptCount: 2 }))

    expect(result).toEqual({ action: 'dead' })
    expect(outbox.markDead).toHaveBeenCalledWith(1, 2, 'Undeliverable: no client binding')
    expect(providers.get).not.toHaveBeenCalled()
  })
})

describe('processClaimedJob 共享 parsePayload', () => {
  test('结构性损坏（缺 deeplink 契约字段）→ dead Invalid outbox payload（attemptCount +1，沿用旧口径）', async () => {
    const outbox = makeOutbox()
    const { providers } = makeProviders()
    const job = makeJob({
      payloadJson: JSON.stringify({ userId: 7, platform: 'fixture_a', message: 'world' })
    })

    const result = await processClaimedJob(makeDeps(outbox, providers), job)

    expect(result).toEqual({ action: 'dead' })
    expect(outbox.markDead).toHaveBeenCalledWith(1, 1, 'Invalid outbox payload')
    expect(providers.get).not.toHaveBeenCalled()
  })

  test('非 JSON → dead Invalid outbox payload（+1）', async () => {
    const outbox = makeOutbox()
    const { providers } = makeProviders()

    await processClaimedJob(makeDeps(outbox, providers), makeJob({ payloadJson: 'not-json' }))

    expect(outbox.markDead).toHaveBeenCalledWith(1, 1, 'Invalid outbox payload')
  })

  test('messageId 与行不一致 → dead Invalid outbox payload: job/payload mismatch（原值）', async () => {
    const outbox = makeOutbox()
    const { providers } = makeProviders()
    const job = makeJob({
      payloadJson: JSON.stringify({
        userId: 7, platform: 'fixture_a', messageId: 999, appid: 42,
        date: '2026-09-24T10:00:00.000Z', message: 'world'
      })
    })

    const result = await processClaimedJob(makeDeps(outbox, providers), job)

    expect(result).toEqual({ action: 'dead' })
    expect(outbox.markDead).toHaveBeenCalledWith(1, 0, 'Invalid outbox payload: job/payload mismatch')
    expect(providers.get).not.toHaveBeenCalled()
  })

  test('载荷 platform 与行不一致 → job/payload mismatch dead', async () => {
    const outbox = makeOutbox()
    const { providers } = makeProviders()
    const job = makeJob({
      platform: 'fixture_a',
      payloadJson: JSON.stringify({
        userId: 7, platform: 'fixture_b', messageId: 100, appid: 42,
        date: '2026-09-24T10:00:00.000Z', message: 'world'
      })
    })

    await processClaimedJob(makeDeps(outbox, providers), job)

    expect(outbox.markDead).toHaveBeenCalledWith(1, 0, 'Invalid outbox payload: job/payload mismatch')
  })

  test('载荷 userId（若有）与行不一致 → job/payload mismatch dead', async () => {
    const outbox = makeOutbox()
    const { providers } = makeProviders()
    const job = makeJob({
      payloadJson: JSON.stringify({
        userId: 99, platform: 'fixture_a', messageId: 100, appid: 42,
        date: '2026-09-24T10:00:00.000Z', message: 'world'
      })
    })

    await processClaimedJob(makeDeps(outbox, providers), job)

    expect(outbox.markDead).toHaveBeenCalledWith(1, 0, 'Invalid outbox payload: job/payload mismatch')
  })
})

describe('processClaimedJob provider 挂起语义（沿用现有文案与共享固定延迟）', () => {
  test('无 provider → suspend（T0 + 60s），不计尝试次数', async () => {
    const outbox = makeOutbox()
    const { providers } = makeProviders(undefined, { provider: 'missing' })

    const result = await processClaimedJob(makeDeps(outbox, providers), makeJob({ attemptCount: 2 }))

    expect(result).toEqual({ action: 'suspend' })
    expect(outbox.suspend).toHaveBeenCalledWith(1, new Date(T0 + SUSPEND_RETRY_AT_DELAY_MS).toISOString(), 'Suspended: no provider for platform fixture_a')
    expect(outbox.markDead).not.toHaveBeenCalled()
  })

  test('failureKind suspend → suspend，固定 +60s 且不加 attempt', async () => {
    const outbox = makeOutbox()
    const { providers } = makeProviders(
      jest.fn().mockResolvedValue({ ok: false, retriable: false, failureKind: 'suspend', errorCode: 'FIXTURE_CONFIG_MISSING', errorMessage: 'config missing' })
    )

    const result = await processClaimedJob(makeDeps(outbox, providers), makeJob({ attemptCount: 4 }))

    expect(result).toEqual({ action: 'suspend' })
    expect(outbox.suspend).toHaveBeenCalledWith(1, new Date(T0 + SUSPEND_RETRY_AT_DELAY_MS).toISOString(), 'Suspended: config missing')
    expect(outbox.markDead).not.toHaveBeenCalled()
  })
})

describe('processClaimedJob 策略来自 resolver.getPolicy（默认 3/2000，按平台隔离）', () => {
  test('default policy retries the first failure after 2000ms', async () => {
    const outbox = makeOutbox()
    const { providers } = makeProviders(
      jest.fn().mockResolvedValue({ ok: false, retriable: true, errorMessage: 'temporary failure' })
    )
    const job = makeJob({ attemptCount: 0 })

    const result = await processClaimedJob(makeDeps(outbox, providers), job)

    expect(result.action).toBe('retry')
    expect(outbox.scheduleRetry).toHaveBeenCalledWith(job.id, 1, '2026-10-19T00:00:02.000Z', 'temporary failure')
    expect(outbox.markDead).not.toHaveBeenCalled()
    expect(providers.getPolicy).toHaveBeenCalledWith('fixture_a')
  })

  test('默认策略稳定目标 retriable attempt=0/1/2 → retry(+2000,1)/retry(+4000,2)/dead(3)', async () => {
    const cases = [
      { attemptCount: 0, action: 'retry' as const, retryAt: '2026-10-19T00:00:02.000Z', attempt: 1 },
      { attemptCount: 1, action: 'retry' as const, retryAt: '2026-10-19T00:00:04.000Z', attempt: 2 },
      { attemptCount: 2, action: 'dead' as const, retryAt: null, attempt: 3 }
    ]
    for (const c of cases) {
      const outbox = makeOutbox()
      const { providers } = makeProviders(
        jest.fn().mockResolvedValue({ ok: false, retriable: true, errorMessage: 'network' })
      )

      const result = await processClaimedJob(makeDeps(outbox, providers), makeJob({ attemptCount: c.attemptCount }))

      expect(result.action).toBe(c.action)
      if (c.action === 'retry') {
        expect(outbox.scheduleRetry).toHaveBeenCalledWith(1, c.attempt, c.retryAt, 'network')
        expect(outbox.markDead).not.toHaveBeenCalled()
      } else {
        expect(outbox.markDead).toHaveBeenCalledWith(1, c.attempt, 'network')
        expect(outbox.scheduleRetry).not.toHaveBeenCalled()
      }
    }
  })

  test('策略按平台从 resolver 读取：平台 A 5/7000 时 FixtureB 行仍用 3/2000', async () => {
    const makeResolver = () => {
      const sends: Record<string, jest.Mock> = {
        fixture_a: jest.fn().mockResolvedValue({ ok: false, retriable: true, errorMessage: 'network' }),
        fixture_b: jest.fn().mockResolvedValue({ ok: false, retriable: true, errorMessage: 'network' })
      }
      return {
        get: jest.fn().mockImplementation((p: PushPlatform) => ({ name: p, send: sends[p] })),
        getPolicy: jest.fn().mockImplementation((p: PushPlatform) =>
          p === 'fixture_a' ? { maxRetries: 5, retryBackoffMs: 7000 } : { ...DEFAULT_PUSH_DELIVERY_POLICY }
        )
      }
    }


    const fixture_aOutbox = makeOutbox()
    const fixture_aResolver = makeResolver()
    const fixture_aResult = await processClaimedJob(
      makeDeps(fixture_aOutbox, fixture_aResolver),
      makeJob({ platform: 'fixture_a', attemptCount: 3 })
    )
    expect(fixture_aResult.action).toBe('retry')
    expect(fixture_aOutbox.scheduleRetry).toHaveBeenCalledWith(1, 4, new Date(T0 + 7000 * 4).toISOString(), 'network')


    const fixture_bOutbox = makeOutbox(makeTarget({ platform: 'fixture_b' }))
    const fixture_bResolver = makeResolver()
    const fixture_bResult = await processClaimedJob(
      makeDeps(fixture_bOutbox, fixture_bResolver),
      makeJob({ platform: 'fixture_b', attemptCount: 2 })
    )
    expect(fixture_bResult).toEqual({ action: 'dead' })
    expect(fixture_bOutbox.markDead).toHaveBeenCalledWith(1, 3, 'network')
    expect(fixture_bOutbox.scheduleRetry).not.toHaveBeenCalled()
    expect(fixture_bResolver.getPolicy).toHaveBeenCalledWith('fixture_b')
  })

  test('500ms 退避下限保留（策略退避 < 500 时按 500 计算）', async () => {
    const outbox = makeOutbox()
    const { providers } = makeProviders(
      jest.fn().mockResolvedValue({ ok: false, retriable: true, errorMessage: 'network' }),
      { policies: { fixture_a: { maxRetries: 3, retryBackoffMs: 100 } } }
    )

    const result = await processClaimedJob(makeDeps(outbox, providers), makeJob({ attemptCount: 0 }))

    expect(result.action).toBe('retry')
    expect(outbox.scheduleRetry).toHaveBeenCalledWith(1, 1, new Date(T0 + 500).toISOString(), 'network')
  })
})

describe('processClaimedJob 失败分类', () => {
  test('retriable 且未达上限 → scheduleRetry(+1)，返回 retry 携带 nextRetryAt/reason（注入时钟退避）', async () => {
    const outbox = makeOutbox()
    const { providers } = makeProviders(
      jest.fn().mockResolvedValue({ ok: false, retriable: true, errorMessage: 'network' })
    )

    const result = await processClaimedJob(makeDeps(outbox, providers), makeJob({ attemptCount: 0 }))

    expect(result.action).toBe('retry')
    if (result.action === 'retry') {
      expect(result.nextRetryAt).toBe(new Date(T0 + 2000 * 1).toISOString())
      expect(result.reason).toBe('network')
    }
    expect(outbox.scheduleRetry).toHaveBeenCalledWith(1, 1, new Date(T0 + 2000).toISOString(), 'network')
    expect(outbox.markDead).not.toHaveBeenCalled()
  })

  test('退避按尝试次数线性放大：attemptCount=1 → nextAttempt=2 → T0 + backoff*2', async () => {
    const outbox = makeOutbox()
    const { providers } = makeProviders(
      jest.fn().mockResolvedValue({ ok: false, retriable: true, errorMessage: 'network' })
    )

    const result = await processClaimedJob(makeDeps(outbox, providers), makeJob({ attemptCount: 1 }))

    expect(result.action).toBe('retry')
    if (result.action === 'retry') {
      expect(result.nextRetryAt).toBe(new Date(T0 + 2000 * 2).toISOString())
    }
    expect(outbox.scheduleRetry).toHaveBeenCalledWith(1, 2, new Date(T0 + 2000 * 2).toISOString(), 'network')
  })

  test('retriable 但达到上限 → markDead(nextAttempt)', async () => {
    const outbox = makeOutbox()
    const { providers } = makeProviders(
      jest.fn().mockResolvedValue({ ok: false, retriable: true, errorMessage: 'network' })
    )

    const result = await processClaimedJob(makeDeps(outbox, providers), makeJob({ attemptCount: 2 }))


    expect(result).toEqual({ action: 'dead' })
    expect(outbox.markDead).toHaveBeenCalledWith(1, 3, 'network')
    expect(outbox.scheduleRetry).not.toHaveBeenCalled()
  })

  test('非 retriable 失败（目标未变）→ 照旧 markDead(+1)', async () => {
    const outbox = makeOutbox()
    const { providers } = makeProviders(
      jest.fn().mockResolvedValue({ ok: false, retriable: false, errorMessage: 'invalid token' })
    )

    const result = await processClaimedJob(makeDeps(outbox, providers), makeJob({ attemptCount: 4 }))

    expect(result).toEqual({ action: 'dead' })
    expect(outbox.markDead).toHaveBeenCalledWith(1, 5, 'invalid token')
  })

  test('错误信息缺省时回落 errorCode，再回落 Push send failed', async () => {
    const outbox = makeOutbox()
    const { providers } = makeProviders(
      jest.fn().mockResolvedValue({ ok: false, retriable: false, errorCode: 'FIXTURE_NOT_IMPLEMENTED' })
    )

    await processClaimedJob(makeDeps(outbox, providers), makeJob())

    expect(outbox.markDead).toHaveBeenCalledWith(1, 1, 'FIXTURE_NOT_IMPLEMENTED')
  })
})

describe('processClaimedJob invalid-target 失效立即收敛（基于 failureKind 分类）', () => {
  test('invalidateClient 存在 → 认领失效后直接 markDead，不被目标变化守卫复活为 pending', async () => {
    const outbox = makeOutbox()
    const { providers } = makeProviders(
      jest.fn().mockResolvedValue({
        ok: false,
        retriable: false,
        failureKind: 'invalid-target',
        errorCode: 'FIXTURE_PUSH_FIXTURE_INVALID_TARGET',
        errorMessage: 'Push send failed (HTTP 200, code FIXTURE_INVALID_TARGET): all tokens invalid'
      })
    )

    const result = await processClaimedJob(makeDeps(outbox, providers), makeJob())

    expect(result).toEqual({ action: 'dead' })
    expect(outbox.invalidateClient).toHaveBeenCalledWith(1, expect.stringContaining('Invalid push token:'))
    expect(outbox.markDead).toHaveBeenCalledWith(1, 1, 'Push send failed (HTTP 200, code FIXTURE_INVALID_TARGET): all tokens invalid')

    expect(outbox.scheduleRetry).not.toHaveBeenCalled()
    expect(outbox.getPushTargetByClientId).toHaveBeenCalledTimes(1)
  })

  test('invalidateClient 缺席（可选依赖未接线）→ 不抛错，走原分类照旧 markDead', async () => {
    const outbox = makeOutbox()
    delete (outbox as any).invalidateClient
    const { providers } = makeProviders(
      jest.fn().mockResolvedValue({ ok: false, retriable: false, failureKind: 'invalid-target', errorCode: 'FIXTURE_PUSH_FIXTURE_INVALID_TARGET' })
    )

    const result = await processClaimedJob(makeDeps(outbox, providers), makeJob())

    expect(result).toEqual({ action: 'dead' })
    expect(outbox.markDead).toHaveBeenCalledWith(1, 1, 'FIXTURE_PUSH_FIXTURE_INVALID_TARGET')
  })

  test('invalid-target without invalidator retains target-change guard（发送期间目标变化 → retry）', async () => {
    const outbox = makeOutbox()
    delete (outbox as any).invalidateClient
    outbox.getPushTargetByClientId
      .mockResolvedValueOnce(makeTarget())
      .mockResolvedValueOnce(makeTarget({ deviceToken: 'rotated-token' }))
    const { providers } = makeProviders(
      jest.fn().mockResolvedValue({
        ok: false,
        retriable: false,
        failureKind: 'invalid-target',
        errorCode: 'FIXTURE_PUSH_FIXTURE_INVALID_TARGET',
        errorMessage: 'invalid target'
      })
    )

    const result = await processClaimedJob(makeDeps(outbox, providers), makeJob({ attemptCount: 0 }))

    expect(result.action).toBe('retry')
    expect(outbox.scheduleRetry).toHaveBeenCalledWith(
      1, 1, expect.any(String), expect.stringContaining('client target changed during send')
    )
    expect(outbox.markDead).not.toHaveBeenCalled()

    expect(outbox.getPushTargetByClientId).toHaveBeenCalledTimes(2)
  })

  test('相同 errorCode 不带 failureKind 不触发厂商特例（走普通永久失败守卫 → dead）', async () => {
    const outbox = makeOutbox()
    const { providers } = makeProviders(
      jest.fn().mockResolvedValue({ ok: false, retriable: false, errorCode: 'FIXTURE_PUSH_FIXTURE_INVALID_TARGET' })
    )

    const result = await processClaimedJob(makeDeps(outbox, providers), makeJob())

    expect(result).toEqual({ action: 'dead' })
    expect(outbox.invalidateClient).not.toHaveBeenCalled()
    expect(outbox.markDead).toHaveBeenCalledWith(1, 1, 'FIXTURE_PUSH_FIXTURE_INVALID_TARGET')
    expect(outbox.scheduleRetry).not.toHaveBeenCalled()
  })
})

describe('processClaimedJob 发送期间目标变化守卫（仅将判 dead 的分支重读一次，绕过 markDead 判定）', () => {
  function failOnceThenChangeTarget(outbox: ReturnType<typeof makeOutbox>, changed: any) {

    outbox.getPushTargetByClientId
      .mockResolvedValueOnce(makeTarget())
      .mockResolvedValueOnce(changed)
    return jest.fn().mockResolvedValue({ ok: false, retriable: false, errorMessage: 'boom' })
  }

  test('deviceToken 变化 → scheduleRetry 附 client target changed during send，不 markDead', async () => {
    const outbox = makeOutbox()
    const send = failOnceThenChangeTarget(outbox, makeTarget({ deviceToken: 'rotated-token' }))
    const { providers } = makeProviders(send)

    const result = await processClaimedJob(makeDeps(outbox, providers), makeJob({ attemptCount: 0 }))

    expect(result.action).toBe('retry')
    expect(outbox.scheduleRetry).toHaveBeenCalledWith(
      1, 1, new Date(T0 + 2000).toISOString(), 'boom; client target changed during send'
    )
    expect(outbox.markDead).not.toHaveBeenCalled()
    expect(outbox.getPushTargetByClientId).toHaveBeenCalledTimes(2)
  })

  test('client 删除 → 即使错误不可重试也 scheduleRetry', async () => {
    const outbox = makeOutbox()
    const send = failOnceThenChangeTarget(outbox, { kind: 'deleted', clientId: 1 })
    const { providers } = makeProviders(send)

    const result = await processClaimedJob(makeDeps(outbox, providers), makeJob())

    expect(result.action).toBe('retry')
    expect(outbox.scheduleRetry).toHaveBeenCalledWith(
      1, 1, expect.any(String), expect.stringContaining('client target changed during send')
    )
    expect(outbox.markDead).not.toHaveBeenCalled()
  })

  test('平台变化（fixture_a → fixture_b）→ scheduleRetry', async () => {
    const outbox = makeOutbox()
    const send = failOnceThenChangeTarget(outbox, makeTarget({ platform: 'fixture_b' }))
    const { providers } = makeProviders(send)

    const result = await processClaimedJob(makeDeps(outbox, providers), makeJob())

    expect(result.action).toBe('retry')
    expect(outbox.scheduleRetry).toHaveBeenCalled()
    expect(outbox.markDead).not.toHaveBeenCalled()
  })

  test('token_status 变 inactive（kind 非 ready）→ scheduleRetry', async () => {
    const outbox = makeOutbox()
    const send = failOnceThenChangeTarget(outbox, makeTarget({ kind: 'inactive', tokenStatus: 'inactive' }))
    const { providers } = makeProviders(send)

    const result = await processClaimedJob(makeDeps(outbox, providers), makeJob())

    expect(result.action).toBe('retry')
    expect(outbox.markDead).not.toHaveBeenCalled()
  })

  test('tokenUpdatedAt 变化（token 相同）→ scheduleRetry', async () => {
    const outbox = makeOutbox()
    const send = failOnceThenChangeTarget(outbox, makeTarget({ tokenUpdatedAt: '2026-09-24T11:00:00.000Z' }))
    const { providers } = makeProviders(send)

    const result = await processClaimedJob(makeDeps(outbox, providers), makeJob())

    expect(result.action).toBe('retry')
    expect(outbox.markDead).not.toHaveBeenCalled()
  })

  test('legacy 行（client_id 为空）失败时不做变化守卫重读 → 非 retriable 照旧 dead', async () => {
    const outbox = makeOutbox()
    const send = jest.fn().mockResolvedValue({ ok: false, retriable: false, errorMessage: 'boom' })
    const { providers } = makeProviders(send)
    const job = makeJob({
      clientId: null,
      payloadJson: JSON.stringify({
        userId: 7, platform: 'fixture_a', deviceToken: 'legacy-token', messageId: 100,
        appid: 42, date: '2026-09-24T10:00:00.000Z', message: 'world'
      })
    })

    const result = await processClaimedJob(makeDeps(outbox, providers), job)

    expect(result).toEqual({ action: 'dead' })
    expect(outbox.getPushTargetByClientId).not.toHaveBeenCalled()
    expect(outbox.markDead).toHaveBeenCalledWith(1, 1, 'boom')
  })

  test('可重试失败不做守卫重读（下轮重试自然重读）→ 纯 scheduleRetry 无后缀，getPushTargetByClientId 仅调用一次', async () => {

    const outbox = makeOutbox(makeTarget({ deviceToken: 'rotated-token' }))
    const { providers } = makeProviders(
      jest.fn().mockResolvedValue({ ok: false, retriable: true, errorMessage: 'network' })
    )

    const result = await processClaimedJob(makeDeps(outbox, providers), makeJob({ attemptCount: 0 }))

    expect(result.action).toBe('retry')
    if (result.action === 'retry') {
      expect(result.reason).toBe('network')
    }
    expect(outbox.scheduleRetry).toHaveBeenCalledWith(1, 1, new Date(T0 + 2000).toISOString(), 'network')
    expect(outbox.markDead).not.toHaveBeenCalled()

    expect(outbox.getPushTargetByClientId).toHaveBeenCalledTimes(1)
  })

  test('守卫重读抛错（D1 瞬时故障）→ 视为未证实变化，照旧 markDead，行不卡在 processing', async () => {
    const outbox = makeOutbox()
    outbox.getPushTargetByClientId
      .mockResolvedValueOnce(makeTarget())
      .mockRejectedValueOnce(new Error('d1 hiccup'))
    const { providers } = makeProviders(
      jest.fn().mockResolvedValue({ ok: false, retriable: false, errorMessage: 'boom' })
    )

    const result = await processClaimedJob(makeDeps(outbox, providers), makeJob({ attemptCount: 0 }))

    expect(result).toEqual({ action: 'dead' })
    expect(outbox.markDead).toHaveBeenCalledWith(1, 1, 'boom')
    expect(outbox.scheduleRetry).not.toHaveBeenCalled()
  })
})
