












import { base64UrlDecode, derivePublicForm, isEnhancedTokenForm } from './enhancedToken'

export type AppTokenState =
  | { kind: 'legacy'; token: string }
  | { kind: 'valid'; token: string }
  | { kind: 'invalid' }
  | { kind: 'unknown' }

const ENHANCED_TOKEN_PREFIX = 'gtfy'
const KEY_SIZE = 32


interface EnhancedKeyParts {
  ident: string
  keyBytes: Uint8Array
}





function parseEnhancedKeyParts(token: string): EnhancedKeyParts | null {
  if (!isEnhancedTokenForm(token)) return null
  const fields = token.slice(ENHANCED_TOKEN_PREFIX.length).split('.')
  if (fields.length !== 2) return null
  const keyBytes = base64UrlDecode(fields[1])
  if (keyBytes === null || keyBytes.length !== KEY_SIZE) return null
  return { ident: fields[0], keyBytes }
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false
  }
  return true
}













export function resolveAppTokenState(serverToken: unknown, localToken: unknown): AppTokenState {

  if (typeof serverToken !== 'string') return { kind: 'unknown' }
  if (serverToken.trim().length === 0) return { kind: 'unknown' }


  if (isEnhancedTokenForm(serverToken)) {
    const serverParts = parseEnhancedKeyParts(serverToken)
    if (serverParts === null) return { kind: 'unknown' }
    return resolveLocalAgainstServer(serverParts, localToken)
  }

  return { kind: 'legacy', token: serverToken }
}

function resolveLocalAgainstServer(serverParts: EnhancedKeyParts, localToken: unknown): AppTokenState {

  if (typeof localToken !== 'string') return { kind: 'unknown' }
  if (localToken.trim().length === 0) return { kind: 'unknown' }


  const derivedForm = derivePublicForm(localToken)
  if (derivedForm === null) return { kind: 'invalid' }
  const derivedParts = parseEnhancedKeyParts(derivedForm)
  if (derivedParts === null) return { kind: 'invalid' }


  if (
    derivedParts.ident === serverParts.ident &&
    bytesEqual(derivedParts.keyBytes, serverParts.keyBytes)
  ) {
    return { kind: 'valid', token: localToken }
  }

  return { kind: 'invalid' }
}
