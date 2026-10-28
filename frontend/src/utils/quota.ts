






export function canManageQuotas(user: { admin?: boolean } | null | undefined): boolean {
  return user?.admin === true
}


export function isQuotaDisabled(effectiveLimit: number): boolean {
  return effectiveLimit === 0
}


export type QuotaLimitInput =
  | { status: 'empty' }
  | { status: 'invalid' }
  | { status: 'ok'; limit: number }


export function parseQuotaLimitInput(raw: string): QuotaLimitInput {
  const trimmed = raw.trim()
  if (trimmed === '') return { status: 'empty' }
  const value = Number(trimmed)


  if (!Number.isSafeInteger(value) || value < 0) return { status: 'invalid' }
  return { status: 'ok', limit: value }
}
