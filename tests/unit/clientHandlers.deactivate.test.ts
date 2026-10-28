









import { ClientHandlers } from '../../src/handlers/clientHandlers'
import { createTestDb, asDrizzle, seedClient } from '../helpers/testDb'
import { clients, pushOutbox } from '../../src/models'
import { eq } from 'drizzle-orm'

function makeHandlers() {
  const testDb = createTestDb()
  const handlers = new ClientHandlers(asDrizzle(testDb))
  return { testDb, handlers }
}

function seedOutbox(
  testDb: ReturnType<typeof createTestDb>,
  overrides: Partial<typeof pushOutbox.$inferInsert> = {}
): typeof pushOutbox.$inferSelect {
  const base: typeof pushOutbox.$inferInsert = {
    userId: 7,
    messageId: Math.floor(Math.random() * 1e9),
    platform: 'huawei',
    clientId: 11,
    payloadJson: '{"title":"t"}',
    status: 'pending',
    ...overrides
  }
  const [row] = testDb.db.insert(pushOutbox).values(base).returning().all();
  return row;
}

function getClientRow(testDb: ReturnType<typeof createTestDb>, id: number) {
  return testDb.db.select().from(clients).where(eq(clients.id, id)).all()[0]
}

function getOutboxRow(testDb: ReturnType<typeof createTestDb>, id: number) {
  return testDb.db.select().from(pushOutbox).where(eq(pushOutbox.id, id)).all()[0]
}

describe('ClientHandlers deactivateClient', () => {
  test('owner deactivation deactivates the client, kills pending/processing rows, keeps success, and is idempotent', async () => {
    const { testDb, handlers } = makeHandlers()
    const client = seedClient(testDb)
    const pending = seedOutbox(testDb, { clientId: client.id, messageId: 101, status: 'pending' })
    const processing = seedOutbox(testDb, { clientId: client.id, messageId: 102, status: 'processing' })
    const success = seedOutbox(testDb, { clientId: client.id, messageId: 103, status: 'success' })

    const res = await handlers.deactivateClient(7, String(client.id))
    expect(res.status).toBe(200)

    const clientRow = getClientRow(testDb, client.id)
    expect(clientRow.tokenStatus).toBe('inactive')
    expect(clientRow.deviceToken).toBeNull()

    expect(getOutboxRow(testDb, pending.id).status).toBe('dead')
    expect(getOutboxRow(testDb, pending.id).lastError).toBe('Client deactivated')
    expect(getOutboxRow(testDb, processing.id).status).toBe('dead')
    expect(getOutboxRow(testDb, success.id).status).toBe('success')


    const res2 = await handlers.deactivateClient(7, String(client.id))
    expect(res2.status).toBe(200)
    expect(getOutboxRow(testDb, pending.id).status).toBe('dead')
    expect(getOutboxRow(testDb, success.id).status).toBe('success')
  })

  test("deactivating another user's client id leaves the victim client and its outbox untouched", async () => {
    const { testDb, handlers } = makeHandlers()
    const victimClient = seedClient(testDb, { userId: 7 })
    const victimPending = seedOutbox(testDb, { userId: 7, clientId: victimClient.id, messageId: 201, status: 'pending' })
    const victimProcessing = seedOutbox(testDb, { userId: 7, clientId: victimClient.id, messageId: 202, status: 'processing' })


    const res = await handlers.deactivateClient(8, String(victimClient.id))
    expect(res.status).toBe(200)

    const victimRow = getClientRow(testDb, victimClient.id)
    expect(victimRow.tokenStatus).toBe('active')
    expect(victimRow.deviceToken).not.toBeNull()
    expect(getOutboxRow(testDb, victimPending.id).status).toBe('pending')
    expect(getOutboxRow(testDb, victimProcessing.id).status).toBe('processing')
  })
})
