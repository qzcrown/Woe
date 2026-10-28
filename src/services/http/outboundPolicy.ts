

















import { maxResponseBytes } from './limits.ts'
import type { OutboundHttp } from '../ai/contracts.ts'
import type { OutboundPolicyOptions } from '../../plugins/jobs/types.ts'





export const MAX_TIMEOUT_MS = 120_000


const NULL_BODY_STATUSES = new Set([101, 103, 204, 205, 304])

export type OutboundUrlRejection =
  | 'invalid'
  | 'insecure'
  | 'userinfo'
  | 'query'
  | 'fragment'
  | 'traversal'
  | 'private-host'

export type OutboundHttpErrorCode =
  | OutboundUrlRejection
  | 'timeout'
  | 'too-large'
  | 'network'
  | 'invalid-timeout'

export type OutboundUrlValidation =
  | { ok: true; url: URL }
  | { ok: false; reason: OutboundUrlRejection }


export class OutboundHttpError extends Error {
  constructor(readonly code: OutboundHttpErrorCode) {
    super(code)
    this.name = 'OutboundHttpError'
  }
}














function rawPath(raw: string): string {
  const normalized = raw.replace(/\\/g, '/')
  const scheme = normalized.indexOf('://')
  if (scheme < 0) return ''

  let rest = normalized.slice(scheme + 3)
  const cut = rest.search(/[?#]/)
  if (cut >= 0) rest = rest.slice(0, cut)

  const slash = rest.indexOf('/')
  return slash < 0 ? '' : rest.slice(slash)
}

function hasTraversalSegment(path: string): boolean {
  return path.split(/[\\/]/).some((segment) => {
    if (segment === '..') return true
    try {
      return decodeURIComponent(segment) === '..'
    } catch {

      return false
    }
  })
}

function parseIpv4(host: string): number[] | null {
  const parts = host.split('.')
  if (parts.length !== 4) return null

  const octets: number[] = []
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null
    const value = Number(part)
    if (value > 255) return null
    octets.push(value)
  }
  return octets
}

function isPrivateIpv4(octets: number[]): boolean {
  const [a, b] = octets
  if (a === 0 || a === 10 || a === 127) return true
  if (a === 169 && b === 254) return true
  if (a === 172 && b >= 16 && b <= 31) return true
  if (a === 192 && b === 168) return true
  if (a === 100 && b >= 64 && b <= 127) return true
  if (a >= 224) return true
  return false
}

function expandEmbeddedIpv4(host: string): string | null {
  const lastColon = host.lastIndexOf(':')
  const last = host.slice(lastColon + 1)
  if (!last.includes('.')) return host

  const octets = parseIpv4(last)
  if (!octets) return null

  const high = ((octets[0] << 8) | octets[1]).toString(16)
  const low = ((octets[2] << 8) | octets[3]).toString(16)
  return `${host.slice(0, lastColon + 1)}${high}:${low}`
}


function parseIpv6(host: string): number[] | null {
  const zone = host.indexOf('%')
  const withoutZone = zone >= 0 ? host.slice(0, zone) : host

  const expanded = expandEmbeddedIpv4(withoutZone)
  if (expanded === null) return null

  const halves = expanded.split('::')
  if (halves.length > 2) return null

  const head = halves[0] === '' ? [] : halves[0].split(':')
  const tail = halves.length === 2 && halves[1] !== '' ? halves[1].split(':') : []

  let groups: string[]
  if (halves.length === 2) {
    const missing = 8 - head.length - tail.length
    if (missing < 0) return null
    groups = [...head, ...Array.from({ length: missing }, () => '0'), ...tail]
  } else {
    groups = head
  }

  if (groups.length !== 8) return null

  const bytes: number[] = []
  for (const group of groups) {
    if (!/^[0-9a-f]{1,4}$/i.test(group)) return null
    const value = parseInt(group, 16)
    bytes.push((value >> 8) & 0xff, value & 0xff)
  }
  return bytes
}

function isPrivateIpv6(bytes: number[]): boolean {

  const allZero = bytes.every((byte) => byte === 0)
  if (allZero) return true
  if (bytes.slice(0, 15).every((byte) => byte === 0) && bytes[15] === 1) return true


  if ((bytes[0] & 0xfe) === 0xfc) return true


  if (bytes[0] === 0xfe && (bytes[1] & 0xc0) === 0x80) return true


  const mappedPrefix = bytes.slice(0, 10).every((byte) => byte === 0)
  if (mappedPrefix && bytes[10] === 0xff && bytes[11] === 0xff) {
    return isPrivateIpv4(bytes.slice(12))
  }

  return false
}

function isPrivateHostname(hostname: string): boolean {
  let host = hostname.toLowerCase()

  if (host.startsWith('[') && host.endsWith(']')) host = host.slice(1, -1)

  if (host.includes(':')) {
    const bytes = parseIpv6(host)

    return bytes === null ? true : isPrivateIpv6(bytes)
  }

  const ipv4 = parseIpv4(host)
  if (ipv4) return isPrivateIpv4(ipv4)

  const name = host.endsWith('.') ? host.slice(0, -1) : host
  return (
    name === 'localhost' ||
    name.endsWith('.localhost') ||
    name.endsWith('.local') ||
    name.endsWith('.internal')
  )
}








export function validateOutboundUrl(
  raw: string,
  policy: OutboundPolicyOptions = {}
): OutboundUrlValidation {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return { ok: false, reason: 'invalid' }
  }

  if (url.protocol !== 'https:' && !(policy.allowHttp === true && url.protocol === 'http:')) {
    return { ok: false, reason: 'insecure' }
  }
  if (url.username !== '' || url.password !== '') return { ok: false, reason: 'userinfo' }
  if (url.search !== '' && policy.allowQuery !== true) return { ok: false, reason: 'query' }
  if (url.hash !== '') return { ok: false, reason: 'fragment' }
  if (hasTraversalSegment(rawPath(raw))) return { ok: false, reason: 'traversal' }
  if (policy.allowPrivateNetwork !== true && isPrivateHostname(url.hostname)) {
    return { ok: false, reason: 'private-host' }
  }

  return { ok: true, url }
}





