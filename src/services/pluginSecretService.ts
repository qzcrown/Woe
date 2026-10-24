

















import { and, eq } from 'drizzle-orm'
import { isMap, isScalar, isSeq, parseDocument, type Document } from 'yaml'
import type { DrizzleDB } from '../drizzle/index.ts'
import { pluginConfigs } from '../models/index.ts'
import type { PluginSecretAccess, PluginTaskDefinition } from '../plugins/jobs/types.ts'


export const SECRET_MASK = '***'


export const SECRET_ENVELOPE_VERSION = 1

const IV_BYTES = 12
const MASTER_KEY_BYTES = 32

export type PluginSecretFailureCode =
  | 'secret-config'
  | 'secret-decrypt-failed'
  | 'secret-reentry-required'
  | 'secret-key-unavailable'


export class PluginSecretError extends Error {
  constructor(readonly code: PluginSecretFailureCode) {
    super(code)
    this.name = 'PluginSecretError'
  }
}

export interface PluginSecretEnv {
  PLUGIN_SECRET_MASTER_KEY?: string
  PLUGIN_SECRET_KEY_VERSION?: string
}

interface SecretEntry {
  path: string
  iv: string
  ciphertext: string
}

export interface SecretEnvelope {
  v: number
  keyVersion: number
  entries: SecretEntry[]
}

export interface SaveConfigInput {
  pluginId: number
  userId: number
  configYaml: string
  encryptedSecret: string | null
  secretFields: readonly string[]
}

export interface SaveConfigResult {
  configYaml: string
  encryptedSecret: string | null
}

export interface MaskConfigInput {
  configYaml: string
  secretFields: readonly string[]
}

export interface ReadSecretInput {
  pluginId: number
  userId: number
  encryptedSecret: string | null
  path: string
}





function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i])
  }
  return btoa(binary)
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes
}

const textEncoder = new TextEncoder()
const textDecoder = new TextDecoder()

function encodeText(value: string): Uint8Array {
  return textEncoder.encode(value)
}

function decodeText(value: ArrayBuffer): string {
  return textDecoder.decode(new Uint8Array(value))
}









export function parseSecretKeyVersion(raw: string | undefined): number | null {
  if (raw === undefined || raw.trim() === '') return 1
  const trimmed = raw.trim()
  if (!/^\d+$/.test(trimmed)) return null
  const version = Number(trimmed)
  return Number.isSafeInteger(version) && version > 0 ? version : null
}

function decodeMasterKey(raw: string | undefined): Uint8Array | null {
  if (!raw) return null
  try {
    const bytes = base64ToBytes(raw)
    return bytes.length === MASTER_KEY_BYTES ? bytes : null
  } catch {
    return null
  }
}

async function importMasterKey(bytes: Uint8Array): Promise<CryptoKey> {
  try {
    return await crypto.subtle.importKey('raw', bytes, { name: 'AES-GCM' }, false, [
      'encrypt',
      'decrypt'
    ])
  } catch {
    throw new PluginSecretError('secret-key-unavailable')
  }
}

function buildAad(pluginId: number, userId: number, keyVersion: number, path: string): Uint8Array {
  return encodeText(`${pluginId}:${userId}:${keyVersion}:${path}`)
}





function isSecretEntry(value: unknown): value is SecretEntry {
  if (!value || typeof value !== 'object') return false
  const entry = value as Record<string, unknown>
  return (
    typeof entry.path === 'string' &&
    entry.path.length > 0 &&
    typeof entry.iv === 'string' &&
    typeof entry.ciphertext === 'string'
  )
}





export function parseSecretEnvelope(raw: string | null | undefined): SecretEnvelope | null {
  if (raw === null || raw === undefined || raw === '') return null

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new PluginSecretError('secret-decrypt-failed')
  }

  if (!parsed || typeof parsed !== 'object') {
    throw new PluginSecretError('secret-decrypt-failed')
  }

  const candidate = parsed as Record<string, unknown>
  if (candidate.v !== SECRET_ENVELOPE_VERSION) {
    throw new PluginSecretError('secret-decrypt-failed')
  }
  if (
    typeof candidate.keyVersion !== 'number' ||
    !Number.isSafeInteger(candidate.keyVersion) ||
    candidate.keyVersion <= 0
  ) {
    throw new PluginSecretError('secret-decrypt-failed')
  }
  if (!Array.isArray(candidate.entries) || !candidate.entries.every(isSecretEntry)) {
    throw new PluginSecretError('secret-decrypt-failed')
  }

  const seen = new Set<string>()
  for (const entry of candidate.entries as SecretEntry[]) {
    if (seen.has(entry.path)) {
      throw new PluginSecretError('secret-decrypt-failed')
    }
    seen.add(entry.path)
  }

  return {
    v: candidate.v,
    keyVersion: candidate.keyVersion,
    entries: candidate.entries as SecretEntry[]
  }
}

