
import MarkdownIt from 'markdown-it'
import DOMPurify from 'dompurify'

const FENCE_RE = /```/



const MD_PATTERNS: RegExp[] = [
  /^#{1,6}\s/m,
  /\*\*[^*\n]+\*\*/,
  /__[^_\n]+__/,
  /~~[^~\n]+~~/,
  /`[^`\n]+`/,
  FENCE_RE,
  /^>\s/m,
  /^\s*[-*+]\s/m,
  /^\s*\d+\.\s/m,
  /\[[^\]\n]{0,1000}\]\([^)\n]{0,1000}\)/,
  /\|.{0,1000}\|\s*\n\|?[\s:|-]{0,300}\|?/,
  /\$\$[\s\S]+?\$\$|\\\[[\s\S]+?\\\]|\\\([\s\S]+?\\\)/,
  /^---+\s*$/m
]


const MAX_DETECT_LENGTH = 64 * 1024

export function detectMarkdown(content: string): boolean {
  if (!content || content.length > MAX_DETECT_LENGTH) return false
  return MD_PATTERNS.some((re) => re.test(content))
}


export function detectBareJson(content: string): boolean {
  const t = content.trim()
  if (t.length === 0 || t.length > 512 * 1024) return false
  if (!(t.startsWith('{') || t.startsWith('['))) return false
  try {
    const v = JSON.parse(t)
    return typeof v === 'object' && v !== null
  } catch {
    return false
  }
}





export interface MathSegment {
  placeholder: string
  tex: string
  source: string
  displayMode: boolean
}

const MATH_RE =
  /(?<!\\)\$\$([\s\S]+?)\$\$|(?<!\\)\\\[([\s\S]+?)\\\]|(?<!\\)\\\(([\s\S]+?)\\\)/g
const PLACEHOLDER_RE = /WOEMATH(\d+)WOEMATH/g



const CODE_REGION_RE = /```[\s\S]*?```|`[^`\n]+`/g
const CODE_TOKEN_RE = /WOECODE(\d+)WOECODE/g

export function extractMath(src: string): { text: string; segments: MathSegment[] } {
  const segments: MathSegment[] = []
  const codeSpans: string[] = []
  const masked = src.replace(CODE_REGION_RE, (m) => {
    codeSpans.push(m)
    return `WOECODE${codeSpans.length - 1}WOECODE`
  })
  const text = masked
    .replace(MATH_RE, (source, dollar, bracket, paren) => {
      const tex = (dollar ?? bracket ?? paren).trim()
      const placeholder = `WOEMATH${segments.length}WOEMATH`
      segments.push({
        placeholder,
        tex,
        source,
        displayMode: dollar !== undefined || bracket !== undefined
      })
      return placeholder
    })

    .replace(CODE_TOKEN_RE, (_, index) => codeSpans[Number(index)] ?? _)
  return { text, segments }
}


type KatexModule = typeof import('katex')

type HljsModule = (typeof import('highlight.js/lib/common'))['default']

interface RenderModules {
  katex?: KatexModule
  hljs?: HljsModule
}

const modules: RenderModules = {}

export function registerModules(partial: Partial<RenderModules>): void {
  Object.assign(modules, partial)
}

export type ModuleName = 'katex' | 'hljs'


export async function ensureModules(needed: ModuleName[]): Promise<boolean> {
  let fresh = false
  if (needed.includes('katex') && !modules.katex) {
    const [m] = await Promise.all([import('katex'), import('katex/dist/katex.min.css')])
    registerModules({ katex: m as KatexModule })
    fresh = true
  }
  if (needed.includes('hljs') && !modules.hljs) {
    const [m] = await Promise.all([
      import('highlight.js/lib/common'),
      import('../styles/hljs-theme.css')
    ])
    registerModules({ hljs: m.default ?? (m as unknown as HljsModule) })
    fresh = true
  }
  return fresh
}


export async function ensureHljsLoadedForTest(): Promise<void> {
  await ensureModules(['hljs'])
}

export function neededModules(content: string): ModuleName[] {
  const needed: ModuleName[] = []
  if (extractMath(content).segments.length > 0) needed.push('katex')
  if (FENCE_RE.test(content) || detectBareJson(content)) needed.push('hljs')
  return needed
}



export interface ToolbarLabels {
  copy: string
  format: string
}

let toolbarLabels: ToolbarLabels = { copy: 'Copy', format: 'Format' }

export function setToolbarLabels(labels: ToolbarLabels): void {
  toolbarLabels = labels
}

function escapeHtml(s: string): string {
  return md.utils.escapeHtml(s)
}



const iconAttrs = (cls: string): string =>
  `xmlns="http://www.w3.org/2000/svg" class="${cls}" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"`