export interface OutboundRequestInit {
  method: string
  headers?: Record<string, string>
  body?: string
  signal: AbortSignal
  redirect: 'manual'
}

export interface OutboundHttpDeps {

  fetch?: (url: string, init: OutboundRequestInit) => Promise<Response>

  policy?: OutboundPolicyOptions
}

function concatChunks(chunks: Uint8Array[], total: number): Uint8Array {
  const merged = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    merged.set(chunk, offset)
    offset += chunk.byteLength
  }
  return merged
}




async function readBodyBounded(response: Response): Promise<Uint8Array> {
  if (!response.body) return new Uint8Array(0)

  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0

  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      if (!value) continue

      total += value.byteLength
      if (total > maxResponseBytes) {
        try {
          await reader.cancel()
        } catch {

        }
        throw new OutboundHttpError('too-large')
      }
      chunks.push(value)
    }
  } finally {
    try {
      reader.releaseLock()
    } catch {

    }
  }

  return concatChunks(chunks, total)
}

function rebuildResponse(source: Response, bytes: Uint8Array): Response {
  const headers = new Headers(source.headers)

  headers.delete('content-length')
  headers.delete('content-encoding')



  const body = NULL_BODY_STATUSES.has(source.status) ? null : bytes
  return new Response(body, {
    status: source.status,
    statusText: source.statusText,
    headers
  })
}





function resolveTimeoutMs(timeoutMs: number): number {
  if (!Number.isInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > MAX_TIMEOUT_MS) {
    throw new OutboundHttpError('invalid-timeout')
  }
  return timeoutMs
}







export function createOutboundHttp(deps: OutboundHttpDeps = {}): OutboundHttp {
  const fetchImpl = deps.fetch ?? ((url: string, init: OutboundRequestInit) => fetch(url, init))
  const policy = deps.policy ?? {}

  return {
    async fetch(input) {
      const validated = validateOutboundUrl(input.url, policy)
      if (!validated.ok) throw new OutboundHttpError(validated.reason)

      const timeoutMs = resolveTimeoutMs(input.timeoutMs)
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), timeoutMs)

      try {
        let response: Response
        try {
          response = await fetchImpl(validated.url.href, {
            method: input.method ?? 'GET',
            ...(input.headers === undefined ? {} : { headers: input.headers }),
            ...(input.body === undefined ? {} : { body: input.body }),
            signal: controller.signal,
            redirect: 'manual'
          })
        } catch (error) {
          if (error instanceof OutboundHttpError) throw error
          throw new OutboundHttpError(controller.signal.aborted ? 'timeout' : 'network')
        }

        const bytes = await readBodyBounded(response)
        return rebuildResponse(response, bytes)
      } catch (error) {
        if (error instanceof OutboundHttpError) throw error
        throw new OutboundHttpError(controller.signal.aborted ? 'timeout' : 'network')
      } finally {
        clearTimeout(timer)
      }
    }
  }
}
