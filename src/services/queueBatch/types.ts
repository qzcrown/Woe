








export interface QueueMessageLike<T = unknown> {
  readonly id?: string
  readonly body: T

  readonly attempts?: number
  ack(): void
  retry(options?: { delaySeconds?: number }): void
}


export interface QueueBatchLike<T = unknown> {
  readonly queue: string
  readonly messages: readonly QueueMessageLike<T>[]
  ackAll(): void
  retryAll(): void
}


export type QueueHandlerDecision = 'ack' | { retry: { delaySeconds?: number } }

export type QueueMessageHandler<T = unknown> = (
  message: QueueMessageLike<T>
) => Promise<QueueHandlerDecision>

export interface QueueDispatchDeps {

  label?: string
}
