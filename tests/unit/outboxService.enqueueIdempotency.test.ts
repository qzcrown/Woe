














import { PushOutboxService } from '../../src/services/push/outboxService'
import { createTestDb, asDrizzle, seedClient } from '../helpers/testDb'
import { pushOutbox, systemState } from '../../src/models'
import { ENQUEUE_WRITE_GATE_KEY } from '../../src/services/writeGateService'

function makeInput(messageId: number, overrides: Partial<Parameters<PushOutboxService['enqueueForUserDevices']>[0]> = {}) {
  return {
    userId: 7,
    messageId,
    appid: 42,
    date: '2026-09-24T10:00:00.000Z',
    platform: 'fixture_a' as const,
    message: 'hello',
    ...overrides
  }
}

function allOutboxRows(testDb: ReturnType<typeof createTestDb>) {
  return testDb.db.select().from(pushOutbox).all()
}


function seedGate(testDb: ReturnType<typeof createTestDb>, value: string) {
  testDb.db
    .insert(systemState)
    .values({ key: ENQUEUE_WRITE_GATE_KEY, value })
    .onConflictDoUpdate({ target: systemState.key, set: { value } })
    .run()
}

describe('PushOutboxService.enqueueForUserDevices 入队幂等（0010 唯一索引 + onConflictDoNothing）', () => {
  test('同 (client, message) 两次入队：库中一行；第一次 count=1，第二次 count=0 且 outboxIds=[]', async () => {
    const testDb = createTestDb()
    const service = new PushOutboxService(asDrizzle(testDb))
    const client = seedClient(testDb)

    const first = await service.enqueueForUserDevices(makeInput(100))
    expect(first.count).toBe(1)
    expect(first.outboxIds).toHaveLength(1)



    const second = await service.enqueueForUserDevices(makeInput(100))
    expect(second.count).toBe(0)
    expect(second.outboxIds).toEqual([])

    const rows = allOutboxRows(testDb)
    expect(rows).toHaveLength(1)
    expect(rows[0].clientId).toBe(client.id)
    expect(rows[0].messageId).toBe(100)
    expect(rows[0].status).toBe('pending')
  })

  test('不同 client 同 message / 同 client 不同 message 互不影响（各两行）', async () => {
    const testDb = createTestDb()
    const service = new PushOutboxService(asDrizzle(testDb))

    const clientA = seedClient(testDb, { deviceUid: 'device-a' })
    const clientB = seedClient(testDb, { deviceUid: 'device-b' })


    const first = await service.enqueueForUserDevices(makeInput(200))
    expect(first.count).toBe(2)
    expect(allOutboxRows(testDb)).toHaveLength(2)


    const second = await service.enqueueForUserDevices(makeInput(201))
    expect(second.count).toBe(2)

    const rows = allOutboxRows(testDb)
    expect(rows).toHaveLength(4)
    for (const client of [clientA, clientB]) {
      const clientRows = rows.filter((r) => r.clientId === client.id)
      expect(clientRows.map((r) => r.messageId).sort()).toEqual([200, 201])
    }


    const repeat = await service.enqueueForUserDevices(makeInput(200))
    expect(repeat.count).toBe(0)
    expect(allOutboxRows(testDb)).toHaveLength(4)
  })

  test('必测用例 5：行处于 processing 时重复入队 → DO NOTHING 保留原行，不产生第二行、不改其状态', async () => {
    const testDb = createTestDb()
    const service = new PushOutboxService(asDrizzle(testDb))
    const client = seedClient(testDb)

    const first = await service.enqueueForUserDevices(makeInput(300))
    expect(first.count).toBe(1)
    const originalId = first.outboxIds[0]

    testDb.db.update(pushOutbox).set({ status: 'processing' }).run()

    const second = await service.enqueueForUserDevices(makeInput(300))
    expect(second.count).toBe(0)
    expect(second.outboxIds).toEqual([])

    const rows = allOutboxRows(testDb)
    expect(rows).toHaveLength(1)
    expect(rows[0].id).toBe(originalId)
    expect(rows[0].status).toBe('processing')
    expect(rows[0].clientId).toBe(client.id)
  })

  test('两个 fixture_a client（均有 deviceToken）同消息入队 → 2 行；重复 → 仍 2 行、count=0；部分冲突批量 count=实际插入数', async () => {
    const testDb = createTestDb()
    const service = new PushOutboxService(asDrizzle(testDb))
    seedClient(testDb, { deviceUid: 'device-1' })
    seedClient(testDb, { deviceUid: 'device-2' })

    const first = await service.enqueueForUserDevices(makeInput(400))
    expect(first.count).toBe(2)
    expect(first.outboxIds).toHaveLength(2)
    expect(allOutboxRows(testDb)).toHaveLength(2)

    const repeat = await service.enqueueForUserDevices(makeInput(400))
    expect(repeat.count).toBe(0)
    expect(repeat.outboxIds).toEqual([])
    expect(allOutboxRows(testDb)).toHaveLength(2)


    const newClient = seedClient(testDb, { deviceUid: 'device-3' })
    const third = await service.enqueueForUserDevices(makeInput(400))
    expect(third.count).toBe(1)

    const rows = allOutboxRows(testDb)
    expect(rows).toHaveLength(3)
    expect(rows.filter((r) => r.clientId === newClient.id)).toHaveLength(1)


    const liveIds = rows.map((r) => r.id).sort((a, b) => a - b)
    expect(liveIds).toEqual([...first.outboxIds, third.outboxIds[0]].sort((a, b) => a - b))
  })

  test('落库 payloadJson 键集不含 deviceToken（自 push-flow mock 用例迁移的真库断言）', async () => {
    const testDb = createTestDb()
    const service = new PushOutboxService(asDrizzle(testDb))
    seedClient(testDb)

    const result = await service.enqueueForUserDevices(
      makeInput(500, { title: 'hello', priority: 5 })
    )
    expect(result.count).toBe(1)

    const rows = allOutboxRows(testDb)
    expect(rows).toHaveLength(1)

    expect(Object.keys(JSON.parse(rows[0].payloadJson)).sort()).toEqual(
      ['appid', 'date', 'extras', 'message', 'messageId', 'platform', 'priority', 'title', 'userId']
    )
    expect(rows[0].status).toBe('pending')
    expect(rows[0].platform).toBe('fixture_a')
    expect(JSON.parse(rows[0].payloadJson)).toEqual(expect.objectContaining({
      messageId: 500,
      appid: 42,
      date: '2026-09-24T10:00:00.000Z',
      title: 'hello',
      priority: 5
    }))
  })
})

