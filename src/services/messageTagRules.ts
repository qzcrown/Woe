














export const TAG_MAX_COUNT = 10


export const TAG_MAX_CODEPOINTS = 64


export function codepointLength(value: string): number {
  return [...value].length
}


export function normalizeTag(value: string): string {
  return value.trim()
}





export function isValidTag(value: unknown): value is string {
  if (typeof value !== 'string') return false
  const normalized = normalizeTag(value)
  if (normalized.length === 0) return false

  if (normalized.length <= TAG_MAX_CODEPOINTS) return true


  if (normalized.length > TAG_MAX_CODEPOINTS * 2) return false
  return codepointLength(normalized) <= TAG_MAX_CODEPOINTS
}





export function normalizeTagList(values: readonly string[]): string[] {
  const seen = new Set<string>()
  const tags: string[] = []

  for (const value of values) {
    const normalized = typeof value === 'string' ? normalizeTag(value) : ''
    if (!normalized || seen.has(normalized)) continue
    seen.add(normalized)
    tags.push(normalized)
  }

  return tags
}
