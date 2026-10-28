















import { PushOutboxJob, PushOutboxService, PushTargetLookup } from "./outboxService.ts";
import {
  DEFAULT_PUSH_DELIVERY_POLICY,
  ProviderSendInput,
  ProviderResolver,
  SUSPEND_RETRY_AT_DELAY_MS
} from "./contracts.ts";









export type SendPipelineResult =
  | { action: "success" | "dead" | "suspend" | "stale" }
  | { action: "retry"; nextRetryAt: string; reason: string };


export interface SendPipelineDeps {
  outbox: Pick<
    PushOutboxService,
    "getPushTargetByClientId" | "markSuccess" | "scheduleRetry" | "markDead" | "suspend"
  > & {
    invalidateClient?: (
      clientId: number,
      reason: string,
      jobId: number,
      attemptCount: number,
      error: string,
      lease: string
    ) => Promise<void>
  };

  providers: ProviderResolver;

  now?: () => number;
}


type OutboxPayload = Omit<ProviderSendInput, "deviceToken"> & { deviceToken?: string };


type ParseFailureReason = "invalid" | "mismatch";

type ParseOutcome = { ok: true; payload: OutboxPayload } | { ok: false; reason: ParseFailureReason };


interface SendTargetSnapshot {
  clientId: number | null;

  legacy: boolean;
  platform: string;
  deviceToken: string;
  tokenUpdatedAt: string | null;
  tokenStatus: string;
}

const INVALID_PAYLOAD_ERROR = "Invalid outbox payload";
const MISMATCH_ERROR = "Invalid outbox payload: job/payload mismatch";
const NO_CLIENT_BINDING_ERROR = "Undeliverable: no client binding";
const TARGET_CHANGED_SUFFIX = "; client target changed during send";








function parseOutboxPayload(job: PushOutboxJob): ParseOutcome {
  let parsed: any;
  try {
    parsed = JSON.parse(job.payloadJson);
  } catch {
    return { ok: false, reason: "invalid" };
  }
  if (
    !parsed ||
    typeof parsed !== "object" ||
    !parsed.message ||
    !parsed.platform ||
    typeof parsed.messageId !== "number" ||
    typeof parsed.appid !== "number" ||
    typeof parsed.date !== "string" ||
    !parsed.date
  ) {
    return { ok: false, reason: "invalid" };
  }
  if (
    parsed.messageId !== job.messageId ||
    parsed.platform !== job.platform ||
    (parsed.userId !== undefined && parsed.userId !== job.userId)
  ) {
    return { ok: false, reason: "mismatch" };
  }
  return { ok: true, payload: parsed };
}


function targetChangedDuringSend(before: SendTargetSnapshot, after: PushTargetLookup): boolean {
  if (after.kind !== "ready") {
    return true;
  }
  return (
    after.platform !== before.platform ||
    after.deviceToken !== before.deviceToken ||
    after.tokenUpdatedAt !== before.tokenUpdatedAt ||
    after.tokenStatus !== before.tokenStatus
  );
}








