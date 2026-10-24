import { PushOutboxJob, PushTargetLookup } from './outboxService.ts';
import { publishOutboxJobs } from './queuePublisher.ts';
import { parsePushQueueMessage, PushQueueMessage } from './queueContract.ts';
import { ProviderResolver } from './contracts.ts';
import { processClaimedJob } from './sendPipeline.ts';









interface QueueConsumerDeps {
  outbox: {
    getJobById(id: number): Promise<PushOutboxJob | null>;
    markProcessing(id: number): Promise<boolean>;
    getPushTargetByClientId(clientId: number): Promise<PushTargetLookup>;
    markSuccess(id: number): Promise<void>;
    scheduleRetry(id: number, attemptCount: number, nextRetryAt: string, error: string): Promise<void>;
    markDead(id: number, attemptCount: number, error: string): Promise<void>;
    suspend(id: number, nextRetryAt: string, reason: string): Promise<void>;
    invalidateClient?(clientId: number, reason: string): Promise<void>;
  };
  providers: ProviderResolver;
  queue: Pick<Queue<PushQueueMessage>, 'sendBatch'>;
}








export async function consumePushQueueBatch(batch: MessageBatch<unknown>, deps: QueueConsumerDeps): Promise<void> {
  for (const msg of batch.messages) {
    let parsed: PushQueueMessage;
    try {
      parsed = parsePushQueueMessage(msg.body);
    } catch {

      msg.ack();
      continue;
    }

    try {
      const job = await deps.outbox.getJobById(parsed.outboxId);
      if (!job) {

        msg.ack();
        continue;
      }


      const locked = await deps.outbox.markProcessing(job.id);
      if (!locked) {

        msg.ack();
        continue;
      }

      const result = await processClaimedJob(
        { outbox: deps.outbox, providers: deps.providers },
        job
      );

      if (result.action !== 'retry') {

        msg.ack();
        continue;
      }




      const delayMs = Math.max(0, Date.parse(result.nextRetryAt) - Date.now());
      const delaySeconds = Math.max(1, Math.ceil(delayMs / 1000));
      try {
        await publishOutboxJobs(deps.queue, [job.id], {
          traceId: parsed.traceId,
          attempt: parsed.attempt + 1,
          delaySeconds
        });
        msg.ack();
      } catch (publishError) {
        console.error('Queue consumer failed to republish delayed retry message', publishError);
        msg.retry();
      }
    } catch (error) {

      console.error('Queue consumer failed to process message', error);
      msg.retry();
    }
  }
}
