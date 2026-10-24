import { describe, it, expect, vi } from 'vitest'
import { detectMarkdown, detectBareJson } from '@/utils/markdown'

describe('detectMarkdown', () => {
  it.each([
    ['# 标题', 'heading'],
    ['**bold**', 'bold'],
    ['__bold__', 'bold underscore'],
    ['~~del~~', 'strikethrough'],
    ['inline `code`', 'inline code'],
    ["```json\n{}\n```", 'fence'],
    ['> quote', 'blockquote'],
    ['- item', 'list'],
    ['1. first', 'ordered list'],
    ['[link](https://example.com)', 'link'],
    ['|a|b|\n|-|-|', 'table'],
    ['行内公式 \\(x^2\\) 测试', 'inline math'],
    ['块公式 $$x^2$$ 测试', 'block math'],
    ['---', 'hr']
  ])('命中: %s (%s)', (input) => {
    expect(detectMarkdown(input)).toBe(true)
  })

  it.each([
    ['服务器 CPU 达到 90%', 'plain sentence'],
    ['$5 和 $10 促销', 'single dollar'],
    ['a_b_c 和 file_path', 'underscore in words'],
    ['2 * 3 * 4', 'asterisk multiplication'],
    ['hello world', 'plain'],
    ['', 'empty']
  ])('不命中: %s (%s)', (input) => {
    expect(detectMarkdown(input)).toBe(false)
  })

  it('超长内容直接判纯文本（防正则回溯卡顿）', () => {
    expect(detectMarkdown('['.repeat(100_000))).toBe(false)
    expect(detectMarkdown('|a '.repeat(100_000))).toBe(false)
  })

  it('有界量词不改变正常判定', () => {
    expect(detectMarkdown('[链接](https://example.com) 和 |a|b|\n|-|-|')).toBe(true)
  })
})

describe('detectBareJson', () => {
  it.each([
    ['{"a":1}', 'object'],
    ['[1,2,3]', 'array'],
    ['  {"a":1}  ', 'trim'],
    ['{}', 'empty object'],
    ['{"name":"x","items":[1,2]}', 'nested']
  ])('命中: %s (%s)', (input) => {
    expect(detectBareJson(input)).toBe(true)
  })

  it.each([
    ['"just a string"', 'json scalar string'],
    ['42', 'number'],
    ['{"a":', 'broken json'],
    ['{"a":1} 后缀文字', 'json with suffix'],
    ['[1,2] [3]', 'two arrays'],
    ['', 'empty']
  ])('不命中: %s (%s)', (input) => {
    expect(detectBareJson(input)).toBe(false)
  })
})

import { extractMath, renderMessage, ensureModules, neededModules } from '@/utils/markdown'

describe('extractMath', () => {
  it('抽取块级 $$ 公式', () => {
    const { text, segments } = extractMath('前文 $$a_b^2$$ 后文')
    expect(segments).toHaveLength(1)
    expect(segments[0].tex).toBe('a_b^2')
    expect(segments[0].displayMode).toBe(true)
    expect(text).toContain(segments[0].placeholder)
    expect(text).not.toContain('$$')
  })

  it('抽取多个行内 \\(\\) 公式', () => {
    const { segments } = extractMath('\\(x_1\\) 和 \\(x_2\\)')
    expect(segments).toHaveLength(2)
    expect(segments.every((s) => !s.displayMode)).toBe(true)
  })

  it('\\[…] 块级定界符', () => {
    const { segments } = extractMath('\\[E=mc^2\\]')
    expect(segments).toHaveLength(1)
    expect(segments[0].displayMode).toBe(true)
  })

  it('转义 \\$ 与未闭合定界符不抽取', () => {
    expect(extractMath('\\$5 和 \\$6').segments).toHaveLength(0)
    expect(extractMath('未闭合 $$x^2').segments).toHaveLength(0)
  })

  it('代码区域保护：行内码与闭合围栏内的定界符不被抽取', () => {
    const { segments, text } = extractMath('看 `$$x^2$$` 与\n```tex\n$$y$$\n```\n完')
    expect(segments).toHaveLength(0)
    expect(text).toContain('`$$x^2$$`')
    expect(text).toContain('$$y$$')
  })

  it('用户字面占位 token 不被吞掉或变成 undefined', () => {
    expect(extractMath('字面 WOECODE0WOECODE 尾').text).toBe('字面 WOECODE0WOECODE 尾')


    expect(renderMessage('WOEMATH9WOEMATH 尾').mode).toBe('plain')
    const rich = renderMessage('**粗** WOEMATH9WOEMATH 尾')
    expect(rich.mode).toBe('rich')
    if (rich.mode === 'rich') {
      expect(rich.html).toContain('WOEMATH9WOEMATH')
    }
  })
})

describe('neededModules', () => {
  it('公式内容需要 katex', () => {
    expect(neededModules('$$x$$')).toContain('katex')
  })
  it('纯文本不需要任何模块', () => {
    expect(neededModules('普通消息')).toHaveLength(0)
  })
})

