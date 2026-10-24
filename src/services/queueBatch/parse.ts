





export function parseJobMessage(body: unknown): { jobId: number } | null {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return null

  const jobId = (body as Record<string, unknown>).jobId
  if (typeof jobId !== 'number' || !Number.isSafeInteger(jobId) || jobId <= 0) return null

  return { jobId }
}
