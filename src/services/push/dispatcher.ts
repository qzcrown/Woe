import { PushOutboxService } from "./outboxService.ts";
import { ProviderResolver } from "./contracts.ts";
import { processClaimedJob } from "./sendPipeline.ts";

interface DispatcherOptions {
  batchSize?: number;
}


const MAX_BATCHES_PER_RUN = 10;

export class PushDispatcher {
  private batchSize: number;

  constructor(
    private outboxService: Pick<
      PushOutboxService,
      "getDueJobs" | "markProcessing" | "getPushTargetByClientId" | "markSuccess" | "scheduleRetry" | "markDead" | "suspend" | "invalidateClient"
    >,
    private providers: ProviderResolver,
    options: DispatcherOptions = {}
  ) {
    this.batchSize = options.batchSize ?? 50;
  }


  async runOnce(): Promise<void> {
    for (let batchIndex = 0; batchIndex < MAX_BATCHES_PER_RUN; batchIndex++) {
      const jobs = await this.outboxService.getDueJobs(this.batchSize);

      for (const job of jobs) {



        const lease = await this.outboxService.markProcessing(job.id);
        if (lease === null) continue;


        await processClaimedJob(
          { outbox: this.outboxService, providers: this.providers },
          { ...job, status: "processing", updatedAt: lease }
        );
      }

      if (jobs.length < this.batchSize) break;
    }
  }
}
