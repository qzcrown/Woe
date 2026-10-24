



























import { and, desc, eq, sql } from 'drizzle-orm'
import { parse } from 'yaml'
import type { DrizzleDB } from '../../drizzle/index.ts'
import type { Env } from '../../types/index.ts'
import { messages, pluginConfigs, pluginJobs, users, userPluginPermissions, type PluginJob } from '../../models/index.ts'
import type {
  PluginConfigErrorCode,
  PluginEnqueueErrorCode,
  PluginEventOutcome,
  PluginJobsFactory,
  PluginTaskDefinition
} from '../../plugins/jobs/types.ts'
import { createPluginTaskRegistry } from '../../plugins/jobs/registry.ts'
import { QuotaService, type QuotaCheckResult, type QuotaConsumeResult } from '../quota/quotaService.ts'
import { createPluginHost } from './pluginHost.ts'
import { jobErrorMessage, writeJobLog } from './pluginJobLog.ts'
import { PluginSecretError } from '../pluginSecretService.ts'


export interface PluginJobQueueSender {
  send(body: { jobId: number }): Promise<unknown>
}


export interface QuotaChecker {
  check(namespace: string, userId: number, pluginId: number): Promise<QuotaCheckResult>
  consume(
    namespace: string,
    userId: number,
    pluginId: number,
    quotaConsumed: boolean
  ): Promise<QuotaConsumeResult>
}

export interface PluginJobServiceDeps {
  drizzle: DrizzleDB
  env: Env

  queue?: PluginJobQueueSender

  quota?: QuotaChecker

  now?: () => Date

  definitionResolver?: (modulePath: string) => PluginTaskDefinition | null
}

export type PluginJobEnqueueCode = PluginEnqueueErrorCode | 'not-found'












export const ENQUEUE_HTTP_STATUS = {
  'not-found': 404,
  'plugin-unavailable': 409,
  config: 409,
  'secret-config': 409,
  'secret-decrypt-failed': 409,
  'secret-reentry-required': 409,
  'outbound-blocked': 409,
  'quota-exceeded': 429,
  'quota-read-failed': 503,
  'enqueue-send-failed': 503
} as const satisfies Record<PluginJobEnqueueCode | 'enqueue-send-failed', number>


export type EnqueueHttpStatus = (typeof ENQUEUE_HTTP_STATUS)[keyof typeof ENQUEUE_HTTP_STATUS]

export type PluginJobEnqueueResult =
  | { status: 'ok'; job: PluginJob; httpStatus: 202 }
  | { status: 'skipped'; code: PluginJobEnqueueCode; httpStatus: EnqueueHttpStatus }
  | {
      status: 'error'
      code: 'enqueue-send-failed'
      httpStatus: EnqueueHttpStatus
      job: PluginJob
    }

export interface EnqueueInput {
  userId: number
  pluginId: number
  subjectType: string
  subjectId: number
  payload?: unknown





  source: 'event' | 'manual'
}


export interface SubjectJobsQuery {
  userId: number
  subjectType: string
  subjectId: number

  pluginId?: number

  limit?: number
}






export type PluginJobSummary = Pick<
  PluginJob,
  | 'id'
  | 'pluginId'
  | 'status'
  | 'result'
  | 'lastErrorCode'
  | 'lastErrorMessage'
  | 'createdAt'
  | 'completedAt'
>







export type SubjectJobHistory =
  | { found: false }
  | { found: true; messageDeleted: boolean; jobs: PluginJobSummary[] }


export const SUBJECT_JOBS_DEFAULT_LIMIT = 20
const SUBJECT_JOBS_MAX_LIMIT = 100


const RESEND_AFTER_MS = 5 * 60 * 1000


const PLUGIN_JOB_INSERT_ATTEMPTS = 2







export function safeJsonStringify(value: unknown): string | null {
  if (value === undefined) return null
  try {
    const serialized = JSON.stringify(value)
    return typeof serialized === 'string' ? serialized : null
  } catch {
    return null
  }
}


export function parsePluginConfig(
  configYaml: string | null | undefined
): { ok: true; config: unknown } | { ok: false } {
  if (configYaml === null || configYaml === undefined) return { ok: true, config: undefined }
  try {
    return { ok: true, config: parse(configYaml) }
  } catch {
    return { ok: false }
  }
}

export class PluginJobService {
  private readonly drizzle: DrizzleDB
  private readonly env: Env
  private readonly quota: QuotaChecker
  private readonly now: () => Date
  private readonly resolveDefinition: (modulePath: string) => PluginTaskDefinition | null

