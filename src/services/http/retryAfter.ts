






export function parseRetryAfterMs(headerValue: string | null, now: number): number | undefined {
  if (typeof headerValue !== 'string') return undefined

  const trimmed = headerValue.trim()
  if (trimmed === '') return undefined

  if (/^\d+$/.test(trimmed)) {
    const seconds = Number(trimmed)
    if (!Number.isSafeInteger(seconds)) return undefined
    return seconds * 1000
  }


  if (!/[A-Za-z]/.test(trimmed)) return undefined
  const timestamp = Date.parse(trimmed)
  if (Number.isNaN(timestamp)) return undefined

  return Math.max(0, timestamp - now)
}
