import { describe, it, expect, afterEach, vi } from 'vitest'
import { resolveMediaUrl } from '@/utils/mediaUrl'








describe('resolveMediaUrl URL 矩阵(显式基址)', () => {
  it('新契约相对路径 image/... 拼接到基址目录', () => {
    expect(resolveMediaUrl('image/app-images/a', 'https://h.test/api/v1')).toBe(
      'https://h.test/api/v1/image/app-images/a'
    )
  })

  it('旧 /api/v1/image/... 在基址末尾已有 /api/v1 时消除一次重复', () => {
    expect(resolveMediaUrl('/api/v1/image/app-images/a', 'https://h.test/api/v1')).toBe(
      'https://h.test/api/v1/image/app-images/a'
    )
  })

  it('代理子路径 + /api/v1 基址 + 旧路径:保留 /proxy/api/v1', () => {
    expect(resolveMediaUrl('/api/v1/image/app-images/a', 'https://h.test/proxy/api/v1')).toBe(
      'https://h.test/proxy/api/v1/image/app-images/a'
    )
  })

  it('代理子路径基址 + 旧路径:保留旧 API 前缀随部署路径拼接', () => {
    expect(resolveMediaUrl('/api/v1/image/app-images/a', 'https://h.test/proxy')).toBe(
      'https://h.test/proxy/api/v1/image/app-images/a'
    )
  })

  it('基址尾斜杠不改变任何结果', () => {
    expect(resolveMediaUrl('image/app-images/a', 'https://h.test/api/v1/')).toBe(
      'https://h.test/api/v1/image/app-images/a'
    )
    expect(resolveMediaUrl('/api/v1/image/app-images/a', 'https://h.test/api/v1/')).toBe(
      'https://h.test/api/v1/image/app-images/a'
    )
    expect(resolveMediaUrl('/api/v1/image/app-images/a', 'https://h.test/proxy/')).toBe(
      'https://h.test/proxy/api/v1/image/app-images/a'
    )
    expect(resolveMediaUrl('/api/v1/image/app-images/a', 'https://h.test/proxy/api/v1/')).toBe(
      'https://h.test/proxy/api/v1/image/app-images/a'
    )
  })

  it('新契约 static/defaultapp.png 相对服务基址解析', () => {
    expect(resolveMediaUrl('static/defaultapp.png', 'https://h.test/api/v1')).toBe(
      'https://h.test/api/v1/static/defaultapp.png'
    )
  })

  it('历史服务相对 /image/... 按基址目录解析', () => {
    expect(resolveMediaUrl('/image/avatars/u1.png', 'https://h.test/api/v1')).toBe(
      'https://h.test/api/v1/image/avatars/u1.png'
    )
    expect(resolveMediaUrl('/image/avatars/u1.png', 'https://h.test/proxy')).toBe(
      'https://h.test/proxy/image/avatars/u1.png'
    )
  })

  it('协议相对 URL(//host/...)原样通过,不拼接基址', () => {
    expect(resolveMediaUrl('//cdn.example.com/image/app-images/a', 'https://h.test')).toBe(
      '//cdn.example.com/image/app-images/a'
    )
    expect(resolveMediaUrl('//cdn.example.com/static/x.png', 'https://h.test/api/v1')).toBe(
      '//cdn.example.com/static/x.png'
    )
  })

  it('旧 static 形态(默认图)经基址解析:legacy 前缀消重与部署路径保留', () => {
    expect(resolveMediaUrl('/api/v1/static/defaultapp.png', 'https://h.test/api/v1')).toBe(
      'https://h.test/api/v1/static/defaultapp.png'
    )
    expect(resolveMediaUrl('/static/defaultapp.png', 'https://h.test/proxy')).toBe(
      'https://h.test/proxy/static/defaultapp.png'
    )
    expect(resolveMediaUrl('/api/v1/static/defaultapp.png', 'https://h.test/proxy')).toBe(
      'https://h.test/proxy/api/v1/static/defaultapp.png'
    )
  })

  it('已完整包含当前部署路径的根相对地址不重复追加', () => {
    expect(resolveMediaUrl('/proxy/api/v1/image/app-images/a', 'https://h.test/proxy')).toBe(
      'https://h.test/proxy/api/v1/image/app-images/a'
    )
    expect(
      resolveMediaUrl('/proxy/api/v1/image/app-images/a', 'https://h.test/proxy/api/v1')
    ).toBe('https://h.test/proxy/api/v1/image/app-images/a')
  })
})

describe('resolveMediaUrl 空值与透传', () => {
  it('空/空白值返回空字符串', () => {
    expect(resolveMediaUrl(null, 'https://h.test/api/v1')).toBe('')
    expect(resolveMediaUrl(undefined, 'https://h.test/api/v1')).toBe('')
    expect(resolveMediaUrl('', 'https://h.test/api/v1')).toBe('')
    expect(resolveMediaUrl('   ', 'https://h.test/api/v1')).toBe('')
  })

  it('完整 http(s) URL 原样通过(含路径中带 /api/v1 的外部 URL,不做字符串替换)', () => {
    expect(
      resolveMediaUrl('https://cdn.example.com/api/v1/logo.png', 'https://h.test/api/v1')
    ).toBe('https://cdn.example.com/api/v1/logo.png')
    expect(resolveMediaUrl('http://cdn.example.com/x.png', 'https://h.test/api/v1')).toBe(
      'http://cdn.example.com/x.png'
    )
  })

  it('data URL 原样通过,不拼接基址', () => {
    expect(resolveMediaUrl('data:image/png;base64,AAAA', 'https://h.test/api/v1')).toBe(
      'data:image/png;base64,AAAA'
    )
  })

  it('只识别媒体路径:非媒体相对值原样返回', () => {
    expect(resolveMediaUrl('favicon.ico', 'https://h.test/api/v1')).toBe('favicon.ico')
    expect(resolveMediaUrl('/assets/logo.png', 'https://h.test/api/v1')).toBe('/assets/logo.png')
  })
})

describe('resolveMediaUrl 缺省基址(VITE_API_BASE_URL)', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('缺省基址读取 VITE_API_BASE_URL(与 services/api.ts 同语义)', () => {
    vi.stubEnv('VITE_API_BASE_URL', 'https://h.test/api/v1')
    expect(resolveMediaUrl('image/app-images/a')).toBe('https://h.test/api/v1/image/app-images/a')
    expect(resolveMediaUrl('/api/v1/image/app-images/a')).toBe(
      'https://h.test/api/v1/image/app-images/a'
    )
  })

  it('未配置时基址为 \'/\',以站点 origin 解析(旧根相对值保持现状)', () => {

    expect(resolveMediaUrl('/api/v1/image/app-images/a')).toBe(
      'http://localhost:3000/api/v1/image/app-images/a'
    )
    expect(resolveMediaUrl('image/app-images/a')).toBe('http://localhost:3000/image/app-images/a')
  })
})
