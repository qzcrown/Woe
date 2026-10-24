





import { dispatchQueueBatch } from '../../src/services/queueBatch/dispatch.ts'
import type { QueueBatchLike, QueueMessageLike } from '../../src/services/queueBatch/types.ts'

const QUEUE = 'woe-plugin-jobs'

function createMessage<T>(body: T): QueueMessageLike<T> {
  return { body, attempts: 1, ack: jest.fn(), retry: jest.fn() }
}

function createBatch<T>(messages: QueueMessageLike<T>[], queue = QUEUE): QueueBatchLike<T> {
  return { queue, messages, ackAll: jest.fn(), retryAll: jest.fn() }
}

afterEach(() => {
  jest.restoreAllMocks()
})

test("handler returning 'ack' acks the message", async () => {
  const message = createMessage('a')
  const handler = jest.fn().mockResolvedValue('ack')

  await dispatchQueueBatch(createBatch([message]), handler)

  expect(message.ack).toHaveBeenCalledTimes(1)
  expect(message.retry).not.toHaveBeenCalled()
})

test('handler retry decision passes delaySeconds through', async () => {
  const message = createMessage('a')
  const handler = jest.fn().mockResolvedValue({ retry: { delaySeconds: 3 } })

  await dispatchQueueBatch(createBatch([message]), handler)

  expect(message.retry).toHaveBeenCalledWith({ delaySeconds: 3 })
  expect(message.ack).not.toHaveBeenCalled()
})

test('a throwing handler logs the deps.label, retries, and the batch keeps going', async () => {
  const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
  const failed = createMessage('boom')
  const next = createMessage('ok')
  const handler = jest
    .fn()
    .mockRejectedValueOnce(new Error('boom'))
    .mockResolvedValueOnce('ack')

  await dispatchQueueBatch(createBatch([failed, next]), handler, { label: 'plugin-job-test' })

  expect(handler).toHaveBeenCalledTimes(2)
  expect(errorSpy).toHaveBeenCalledTimes(1)
  expect(errorSpy.mock.calls[0][0]).toContain('plugin-job-test')

  expect(String(errorSpy.mock.calls[0][0])).not.toContain('boom')
  expect(failed.retry).toHaveBeenCalledTimes(1)
  expect(failed.ack).not.toHaveBeenCalled()
  expect(next.ack).toHaveBeenCalledTimes(1)
})

test('without deps.label the batch queue is used as the log label', async () => {
  const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
  const message = createMessage('boom')
  const handler = jest.fn().mockRejectedValue(new Error('kaboom'))

  await dispatchQueueBatch(createBatch([message]), handler)

  expect(errorSpy.mock.calls[0][0]).toContain(QUEUE)
  expect(String(errorSpy.mock.calls[0][0])).not.toContain('kaboom')
  expect(message.retry).toHaveBeenCalledTimes(1)
})
