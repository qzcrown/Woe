











import { ed25519 } from '@noble/curves/ed25519.js'

const ENHANCED_TOKEN_PREFIX = 'gtfy'
const SEED_SIZE = 32

const BASE64URL_CHARS = /^[A-Za-z0-9-_]*$/


export function base64UrlEncode(bytes: Uint8Array): string {
  let binary = ''
  for (const b of bytes) {
    binary += String.fromCharCode(b)
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}





export function base64UrlDecode(input: string): Uint8Array | null {
  if (!BASE64URL_CHARS.test(input) || input.length % 4 === 1) return null
  const base64 = input.replace(/-/g, '+').replace(/_/g, '/')
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4)
  try {
    const binary = atob(padded)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i)
    }
    return bytes
  } catch {
    return null
  }
}








export function isEnhancedTokenForm(token: unknown): boolean {
  return typeof token === 'string' && token.startsWith(ENHANCED_TOKEN_PREFIX)
}








export function derivePublicForm(privateForm: unknown): string | null {

  if (typeof privateForm !== 'string' || !isEnhancedTokenForm(privateForm)) return null
  const fields = privateForm.slice(ENHANCED_TOKEN_PREFIX.length).split('.')
  if (fields.length !== 2) return null
  const [ident, seedB64] = fields
  const seed = base64UrlDecode(seedB64)
  if (seed === null || seed.length !== SEED_SIZE) return null
  try {
    const publicKey = ed25519.getPublicKey(seed)
    return `${ENHANCED_TOKEN_PREFIX}${ident}.${base64UrlEncode(publicKey)}`
  } catch {
    return null
  }
}
