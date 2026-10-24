








import { eq, sql } from 'drizzle-orm'
import type { DrizzleDB } from '../../drizzle/index.ts'
import type { Env } from '../../types/index.ts'
import { pluginConfigs, pluginJobs, users, type PluginJob } from '../../models/index.ts'
import type {
  PluginTaskDefinition,
  PluginTaskFailure,
  PluginTaskResult
} from '../../plugins/jobs/types.ts'
import { createPluginTaskRegistry } from '../../plugins/jobs/registry.ts'
import { QuotaService } from '../quota/quotaService.ts'
import { dispatchQueueBatch } from '../queueBatch/dispatch.ts'
import { parseJobMessage } from '../queueBatch/parse.ts'
import type { QueueBatchLike, QueueHandlerDecision } from '../queueBatch/types.ts'
import { createPluginHost } from './pluginHost.ts'
import { jobErrorMessage, writeJobLog } from './pluginJobLog.ts'
import { decideRetry } from './pluginRetryPolicy.ts'
import { parsePluginConfig, safeJsonStringify, type QuotaChecker } from './pluginJobService.ts'

export type { QuotaChecker } from './pluginJobService.ts'

export interface PluginJobConsumerDeps {
  drizzle: DrizzleDB
  env: Env

  quota?: QuotaChecker

  definitionResolver?: (modulePath: string) => PluginTaskDefinition | null

  timeoutMs?: number
}

const DEFAULT_TIMEOUT_MS = 20_000

export class PluginJobQueueConsumer {
  private readonly drizzle: DrizzleDB
  private readonly env: Env
  private readonly quota: QuotaChecker
  private readonly timeoutMs: number
  private readonly resolveDefinition: (modulePath: string) => PluginTaskDefinition | null

  constructor(private readonly deps: PluginJobConsumerDeps) {
    this.drizzle = deps.drizzle
    this.env = deps.env
    this.quota = deps.quota ?? new QuotaService(deps.drizzle, deps.env)
    this.timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS


    this.resolveDefinition =
      deps.definitionResolver ?? createPluginTaskRegistry(deps.env).resolve
  }





  async consume(batch: QueueBatchLike<unknown>): Promise<void> {
    await dispatchQueueBatch(batch, (message) => this.handleMessage(message.body, message.attempts))
  }

  private async handleMessage(body: unknown, attempts: number | undefined): Promise<QueueHandlerDecision> {

    const parsed = parseJobMessage(body)
    if (!parsed) {
      console.error('[Plugin Job Queue] malformed message')
      return 'ack'
    }


    const job = await this.drizzle
      .select()
      .from(pluginJobs)
      .where(eq(pluginJobs.id, parsed.jobId))
      .get()

    if (!job) return 'ack'
    if (job.status !== 'pending') return 'ack'


    const plugin = await this.drizzle
      .select({
        id: pluginConfigs.id,
        userId: pluginConfigs.userId,
        modulePath: pluginConfigs.modulePath,
        configYaml: pluginConfigs.configYaml,
        enabled: pluginConfigs.enabled
      })
      .from(pluginConfigs)
      .where(eq(pluginConfigs.id, job.pluginId))
      .get()

    if (!plugin || plugin.userId !== job.userId) {
      return this.failJob(job, 'plugin-unavailable')
    }
    if (plugin.enabled !== 1) {
      return this.failJob(job, 'plugin-unavailable')
    }

    const user = await this.drizzle
      .select({ disabled: users.disabled })
      .from(users)
      .where(eq(users.id, job.userId))
      .get()

    if (!user || user.disabled) return this.failJob(job, 'plugin-unavailable')


    const definition = this.resolveDefinition(plugin.modulePath)
    if (!definition) return this.failJob(job, 'config')
    if (!definition.supportedSubjectTypes.includes(job.subjectType)) {
      return this.failJob(job, 'plugin-unavailable')
    }


    if (definition.quotaNamespace) {
      const quota = await this.quota.check(definition.quotaNamespace, job.userId, job.pluginId)
      if (quota.status === 'read-failed' || quota.status === 'invalid-limit') {
        return this.failJob(job, 'quota-read-failed')
      }
      if (quota.status === 'exceeded') {
        await this.markStatus(job.id, 'failed', {
          lastErrorCode: 'limit-exceeded',
          lastErrorMessage: jobErrorMessage('limit-exceeded')
        })

        await writeJobLog(this.drizzle, {
          pluginId: job.pluginId,
          userId: job.userId,
          event: 'plugin_job.quota_rejected',
          status: 0,
          error: 'limit-exceeded'
        })
        return 'ack'
      }
    }


    const attempt = normalizeAttempt(attempts)
    const result = await this.runTask(job, plugin, definition, attempt)


    if (definition.quotaNamespace && result.quotaConsumed !== false) {
      await this.consumeUsage(definition.quotaNamespace, job)
    }

    if (result.ok) {


      await this.markStatus(job.id, 'success', {
        result: serializeResult(job.id, result.result),
        lastErrorCode: null,
        lastErrorMessage: null
      })
      return 'ack'
    }

    const decision = decideRetry({ failure: result.failure, attempt })

    if (decision.action === 'retry') {

      await this.markStatus(job.id, 'pending', {
        lastErrorCode: result.failure.errorCode,
        lastErrorMessage: jobErrorMessage(result.failure.errorCode)
      })
      console.log(
        `[Plugin Job] retry scheduled job=${job.id} code=${result.failure.errorCode} attempt=${attempt}`
      )
      return { retry: { delaySeconds: decision.delaySeconds } }
    }

    if (decision.action === 'dead') {
      await this.markStatus(job.id, 'dead', {
        lastErrorCode: result.failure.errorCode,
        lastErrorMessage: jobErrorMessage(result.failure.errorCode)
      })
      await writeJobLog(this.drizzle, {
        pluginId: job.pluginId,
        userId: job.userId,
        event: 'plugin_job.dead',
        status: 0,
        error: result.failure.errorCode
      })
      return 'ack'
    }

    return this.failJob(job, result.failure.errorCode)
  }

