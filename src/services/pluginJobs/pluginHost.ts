














import { and, eq } from 'drizzle-orm'
import type { DrizzleDB } from '../../drizzle/index.ts'
import type { Env } from '../../types/index.ts'
import { applications, messages } from '../../models/index.ts'
import { parseMessageExtras } from '../../utils/messageExtras.ts'
import {
  TAGS_EXTRAS_KEY,
  mergeTags,
  readExtrasForTags,
  readTags
} from '../messageTagsService.ts'
import { createPluginSecretAccess } from '../pluginSecretService.ts'
import { createOutboundHttp } from '../http/outboundPolicy.ts'
import type {
  ApplicationAccess,
  MessageAccess,
  PluginHostContext,
  PluginTaskDefinition,
  TagAccess
} from '../../plugins/jobs/types.ts'


type WriteResult = { meta?: { changes?: number }; changes?: number }

const affectedRows = (r: WriteResult | undefined | null): number =>
  r?.meta?.changes ?? r?.changes ?? 0









function formatMessageDate(raw: string | null | undefined): string {
  if (typeof raw !== 'string') return ''
  const trimmed = raw.trim()
  if (trimmed === '') return ''

  const parsed = parseMessageDate(trimmed)
  return parsed === null ? '' : parsed.toISOString()
}

function parseMessageDate(trimmed: string): Date | null {

  if (/^\d+$/.test(trimmed)) {
    const fromEpoch = new Date(Number(trimmed))
    return Number.isNaN(fromEpoch.getTime()) ? null : fromEpoch
  }


  const hasZone = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(trimmed)
  const normalized = trimmed.includes('T')
    ? hasZone
      ? trimmed
      : `${trimmed}Z`
    : `${trimmed.replace(' ', 'T')}Z`
  const parsed = new Date(normalized)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}


export function createPluginHost(
  drizzle: DrizzleDB,
  env: Env,
  userId: number,
  pluginId: number,
  definition: PluginTaskDefinition
): PluginHostContext {

  const messageScope = (messageId: number) =>
    and(eq(messages.id, messageId), eq(messages.userid, userId))


  const readExtrasRow = (messageId: number) =>
    drizzle.select({ extras: messages.extras }).from(messages).where(messageScope(messageId)).get()

  const messagesAccess: MessageAccess = {
    async getMessage(messageId) {
      const row = await drizzle
        .select({
          id: messages.id,
          appId: messages.appid,
          title: messages.title,
          content: messages.message,
          priority: messages.priority,
          date: messages.date,
          extras: messages.extras
        })
        .from(messages)
        .where(messageScope(messageId))
        .get()

      if (!row) return null

      return {
        id: row.id,
        appId: row.appId,
        date: formatMessageDate(row.date),
        priority: row.priority ?? 0,
        title: row.title ?? undefined,
        content: row.content,
        extras: parseMessageExtras(row.extras) ?? {}
      }
    }
  }

  const applicationsAccess: ApplicationAccess = {
    async getApplication(appId) {

      const row = await drizzle
        .select({ id: applications.id, name: applications.name })
        .from(applications)
        .where(and(eq(applications.id, appId), eq(applications.userId, userId)))
        .get()

      return row ?? null
    }
  }

  const tagsAccess: TagAccess = {
    async getTags(messageId) {
      const row = await readExtrasRow(messageId)

      if (!row) return { ok: false, reason: 'not-found' }

      const parsed = readExtrasForTags(row.extras)
      if (!parsed.ok) return { ok: false, reason: 'invalid-tags' }

      return readTags(parsed.extras)
    },

    async appendTags(messageId, incoming) {
      const row = await readExtrasRow(messageId)

      if (!row) return { status: 'not-found' }

      const parsed = readExtrasForTags(row.extras)
      if (!parsed.ok) return { status: 'corrupted' }

      const existing = readTags(parsed.extras)
      if (!existing.ok) return { status: 'invalid-existing-tags' }

      const merged = mergeTags(existing.tags, incoming)






      if (!merged.ok) {
        throw new Error('plugin tags overflow: appendTags exceeds TAG_MAX_COUNT')
      }
      if (!merged.changed) return { status: 'unchanged', tags: merged.tags }


      const nextExtras = { ...parsed.extras, [TAGS_EXTRAS_KEY]: merged.tags }
      const result = await drizzle
        .update(messages)
        .set({ extras: JSON.stringify(nextExtras) })
        .where(messageScope(messageId))

      if (affectedRows(result as unknown as WriteResult) === 0) {
        return { status: 'not-found' }
      }

      return { status: 'updated', tags: merged.tags }
    }
  }

  return {
    userId,
    pluginId,
    messages: messagesAccess,
    tags: tagsAccess,
    applications: applicationsAccess,
    secrets: createPluginSecretAccess(drizzle, env, userId, pluginId, definition),

    http: createOutboundHttp({ policy: definition.outbound })
  }
}