  constructor(private readonly deps: PluginJobServiceDeps) {
    this.drizzle = deps.drizzle
    this.env = deps.env
    this.quota = deps.quota ?? new QuotaService(deps.drizzle, deps.env)
    this.now = deps.now ?? (() => new Date())


    this.resolveDefinition = deps.definitionResolver ?? createPluginTaskRegistry(deps.env).resolve
  }

  async enqueue(input: EnqueueInput): Promise<PluginJobEnqueueResult> {
    const { userId, pluginId, subjectType, subjectId } = input
    const drizzle = this.drizzle



    if (!(await this.subjectBelongsToUser(userId, subjectType, subjectId))) {
      return this.skipped('not-found')
    }


    const plugin = await drizzle
      .select({
        id: pluginConfigs.id,
        userId: pluginConfigs.userId,
        modulePath: pluginConfigs.modulePath,
        configYaml: pluginConfigs.configYaml,
        enabled: pluginConfigs.enabled
      })
      .from(pluginConfigs)
      .where(eq(pluginConfigs.id, pluginId))
      .get()

    if (!plugin || plugin.userId !== userId) return this.skipped('not-found')


    if (plugin.enabled !== 1) return this.skipped('plugin-unavailable')



    if (!(await this.hasPluginPermission(userId, plugin.modulePath))) {
      await this.logEnqueueRejected(pluginId, userId, 'plugin-unavailable')
      return this.skipped('plugin-unavailable')
    }


    const definition = this.resolveDefinition(plugin.modulePath)
    if (!definition) return this.skipped('config')
    if (!definition.supportedSubjectTypes.includes(subjectType)) {
      return this.skipped('plugin-unavailable')
    }




    if (input.source === 'manual' && definition.manualTrigger === false) {
      await this.logEnqueueRejected(pluginId, userId, 'plugin-unavailable')
      return this.skipped('plugin-unavailable')
    }


    const existing = await this.findPendingJob(pluginId, subjectType, subjectId)
    if (existing) {
      await this.maybeResend(existing)
      return { status: 'ok', job: existing, httpStatus: 202 }
    }


    if (definition.quotaNamespace) {
      const quota = await this.quota.check(definition.quotaNamespace, userId, pluginId)
      if (quota.status === 'exceeded') {
        await this.logEnqueueRejected(pluginId, userId, 'quota-exceeded')
        return this.skipped('quota-exceeded')
      }

      if (quota.status !== 'ok') {
        await this.logEnqueueRejected(pluginId, userId, 'quota-read-failed')
        return this.skipped('quota-read-failed')
      }
    }


    const parsedConfig = parsePluginConfig(plugin.configYaml)
    if (!parsedConfig.ok) {
      await this.logEnqueueRejected(pluginId, userId, 'config')
      return this.skipped('config')
    }

    const host = createPluginHost(drizzle, this.env, userId, pluginId, definition)

    if (definition.validateConfig) {

      try {
        const failure = await definition.validateConfig({ config: parsedConfig.config, host })
        if (failure) {
          await this.logEnqueueRejected(pluginId, userId, failure.errorCode)
          return this.skipped(failure.errorCode)
        }
      } catch (error) {
        const rejected = await this.rejectSecretError(pluginId, userId, error)
        if (rejected) return rejected
        throw error
      }
    }



    let payload = input.payload
    if (definition.prepareJob) {
      try {
        const prepared = await definition.prepareJob({
          userId,
          pluginId,
          subjectType,
          subjectId,
          config: parsedConfig.config,
          host,
          now: this.now().toISOString()
        })
        if ('error' in prepared) {
          await this.logEnqueueRejected(pluginId, userId, prepared.error.errorCode)
          return this.skipped(prepared.error.errorCode)
        }
        if (prepared.payload !== undefined) payload = prepared.payload
      } catch (error) {
        const rejected = await this.rejectSecretError(pluginId, userId, error)
        if (rejected) return rejected
        throw error
      }
    }



    const serializedPayload = safeJsonStringify(payload)
    if (payload !== undefined && serializedPayload === null) {
      await this.logEnqueueRejected(pluginId, userId, 'config')
      return this.skipped('config')
    }




    let job: PluginJob | undefined
    for (let attempt = 0; attempt < PLUGIN_JOB_INSERT_ATTEMPTS; attempt += 1) {
      try {
        const inserted = await drizzle
          .insert(pluginJobs)
          .values({
            userId,
            pluginId,
            subjectType,
            subjectId,
            status: 'pending',
            payload: serializedPayload
          })
          .returning()
        job = inserted[0]
        break
      } catch (error) {

        if (!isUniqueConstraintError(error)) throw error
        const concurrent = await this.findPendingJob(pluginId, subjectType, subjectId)
        if (concurrent) return { status: 'ok', job: concurrent, httpStatus: 202 }
      }
    }

    if (!job) {



      return this.skipped('plugin-unavailable')
    }


    try {
      const queue = this.queue()
      if (!queue) throw new Error('PLUGIN_JOB_QUEUE binding is missing')
      await queue.send({ jobId: job.id })
      return { status: 'ok', job, httpStatus: 202 }
    } catch {
      const failed = await this.markEnqueueSendFailed(job)
      return {
        status: 'error',
        code: 'enqueue-send-failed',
        httpStatus: ENQUEUE_HTTP_STATUS['enqueue-send-failed'],
        job: failed
      }
    }
  }