function findEntry(envelope: SecretEnvelope | null, path: string): SecretEntry | null {
  if (!envelope) return null
  return envelope.entries.find((entry) => entry.path === path) ?? null
}





function splitSecretPath(path: string): string[] {
  const segments = path.split('.')
  if (segments.some((segment) => segment.length === 0)) {
    throw new PluginSecretError('secret-config')
  }
  return segments
}











function resolveSecretNode(doc: Document.Parsed, path: string, segments: string[]): unknown {
  const node = doc.getIn(segments, true)
  if (node !== undefined) return node


  if (doc.has(path)) throw new PluginSecretError('secret-config')

  for (let i = 1; i < segments.length; i += 1) {
    const prefix = doc.getIn(segments.slice(0, i), true)
    if (prefix === undefined) return undefined
    if (isMap(prefix)) continue

    if (isScalar(prefix) && prefix.value === null) return undefined
    throw new PluginSecretError('secret-config')
  }

  return undefined
}

function parseConfigDocument(configYaml: string): Document.Parsed {
  const doc = parseDocument(configYaml)

  if (doc.errors.length > 0) {
    throw new PluginSecretError('secret-config')
  }
  return doc
}

function serializeConfigDocument(doc: Document.Parsed): string {

  if (doc.contents === null) return ''
  return doc.toString()
}

function normalizeSecretFields(secretFields: readonly string[]): string[] {
  const seen = new Set<string>()
  const normalized: string[] = []


  for (const path of secretFields) {
    if (typeof path !== 'string' || path.length === 0) {
      throw new PluginSecretError('secret-config')
    }

    if (seen.has(path)) {
      throw new PluginSecretError('secret-config')
    }
    seen.add(path)
    normalized.push(path)
  }
  return normalized
}





export class PluginSecretService {
  constructor(private env: PluginSecretEnv = {}) {}


  currentKeyVersion(): number {
    const version = parseSecretKeyVersion(this.env.PLUGIN_SECRET_KEY_VERSION)
    if (version === null) throw new PluginSecretError('secret-key-unavailable')
    return version
  }


  private requireMasterKey(): Uint8Array {
    const bytes = decodeMasterKey(this.env.PLUGIN_SECRET_MASTER_KEY)
    if (!bytes) throw new PluginSecretError('secret-key-unavailable')
    return bytes
  }





  async processConfigForSave(input: SaveConfigInput): Promise<SaveConfigResult> {
    const keyVersion = this.currentKeyVersion()
    const masterKey = this.requireMasterKey()
    const doc = parseConfigDocument(input.configYaml)

    const oldEnvelope = parseSecretEnvelope(input.encryptedSecret)
    const fields = normalizeSecretFields(input.secretFields)

    const entries: SecretEntry[] = []

    for (const path of fields) {
      const segments = splitSecretPath(path)
      const node = resolveSecretNode(doc, path, segments)


      if (node === undefined) continue

      if (isSeq(node) || isMap(node)) {
        throw new PluginSecretError('secret-config')
      }
      if (!isScalar(node)) {
        throw new PluginSecretError('secret-config')
      }

      const value = node.value

      if (value === null || value === '') {
        doc.deleteIn(segments)
        continue
      }
      if (typeof value !== 'string') {
        throw new PluginSecretError('secret-config')
      }

      if (value === SECRET_MASK) {
        const existing = findEntry(oldEnvelope, path)
        if (!existing) throw new PluginSecretError('secret-config')
        if (oldEnvelope!.keyVersion !== keyVersion) {
          throw new PluginSecretError('secret-reentry-required')
        }
        entries.push(existing)
        continue
      }

      const encrypted = await this.encryptValue(
        masterKey,
        keyVersion,
        input.pluginId,
        input.userId,
        path,
        value
      )
      entries.push({ path, ...encrypted })
      doc.setIn(segments, SECRET_MASK)
    }

    const configYaml = serializeConfigDocument(doc)
    const encryptedSecret =
      entries.length === 0
        ? null
        : JSON.stringify({ v: SECRET_ENVELOPE_VERSION, keyVersion, entries })

    return { configYaml, encryptedSecret }
  }





