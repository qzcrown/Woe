
export const MESSAGE_TAGS_EXTRAS_KEY = 'woe::tags'







export function extractMessageTags(extras?: Record<string, unknown> | null): string[] {
  const raw = extras?.[MESSAGE_TAGS_EXTRAS_KEY]
  if (!Array.isArray(raw)) return []
  if (!raw.every(tag => typeof tag === 'string' && tag.trim() !== '')) return []
  return [...raw]
}