  private queue(): PluginJobQueueSender | undefined {
    return this.deps.queue ?? this.deps.env.PLUGIN_JOB_QUEUE
  }








  async listSubjectJobs(query: SubjectJobsQuery): Promise<PluginJobSummary[]> {
    const limit = Math.min(
      Math.max(query.limit ?? SUBJECT_JOBS_DEFAULT_LIMIT, 1),
      SUBJECT_JOBS_MAX_LIMIT
    )

    const filters = [
      eq(pluginJobs.userId, query.userId),
      eq(pluginJobs.subjectType, query.subjectType),
      eq(pluginJobs.subjectId, query.subjectId)
    ]
    if (query.pluginId !== undefined) {
      filters.push(eq(pluginJobs.pluginId, query.pluginId))
    }

    return this.drizzle
      .select({
        id: pluginJobs.id,
        pluginId: pluginJobs.pluginId,
        status: pluginJobs.status,
        result: pluginJobs.result,
        lastErrorCode: pluginJobs.lastErrorCode,
        lastErrorMessage: pluginJobs.lastErrorMessage,
        createdAt: pluginJobs.createdAt,
        completedAt: pluginJobs.completedAt
      })
      .from(pluginJobs)
      .where(and(...filters))
      .orderBy(desc(pluginJobs.createdAt), desc(pluginJobs.id))
      .limit(limit)
      .all()
  }










  async getSubjectJobHistory(query: SubjectJobsQuery): Promise<SubjectJobHistory> {
    const owner = await this.findSubjectOwner(query.subjectType, query.subjectId)

    if (owner !== null && owner !== query.userId) return { found: false }

    if (owner === null) {


      const hasHistory = await this.hasSubjectJobs(
        query.userId,
        query.subjectType,
        query.subjectId
      )
      if (!hasHistory) return { found: false }
    }

    const jobs = await this.listSubjectJobs(query)
    return { found: true, messageDeleted: owner === null, jobs }
  }





  async hasSubjectJobs(userId: number, subjectType: string, subjectId: number): Promise<boolean> {
    const row = await this.drizzle
      .select({ id: pluginJobs.id })
      .from(pluginJobs)
      .where(
        and(
          eq(pluginJobs.userId, userId),
          eq(pluginJobs.subjectType, subjectType),
          eq(pluginJobs.subjectId, subjectId)
        )
      )
      .limit(1)
      .get()

    return Boolean(row)
  }

  private skipped(code: PluginJobEnqueueCode): PluginJobEnqueueResult {
    return { status: 'skipped', code, httpStatus: ENQUEUE_HTTP_STATUS[code] }
  }

  private async findPendingJob(
    pluginId: number,
    subjectType: string,
    subjectId: number
  ): Promise<PluginJob | undefined> {
    return this.drizzle
      .select()
      .from(pluginJobs)
      .where(
        and(
          eq(pluginJobs.pluginId, pluginId),
          eq(pluginJobs.subjectType, subjectType),
          eq(pluginJobs.subjectId, subjectId),
          eq(pluginJobs.status, 'pending')
        )
      )
      .get()
  }





  private async findSubjectOwner(subjectType: string, subjectId: number): Promise<number | null> {
    if (subjectType !== 'message') return null

    const row = await this.drizzle
      .select({ userid: messages.userid })
      .from(messages)
      .where(eq(messages.id, subjectId))
      .get()

    return row?.userid ?? null
  }

  private async subjectBelongsToUser(
    userId: number,
    subjectType: string,
    subjectId: number
  ): Promise<boolean> {
    return (await this.findSubjectOwner(subjectType, subjectId)) === userId
  }


  private async maybeResend(job: PluginJob): Promise<void> {
    const createdAt = parseSqliteTimestamp(job.createdAt)
    if (createdAt === null) return
    if (this.now().getTime() - createdAt.getTime() < RESEND_AFTER_MS) return

    try {
      const queue = this.queue()
      if (!queue) throw new Error('PLUGIN_JOB_QUEUE binding is missing')
      await queue.send({ jobId: job.id })
    } catch {
      console.error(`[Plugin Job] pending resend failed job=${job.id}`)
    }
  }