  async maskConfigForRead(input: MaskConfigInput): Promise<string> {
    if (input.configYaml === '') return ''

    const doc = parseConfigDocument(input.configYaml)
    const fields = normalizeSecretFields(input.secretFields)

    for (const path of fields) {
      const segments = splitSecretPath(path)
      const node = resolveSecretNode(doc, path, segments)
      if (node === undefined) continue

      if (isScalar(node) && (node.value === null || node.value === '')) continue
      doc.setIn(segments, SECRET_MASK)
    }

    return serializeConfigDocument(doc)
  }










  async readSecret(input: ReadSecretInput): Promise<string | null> {
    const envelope = parseSecretEnvelope(input.encryptedSecret)
    const entry = findEntry(envelope, input.path)
    if (!entry || !envelope) return null

    const masterKeyBytes = decodeMasterKey(this.env.PLUGIN_SECRET_MASTER_KEY)
    if (!masterKeyBytes) return null

    try {
      return await this.decryptValue(masterKeyBytes, envelope.keyVersion, input, entry)
    } catch (error) {


      if (error instanceof PluginSecretError && error.code === 'secret-key-unavailable') return null
      throw error
    }
  }












  hasSecret(encryptedSecret: string | null, path: string): boolean {
    return findEntry(parseSecretEnvelope(encryptedSecret), path) !== null
  }

  private async encryptValue(
    masterKeyBytes: Uint8Array,
    keyVersion: number,
    pluginId: number,
    userId: number,
    path: string,
    plaintext: string
  ): Promise<{ iv: string; ciphertext: string }> {
    const key = await importMasterKey(masterKeyBytes)
    const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES))

    try {
      const ciphertext = await crypto.subtle.encrypt(
        {
          name: 'AES-GCM',
          iv,
          additionalData: buildAad(pluginId, userId, keyVersion, path)
        },
        key,
        encodeText(plaintext)
      )
      return { iv: bytesToBase64(iv), ciphertext: bytesToBase64(new Uint8Array(ciphertext)) }
    } catch {

      throw new PluginSecretError('secret-key-unavailable')
    }
  }

  private async decryptValue(
    masterKeyBytes: Uint8Array,
    keyVersion: number,
    input: ReadSecretInput,
    entry: SecretEntry
  ): Promise<string> {
    let iv: Uint8Array
    let ciphertext: Uint8Array
    try {
      iv = base64ToBytes(entry.iv)
      ciphertext = base64ToBytes(entry.ciphertext)
    } catch {
      throw new PluginSecretError('secret-decrypt-failed')
    }
    if (iv.length !== IV_BYTES || ciphertext.length === 0) {
      throw new PluginSecretError('secret-decrypt-failed')
    }

    const key = await importMasterKey(masterKeyBytes)
    try {
      const plaintext = await crypto.subtle.decrypt(
        {
          name: 'AES-GCM',
          iv,
          additionalData: buildAad(input.pluginId, input.userId, keyVersion, input.path)
        },
        key,
        ciphertext
      )
      return decodeText(plaintext)
    } catch {
      throw new PluginSecretError('secret-decrypt-failed')
    }
  }
}










export function createPluginSecretAccess(
  drizzle: DrizzleDB,
  env: PluginSecretEnv | undefined,
  userId: number,
  pluginId: number,
  definition: PluginTaskDefinition
): PluginSecretAccess {
  const declared = [...(definition.secretFields ?? [])]
  const allowed = new Set(declared)
  const service = new PluginSecretService(env ?? {})

  const readEnvelope = () =>
    drizzle
      .select({ encryptedSecret: pluginConfigs.encryptedSecret })
      .from(pluginConfigs)
      .where(and(eq(pluginConfigs.id, pluginId), eq(pluginConfigs.userId, userId)))
      .get()

  return {
    async get(path) {
      if (!allowed.has(path)) return null
      const row = await readEnvelope()
      return service.readSecret({
        pluginId,
        userId,
        encryptedSecret: row?.encryptedSecret ?? null,
        path
      })
    },

    async has(path) {
      if (!allowed.has(path)) return false
      const row = await readEnvelope()
      return service.hasSecret(row?.encryptedSecret ?? null, path)
    },

    paths() {





      return declared
    }
  }
}