  private async runTask(
    job: PluginJob,
    plugin: { configYaml: string | null },
    definition: PluginTaskDefinition,
    attempt: number
  ): Promise<PluginTaskResult> {
    const parsedConfig = parsePluginConfig(plugin.configYaml)
    if (!parsedConfig.ok) {
      return { ok: false, failure: { errorCode: 'config', retriable: false } }
    }

    try {
      const host = createPluginHost(
        this.drizzle,
        this.env,
        job.userId,
        job.pluginId,
        definition
      )
      const task = await definition.createTask({
        config: parsedConfig.config,
        job: {
          jobId: job.id,
          userId: job.userId,
          pluginId: job.pluginId,
          subjectType: job.subjectType,
          subjectId: job.subjectId,
          payload: parsePayload(job.payload)
        },
        host
      })
      return await task.run({ attempt, timeoutMs: this.timeoutMs })
    } catch {

      console.error(`[Plugin Job] task threw job=${job.id} plugin=${job.pluginId} code=internal`)

      return {
        ok: false,
        failure: { errorCode: 'internal', retriable: false },
        quotaConsumed: true
      }
    }
  }

  private async consumeUsage(namespace: string, job: PluginJob): Promise<void> {
    try {
      const outcome = await this.quota.consume(namespace, job.userId, job.pluginId, true)
      if (outcome.status === 'write-failed') {
        console.error(`[Plugin Job] usage write failed job=${job.id}`)
      }
    } catch {
      console.error(`[Plugin Job] usage write failed job=${job.id}`)
    }
  }


  private async failJob(job: PluginJob, code: PluginTaskFailure['errorCode']): Promise<'ack'> {
    await this.markStatus(job.id, 'failed', {
      lastErrorCode: code,
      lastErrorMessage: jobErrorMessage(code)
    })
    await writeJobLog(this.drizzle, {
      pluginId: job.pluginId,
      userId: job.userId,
      event: 'plugin_job.failed',
      status: 0,
      error: code
    })
    return 'ack'
  }








  private async markStatus(
    jobId: number,
    status: 'pending' | 'success' | 'failed' | 'dead',
    fields: {
      result?: string | null
      lastErrorCode?: string | null
      lastErrorMessage?: string | null
    }
  ): Promise<void> {
    const isTerminal = status !== 'pending'

    await this.drizzle
      .update(pluginJobs)
      .set({
        ...(isTerminal ? { status } : {}),
        ...(fields.result !== undefined ? { result: fields.result } : {}),
        ...(fields.lastErrorCode !== undefined ? { lastErrorCode: fields.lastErrorCode } : {}),
        ...(fields.lastErrorMessage !== undefined
          ? { lastErrorMessage: fields.lastErrorMessage }
          : {}),
        ...(isTerminal
          ? { completedAt: sql`CURRENT_TIMESTAMP`, updatedAt: sql`CURRENT_TIMESTAMP` }
          : { updatedAt: sql`CURRENT_TIMESTAMP` })
      })
      .where(eq(pluginJobs.id, jobId))
  }
}

function normalizeAttempt(attempts: number | undefined): number {
  if (typeof attempts !== 'number' || !Number.isFinite(attempts)) return 1
  return Math.max(1, Math.trunc(attempts))
}





function serializeResult(jobId: number, result: unknown): string | null {
  if (result === undefined) return null
  const serialized = safeJsonStringify(result)
  if (serialized === null) {
    console.error(`[Plugin Job] result serialization failed job=${jobId}`)
  }
  return serialized
}

function parsePayload(payload: string | null): unknown {
  if (payload === null || payload === '') return null
  try {
    return JSON.parse(payload)
  } catch {
    return null
  }
}


export async function consumePluginJobQueueBatch(
  batch: QueueBatchLike<unknown>,
  deps: PluginJobConsumerDeps
): Promise<void> {
  await new PluginJobQueueConsumer(deps).consume(batch)
}
