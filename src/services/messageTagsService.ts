









import { TAG_MAX_COUNT, normalizeTagList } from './messageTagRules.ts'


export { TAG_MAX_COUNT } from './messageTagRules.ts'


export const TAGS_EXTRAS_KEY = 'woe::tags'

export type TagReadResult =
  | { ok: true; tags: string[] }
  | { ok: false; reason: 'invalid-tags' }

export type ExtrasForTagsResult =
  | { ok: true; extras: Record<string, unknown> }
  | { ok: false; reason: 'corrupted' }










export function readExtrasForTags(raw: string | null | undefined): ExtrasForTagsResult {
  if (raw === null || raw === undefined || raw.trim() === '') {
    return { ok: true, extras: {} }
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return { ok: false, reason: 'corrupted' }
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { ok: false, reason: 'corrupted' }
  }
  return { ok: true, extras: parsed as Record<string, unknown> }
}











export function readTags(extras: Record<string, unknown> | undefined): TagReadResult {
  if (!extras) return { ok: true, tags: [] }

  const raw = extras[TAGS_EXTRAS_KEY]
  if (raw === undefined) return { ok: true, tags: [] }
  if (!Array.isArray(raw)) return { ok: false, reason: 'invalid-tags' }
  if (raw.length > TAG_MAX_COUNT) return { ok: false, reason: 'invalid-tags' }
  if (raw.some((tag) => typeof tag !== 'string' || tag.trim() === '')) {
    return { ok: false, reason: 'invalid-tags' }
  }

  return { ok: true, tags: raw as string[] }
}











export type MergeTagsResult =
  | { ok: true; tags: string[]; changed: boolean }
  | { ok: false; reason: 'capacity-exceeded' }








export function mergeTags(existing: string[], incoming: string[]): MergeTagsResult {
  const tags = normalizeTagList([...existing, ...incoming])

  if (tags.length > TAG_MAX_COUNT) {
    return { ok: false, reason: 'capacity-exceeded' }
  }

  const changed =
    tags.length !== existing.length || tags.some((tag, index) => tag !== existing[index])

  return { ok: true, tags, changed }
}