  private async markEnqueueSendFailed(job: PluginJob): Promise<PluginJob> {

    console.error(
      `[Plugin Job] enqueue send failed job=${job.id} plugin=${job.pluginId} code=enqueue-send-failed`
    )

    await this.drizzle
      .update(pluginJobs)
      .set({
        status: 'failed',
        completedAt: sql`CURRENT_TIMESTAMP`,
        updatedAt: sql`CURRENT_TIMESTAMP`,
        lastErrorCode: 'enqueue-send-failed',
        lastErrorMessage: jobErrorMessage('enqueue-send-failed')
      })
      .where(eq(pluginJobs.id, job.id))

    await writeJobLog(this.drizzle, {
      pluginId: job.pluginId,
      userId: job.userId,
      event: 'plugin_job.failed',
      status: 0,
      error: 'enqueue-send-failed'
    })

    const updated = await this.drizzle
      .select()
      .from(pluginJobs)
      .where(eq(pluginJobs.id, job.id))
      .get()

    return updated ?? job
  }

  private async logEnqueueRejected(
    pluginId: number,
    userId: number,
    code: PluginConfigErrorCode | PluginEnqueueErrorCode
  ): Promise<void> {
    await writeJobLog(this.drizzle, {
      pluginId,
      userId,
      event: 'plugin_job.enqueue_rejected',
      status: 0,
      error: code
    })
  }








  private async rejectSecretError(
    pluginId: number,
    userId: number,
    error: unknown
  ): Promise<PluginJobEnqueueResult | null> {
    if (!(error instanceof PluginSecretError)) return null

    const code: PluginEnqueueErrorCode =
      error.code === 'secret-key-unavailable' ? 'secret-config' : error.code
    await this.logEnqueueRejected(pluginId, userId, code)
    return this.skipped(code)
  }










  private async hasPluginPermission(userId: number, modulePath: string): Promise<boolean> {
    try {
      const user = await this.drizzle
        .select({ admin: users.admin })
        .from(users)
        .where(and(eq(users.id, userId), eq(users.disabled, false)))
        .get()


      if (!user) return false
      if (user.admin) return true

      const permission = await this.drizzle
        .select({ id: userPluginPermissions.id })
        .from(userPluginPermissions)
        .where(
          and(
            eq(userPluginPermissions.userId, userId),
            eq(userPluginPermissions.modulePath, modulePath)
          )
        )
        .get()

      return Boolean(permission)
    } catch {
      return false
    }
  }
}


export function parseSqliteTimestamp(raw: string): Date | null {
  if (!raw) return null
  const parsed = new Date(`${raw.replace(' ', 'T')}Z`)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}


const UNIQUE_ERROR_CAUSE_DEPTH = 5











export function isUniqueConstraintError(error: unknown): boolean {
  let current: unknown = error
  for (let depth = 0; depth < UNIQUE_ERROR_CAUSE_DEPTH; depth += 1) {
    if (isUniqueConstraintFailure(current)) return true
    if (typeof current !== 'object' || current === null) return false
    current = (current as { cause?: unknown }).cause
  }
  return false
}

function isUniqueConstraintFailure(error: unknown): boolean {
  if (typeof error === 'string') return /unique constraint/i.test(error)
  if (typeof error !== 'object' || error === null) return false

  const { message, code, name } = error as { message?: unknown; code?: unknown; name?: unknown }
  if (typeof message === 'string' && /unique constraint/i.test(message)) return true


  if (code === 'SQLITE_CONSTRAINT_UNIQUE') return true

  if (code === 'SQLITE_CONSTRAINT' && typeof message === 'string' && /unique/i.test(message)) {
    return true
  }
  return name === 'SqliteError' && typeof message === 'string' && /unique/i.test(message)
}


export interface PluginJobRuntime {
  service: PluginJobService
  jobsFactory: PluginJobsFactory
}

export function createPluginJobRuntime(deps: PluginJobServiceDeps): PluginJobRuntime {
  const service = new PluginJobService(deps)

  const jobsFactory: PluginJobsFactory = ({ userId, pluginId }) => ({
    async enqueue({ subjectType, subjectId, payload }): Promise<PluginEventOutcome> {


      const result = await service.enqueue({
        userId,
        pluginId,
        subjectType,
        subjectId,
        payload,
        source: 'event'
      })

      if (result.status === 'ok') return { status: 'ok' }





      if (result.status === 'error') return { status: 'ok' }

      return {
        status: 'skipped',

        code: result.code === 'not-found' ? 'plugin-unavailable' : result.code
      }
    }
  })

  return { service, jobsFactory }
}
