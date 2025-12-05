export interface YamlObject {
  [key: string]: any
}

export function parseYaml(yaml: string | null | undefined): YamlObject | undefined {
  if (!yaml || !yaml.trim()) return undefined
  const obj: YamlObject = {}
  const lines = yaml.split(/\r?\n/)
  for (const raw of lines) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const idx = line.indexOf(':')
    if (idx === -1) continue
    const key = line.substring(0, idx).trim()
    let value = line.substring(idx + 1).trim()
    if (value === '') value = ''
    // basic type parsing
    if (value.toLowerCase() === 'true') obj[key] = true
    else if (value.toLowerCase() === 'false') obj[key] = false
    else if (!isNaN(Number(value))) obj[key] = Number(value)
    else obj[key] = value
  }
  return obj
}

export function stringifyYaml(obj: YamlObject | undefined): string {
  if (!obj) return ''
  const parts: string[] = []
  for (const [k, v] of Object.entries(obj)) {
    parts.push(`${k}: ${formatValue(v)}`)
  }
  return parts.join('\n') + (parts.length ? '\n' : '')
}

function formatValue(v: any): string {
  if (typeof v === 'string') return v
  if (typeof v === 'number') return String(v)
  if (typeof v === 'boolean') return v ? 'true' : 'false'
  return JSON.stringify(v)
}