describe('renderMessage 数学分支（KaTeX 懒加载升级）', () => {
  it('KaTeX 未就绪时显示原始 TeX 文本', () => {
    const r = renderMessage('质量 $$E=mc^2$$ 公式')
    expect(r.mode).toBe('rich')
    if (r.mode === 'rich') {
      expect(r.html).toContain('E=mc^2')
      expect(r.html).not.toContain('katex')
    }
  })

  it('ensureModules 加载后升级为 KaTeX HTML', async () => {
    const fresh = await ensureModules(neededModules('质量 $$E=mc^2$$ 公式'))
    expect(fresh).toBe(true)
    const r = renderMessage('质量 $$E=mc^2$$ 公式')
    if (r.mode === 'rich') {
      expect(r.html).toContain('katex')
    }
  })

  it('markdown 分支：粗体渲染、原始 HTML 转义', () => {
    const r = renderMessage('**重点** <script>alert(1)</script> 尾部')
    expect(r.mode).toBe('rich')
    if (r.mode === 'rich') {
      expect(r.html).toContain('<strong>重点</strong>')
      expect(r.html).not.toContain('<script>')
    }
  })

  it('javascript: 链接被降级为字面文本（markdown-it 层拦截）', () => {
    const r = renderMessage('[点我](javascript:alert(1)) 并 **加粗**')
    expect(r.mode).toBe('rich')
    if (r.mode === 'rich') {
      expect(r.html).not.toContain('<a ')
      expect(r.html).toContain('[点我](javascript:alert(1))')
    }
  })

  it('正常 https 链接保留 href', () => {
    const r = renderMessage('[官网](https://example.com)')
    expect(r.mode).toBe('rich')
    if (r.mode === 'rich') {
      expect(r.html).toContain('href="https://example.com"')
    }
  })

  it('未命中任何模式回退 plain', () => {
    expect(renderMessage('普通通知文本').mode).toBe('plain')
  })
})

import { ensureHljsLoadedForTest, highlightJsonHtml, setToolbarLabels } from '@/utils/markdown'

describe('renderMessage 代码分支', () => {
  it('裸 JSON 走代码块视图且默认就是美化形态', () => {
    const r = renderMessage('{"a":1,"b":[true,null]}')
    expect(r.mode).toBe('rich')
    if (r.mode === 'rich') {
      expect(r.html).toContain('code-block')
      expect(r.html).toContain('data-lang="json"')
      expect(r.html).toContain('code-copy')
      expect(r.html).not.toContain('code-format')
    }
  })

  it('裸 JSON 分支中 JSON 字符串值里的 HTML 被转义', () => {
    const r = renderMessage('{"x":"<script>alert(1)</script>"}')
    if (r.mode === 'rich') {
      expect(r.html).not.toContain('<script>')
    }
  })

  it('围栏代码块含 hljs 类与工具条，json 压缩块有格式化按钮', async () => {
    await ensureHljsLoadedForTest()
    setToolbarLabels({ copy: 'Copy', format: 'Format' })
    const r = renderMessage('```json\n{"a":1}\n```')
    expect(r.mode).toBe('rich')
    if (r.mode === 'rich') {
      expect(r.html).toContain('hljs')
      expect(r.html).toContain('code-format')
    }
  })

  it('未知语言回退为转义纯文本（无高亮类）', async () => {
    await ensureHljsLoadedForTest()
    const r = renderMessage('```foobar\n<b>text</b>\n```')
    if (r.mode === 'rich') {
      expect(r.html).toContain('&lt;b&gt;text&lt;/b&gt;')
      expect(r.html).not.toContain('hljs-keyword')
    }
  })

  it('highlightJsonHtml 输出高亮 span', () => {
    const html = highlightJsonHtml('{\n  "a": 1\n}')
    expect(html).toContain('hljs')
  })

  it('深嵌套裸 JSON（>256 层）回退纯文本', () => {
    const deep = '['.repeat(300) + '1' + ']'.repeat(300)
    expect(renderMessage(deep).mode).toBe('plain')
  })

  it('浅嵌套裸 JSON 正常渲染', () => {
    const shallow = '['.repeat(50) + '1' + ']'.repeat(50)
    const r = renderMessage(shallow)
    expect(r.mode).toBe('rich')
  })

  it('美化输出超 128KB 回退纯文本', () => {
    const big = JSON.stringify({ k: 'x'.repeat(200 * 1024) })
    expect(renderMessage(big).mode).toBe('plain')
  })
})



describe('未就绪隔离验证', () => {
  it('未加载 hljs 时围栏块退化为默认转义输出且无工具条', async () => {
    vi.resetModules()
    const mod = await import('@/utils/markdown')
    const r = mod.renderMessage('```json\n{"a":1}\n```')
    if (r.mode === 'rich') {
      expect(r.html).not.toContain('code-copy')
      expect(r.html).not.toContain('code-format')
    }
  })
})



it('sanitized toolbar keeps copy SVG and escaped localized names', async () => {
  await ensureHljsLoadedForTest()
  const label = 'Copy " <&>'
  try {
    setToolbarLabels({ copy: label, format: 'Format' })
    const result = renderMessage('```json\n{"a":1}\n```')
    expect(result.mode).toBe('rich')
    if (result.mode !== 'rich') throw new Error('expected rich code block')
    const root = document.createElement('div')
    root.innerHTML = result.html
    const button = root.querySelector<HTMLButtonElement>('button.code-copy')!
    expect(button).not.toBeNull()
    expect(button.type).toBe('button')
    expect(button.title).toBe(label)
    expect(button.getAttribute('aria-label')).toBe(label)
    const icon = button.querySelector('svg.md-icon-copy')!
    expect(icon).not.toBeNull()
    expect(icon.getAttribute('aria-hidden')).toBe('true')
    expect(icon.getAttribute('viewBox')).toBe('0 0 24 24')
    expect(icon.querySelector('path, rect')).not.toBeNull()
    expect(button.textContent).toBe('')
    expect(root.querySelector('button.code-format')?.textContent).toBe('Format')
    expect(root.querySelector('code')?.textContent).toBe('{"a":1}\n')
    expect(root.querySelector('script, img')).toBeNull()
  } finally {
    setToolbarLabels({ copy: 'Copy', format: 'Format' })
  }
})
