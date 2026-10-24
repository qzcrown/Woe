









import type {
  QueueBatchLike,
  QueueDispatchDeps,
  QueueHandlerDecision,
  QueueMessageHandler
} from './types.ts'

export async function dispatchQueueBatch<T = unknown>(
  batch: QueueBatchLike<T>,
  handler: QueueMessageHandler<T>,
  deps: QueueDispatchDeps = {}
): Promise<void> {
  const label = deps.label ?? batch.queue

  for (const message of batch.messages) {
    let decision: QueueHandlerDecision
    try {
      decision = await handler(message)
    } catch {

      console.error(`[Queue Batch] message handling failed queue=${label}`)
      message.retry()
      continue
    }

    if (decision === 'ack') {
      message.ack()
    } else {
      message.retry(decision.retry)
    }
  }
}