describe('enqueueForUserDevices 原子闸门（入口检查通过后闸门暂停，最终不得插入）', () => {
  test("闸门='paused@d3'（模拟入口检查通过后才设置的部署闸门暂停）→ count=0、outboxIds=[]、库中零行", async () => {
    const testDb = createTestDb()
    const service = new PushOutboxService(asDrizzle(testDb))
    seedClient(testDb, { deviceUid: 'gate-device-a' })
    seedClient(testDb, { deviceUid: 'gate-device-b' })

    seedGate(testDb, 'paused@d3')

    const result = await service.enqueueForUserDevices(makeInput(600))

    expect(result.count).toBe(0)
    expect(result.outboxIds).toEqual([])
    expect(allOutboxRows(testDb)).toHaveLength(0)
  })

  test("闸门=裸 'paused'（手工/未知来源暂停，LIKE 'paused%' 前缀语法）→ 同样拒绝插入", async () => {
    const testDb = createTestDb()
    const service = new PushOutboxService(asDrizzle(testDb))
    seedClient(testDb, { deviceUid: 'gate-device-c' })
    seedGate(testDb, 'paused')

    const result = await service.enqueueForUserDevices(makeInput(601))

    expect(result.count).toBe(0)
    expect(result.outboxIds).toEqual([])
    expect(allOutboxRows(testDb)).toHaveLength(0)
  })

  test("闸门='open'（显式开闸行）→ 正常插入（行不存在的放行路径由上方幂等用例隐含覆盖）", async () => {
    const testDb = createTestDb()
    const service = new PushOutboxService(asDrizzle(testDb))
    seedClient(testDb, { deviceUid: 'gate-device-d' })
    seedGate(testDb, 'open')

    const result = await service.enqueueForUserDevices(makeInput(602))

    expect(result.count).toBe(1)
    expect(result.outboxIds).toHaveLength(1)
    expect(allOutboxRows(testDb)).toHaveLength(1)
  })
})