export async function processClaimedJob(
  depsInput: SendPipelineDeps,
  job: PushOutboxJob & { updatedAt: string }
): Promise<SendPipelineResult> {
  const lease = job.updatedAt;
  const outbox = {
    getPushTargetByClientId: (clientId: number) => depsInput.outbox.getPushTargetByClientId(clientId),
    markSuccess: (id: number) => depsInput.outbox.markSuccess(id, lease),
    scheduleRetry: (id: number, attemptCount: number, nextRetryAt: string, error: string) =>
      depsInput.outbox.scheduleRetry(id, attemptCount, nextRetryAt, error, lease),
    markDead: (id: number, attemptCount: number, error: string) =>
      depsInput.outbox.markDead(id, attemptCount, error, lease),
    suspend: (id: number, nextRetryAt: string, reason: string) =>
      depsInput.outbox.suspend(id, nextRetryAt, reason, lease),
    invalidateClient: depsInput.outbox.invalidateClient
      ? (clientId: number, reason: string, jobId: number, attemptCount: number, error: string) =>
        depsInput.outbox.invalidateClient!(clientId, reason, jobId, attemptCount, error, lease)
      : undefined
  };
  const deps = { ...depsInput, outbox };




  const resolution = deps.providers.resolve(job.platform);
  const policy = resolution.policy ?? DEFAULT_PUSH_DELIVERY_POLICY;
  const maxRetries = policy.maxRetries;
  const retryBackoffMs = policy.retryBackoffMs;
  const now = deps.now ?? Date.now;


  const buildRetryAt = (attemptCount: number): string =>
    new Date(now() + Math.max(retryBackoffMs, 500) * Math.max(attemptCount, 1)).toISOString();

  const buildSuspendRetryAt = (): string => new Date(now() + SUSPEND_RETRY_AT_DELAY_MS).toISOString();


  const deadByParseFailure = async (reason: ParseFailureReason): Promise<SendPipelineResult> => {
    if (reason === "mismatch") {
      await deps.outbox.markDead(job.id, job.attemptCount, MISMATCH_ERROR);
    } else {
      await deps.outbox.markDead(job.id, job.attemptCount + 1, INVALID_PAYLOAD_ERROR);
    }
    return { action: "dead" };
  };


  let payload: OutboxPayload;
  let target: SendTargetSnapshot;

  if (job.clientId == null) {


    const legacyParse = parseOutboxPayload(job);
    if (!legacyParse.ok) {
      return deadByParseFailure(legacyParse.reason);
    }
    if (!legacyParse.payload.deviceToken) {
      await deps.outbox.markDead(job.id, job.attemptCount, NO_CLIENT_BINDING_ERROR);
      return { action: "dead" };
    }
    payload = legacyParse.payload;
    target = {
      clientId: null,
      legacy: true,
      platform: job.platform,
      deviceToken: legacyParse.payload.deviceToken,
      tokenUpdatedAt: null,
      tokenStatus: "legacy"
    };
  } else {
    const lookup = await deps.outbox.getPushTargetByClientId(job.clientId);
    if (lookup.kind === "deleted") {
      await deps.outbox.markDead(job.id, job.attemptCount, "Undeliverable: client deleted");
      return { action: "dead" };
    }
    if (lookup.kind === "inactive") {

      await deps.outbox.markDead(
        job.id,
        job.attemptCount,
        `Suppressed: client push disabled (token_status=${lookup.tokenStatus})`
      );
      return { action: "dead" };
    }
    if (lookup.kind === "no-token") {
      await deps.outbox.markDead(job.id, job.attemptCount, "Undeliverable: no device token");
      return { action: "dead" };
    }
    if (lookup.platform !== job.platform) {

      await deps.outbox.markDead(job.id, job.attemptCount, "Undeliverable: client platform changed");
      return { action: "dead" };
    }
    const parse = parseOutboxPayload(job);
    if (!parse.ok) {
      return deadByParseFailure(parse.reason);
    }
    payload = parse.payload;
    target = {
      clientId: job.clientId,
      legacy: false,
      platform: lookup.platform,

      deviceToken: lookup.deviceToken as string,
      tokenUpdatedAt: lookup.tokenUpdatedAt,
      tokenStatus: lookup.tokenStatus
    };
  }






  if (resolution.status === 'unregistered') {
    await deps.outbox.markDead(
      job.id,
      job.attemptCount,
      `Undeliverable: no provider for platform ${job.platform}`
    );
    return { action: "dead" };
  }
  if (resolution.status !== 'ready') {
    await deps.outbox.suspend(
      job.id,
      buildSuspendRetryAt(),
      `Suspended: no provider for platform ${job.platform}`
    );
    return { action: "suspend" };
  }
  const provider = resolution.provider;


  const result = await provider.send({ ...payload, deviceToken: target.deviceToken });
  if (result.ok) {

    await deps.outbox.markSuccess(job.id);
    return { action: "success" };
  }


  const nextAttempt = job.attemptCount + 1;
  const errorMessage = result.errorMessage || result.errorCode || "Push send failed";


  if (result.failureKind === "suspend") {
    await deps.outbox.suspend(job.id, buildSuspendRetryAt(), `Suspended: ${errorMessage}`);
    return { action: "suspend" };
  }



  if (
    result.failureKind === "invalid-target" &&
    !target.legacy &&
    target.clientId != null &&
    deps.outbox.invalidateClient
  ) {
    const clientId = target.clientId;
    const invalidate = () => deps.outbox.invalidateClient!(
      clientId,
      `Invalid push token: ${errorMessage}`,
      job.id,
      nextAttempt,
      errorMessage
    );


    try {
      await invalidate();
    } catch {
      await invalidate();
    }
    return { action: "dead" };
  }





  const wouldBeDead = !(result.retriable && nextAttempt < maxRetries);
  if (wouldBeDead && !target.legacy && target.clientId != null) {
    try {
      const recheck = await deps.outbox.getPushTargetByClientId(target.clientId);
      if (targetChangedDuringSend(target, recheck)) {
        const reason = `${errorMessage}${TARGET_CHANGED_SUFFIX}`;
        const nextRetryAt = buildRetryAt(nextAttempt);
        const scheduled = await deps.outbox.scheduleRetry(job.id, nextAttempt, nextRetryAt, reason);
        return scheduled ? { action: "retry", nextRetryAt, reason } : { action: "stale" };
      }
    } catch {

    }
  }

  if (!wouldBeDead) {
    const nextRetryAt = buildRetryAt(nextAttempt);
    const scheduled = await deps.outbox.scheduleRetry(job.id, nextAttempt, nextRetryAt, errorMessage);
    return scheduled ? { action: "retry", nextRetryAt, reason: errorMessage } : { action: "stale" };
  }
  await deps.outbox.markDead(job.id, nextAttempt, errorMessage);
  return { action: "dead" };
}