export const MD_COPY_ICON_SVG = `<svg ${iconAttrs('md-icon-copy')}><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>`
export const MD_CHECK_ICON_SVG = `<svg ${iconAttrs('md-icon-check')}><path d="M20 6 9 17l-5-5"/></svg>`


function isCompressedJson(code: string): boolean {
  if (code.length > 512 * 1024) return false
  try {
    return JSON.stringify(JSON.parse(code), null, 2) !== code.trim()
  } catch {
    return false
  }
}

function highlightInner(code: string, lang: string): string {
  const hls = modules.hljs
  if (hls && lang && hls.getLanguage(lang)) {
    return hls.highlight(code, { language: lang }).value
  }
  return escapeHtml(code)
}


function codeBlockHtml(inner: string, lang: string, allowFormat: boolean): string {
  const langAttr = lang ? ` data-lang="${escapeHtml(lang)}"` : ''
  const langClass = lang ? ` language-${escapeHtml(lang)}` : ''
  const formatBtn = allowFormat
    ? `<button type="button" class="code-btn code-format">${escapeHtml(toolbarLabels.format)}</button>`
    : ''
  const copyButtonHtml = `<button type="button" class="code-btn code-copy" title="${escapeHtml(toolbarLabels.copy)}" aria-label="${escapeHtml(toolbarLabels.copy)}">${MD_COPY_ICON_SVG}</button>`
  return (
    `<pre class="code-block"${langAttr}>` +
    `<span class="code-toolbar">` +
    copyButtonHtml +
    formatBtn +
    `</span>` +
    `<code class="hljs${langClass}">${inner}</code>` +
    `</pre>`
  )
}

export function highlightJsonHtml(pretty: string): string {
  return highlightInner(pretty, 'json')
}


const md = new MarkdownIt({
  html: false,
  breaks: true,
  linkify: true,
  highlight(code, lang) {
    const hls = modules.hljs
    if (!hls) return ''
    const langName = (lang || '').toLowerCase()
    const allowFormat = langName === 'json' && isCompressedJson(code)
    return codeBlockHtml(highlightInner(code, langName), langName, allowFormat)
  }
})

function restoreMath(html: string, segments: MathSegment[]): string {
  return html.replace(PLACEHOLDER_RE, (m, index) => {
    const seg = segments[Number(index)]

    if (!seg) return m
    if (modules.katex) {
      return modules.katex.renderToString(seg.tex, {
        throwOnError: false,
        displayMode: seg.displayMode
      })
    }

    return `<code class="math-raw">${md.utils.escapeHtml(seg.source)}</code>`
  })
}

function sanitizeHtml(html: string): string {
  return DOMPurify.sanitize(html, { USE_PROFILES: { html: true, mathMl: true, svg: true } })
}

export type MessageRender = { mode: 'plain' } | { mode: 'rich'; html: string }


function jsonMaxDepth(s: string): number {
  let depth = 0
  let max = 0
  let inStr = false
  let esc = false
  for (const ch of s) {
    if (inStr) {
      if (esc) esc = false
      else if (ch === '\\') esc = true
      else if (ch === '"') inStr = false
      continue
    }
    if (ch === '"') inStr = true
    else if (ch === '{' || ch === '[') {
      depth++
      if (depth > max) max = depth
    } else if (ch === '}' || ch === ']') depth--
  }
  return max
}

const MAX_JSON_DEPTH = 256

const MAX_JSON_PRETTY_LENGTH = 128 * 1024

export function renderMessage(content: string): MessageRender {
  try {
    if (detectBareJson(content)) {
      const trimmed = content.trim()
      if (jsonMaxDepth(trimmed) > MAX_JSON_DEPTH) return { mode: 'plain' }
      const pretty = JSON.stringify(JSON.parse(trimmed), null, 2)
      if (pretty.length > MAX_JSON_PRETTY_LENGTH) return { mode: 'plain' }
      return { mode: 'rich', html: sanitizeHtml(codeBlockHtml(highlightInner(pretty, 'json'), 'json', false)) }
    }
    if (detectMarkdown(content)) {
      const { text, segments } = extractMath(content)
      const raw = md.render(text)
      return { mode: 'rich', html: sanitizeHtml(restoreMath(raw, segments)) }
    }
    return { mode: 'plain' }
  } catch {

    return { mode: 'plain' }
  }
}
