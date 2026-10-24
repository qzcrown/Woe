
























const mockCreateUser = jest.fn()

jest.mock('../../src/handlers/userHandlers.ts', () => ({
  UserHandlers: jest.fn().mockImplementation(() => ({
    createUser: mockCreateUser
  }))
}))

import { user } from '../../src/routes/user'
import { Authenticator } from '../../src/middleware/auth'
import { hashPasswordOnce } from '../helpers/passwordHash'
import { createTestDb, asDrizzle, seedClient } from '../helpers/testDb'
import type { TestDb } from '../helpers/testDb'
import { makeD1Sqlite } from '../helpers/d1Sqlite'


const MIXED_CASE_TOKEN = 'CmIxEdCaSeToKeN9'
const BASIC_USER = 'basicuser'
const BASIC_USER_ID = 9
const BASIC_USER_PASSWORD = 'bearer-scheme-pass-3'

const openDbs: TestDb[] = []

interface BearerFixture {
  testDb: TestDb
  drizzle: ReturnType<typeof asDrizzle>
  env: Record<string, unknown>
}


async function makeBearerFixture(): Promise<BearerFixture> {
  const testDb = createTestDb()
  openDbs.push(testDb)

  testDb.sqlite.exec('ALTER TABLE users ADD COLUMN pass text')
  const passHash = await hashPasswordOnce(BASIC_USER_PASSWORD)
  testDb.sqlite
    .prepare('INSERT INTO users (id, name, pass, admin, disabled) VALUES (?, ?, ?, ?, ?)')
    .run(BASIC_USER_ID, BASIC_USER, passHash, 0, 0)
  seedClient(testDb, {
    token: MIXED_CASE_TOKEN,
    userId: BASIC_USER_ID,
    deviceUid: 'device-bearer-scheme-1'
  })
  return { testDb, drizzle: asDrizzle(testDb), env: { DB: makeD1Sqlite(testDb) } }
}

afterEach(() => {
  while (openDbs.length) openDbs.pop()!.sqlite.close()
})








function requestWithRawAuthorization(raw: string, url = 'http://localhost/'): Request {
  return {
    url,
    headers: {
      get: (name: string) => (name.toLowerCase() === 'authorization' ? raw : null)
    }
  } as unknown as Request
}

describe('Authenticator Bearer scheme recognition', () => {
  describe('extractToken：方案名忽略大小写，token 原样返回', () => {
    const auth = new Authenticator({} as any)

    test.each(['Bearer', 'bearer', 'BEARER', 'bEaReR'])(
      '%s 方案 + 同一 token → 提取结果一致且原样',
      (scheme) => {
        const request = new Request('http://localhost', {
          headers: { Authorization: `${scheme} ${MIXED_CASE_TOKEN}` }
        })
        expect((auth as any).extractToken(request)).toBe(MIXED_CASE_TOKEN)
      }
    )

    test('token 值不改大小写、不去内容空白（含前导空格的原样透传）', () => {
      const request = new Request('http://localhost', {
        headers: { Authorization: `bearer  spacedToken` }
      })
      expect((auth as any).extractToken(request)).toBe(' spacedToken')
    })

    test.each([
      ['Bearer ', '空 Bearer（无内容）'],
      ['bearer ', '空 Bearer（小写方案）'],
      ['Bearer', '裸方案（无空格）'],
      ['bearer', '裸方案小写（无空格）'],
      ['Bear', '短头'],
      ['BearerX token', '非 Bearer 方案前缀']
    ])('%s（%s）→ 无有效 token', (header) => {
      const request = new Request('http://localhost', {
        headers: { Authorization: header }
      })
      expect((auth as any).extractToken(request)).toBeNull()

      expect((auth as any).extractToken(requestWithRawAuthorization(header))).toBeNull()
    })

    test.each([
      ['BEARER   ', '  '],
      ['bearer  ', ' ']
    ])('%s（纯空白 token）→ 原样返回非空 token（不 trim 成空后回退）', (header, expected) => {
      expect((auth as any).extractToken(requestWithRawAuthorization(header))).toBe(expected)
    })

    test('空 Bearer 不遮挡 query 通道（无凭据则继续回退）', () => {
      const request = new Request('http://localhost?token=querytoken', {
        headers: { Authorization: 'Bearer ' }
      })
      expect((auth as any).extractToken(request)).toBe('querytoken')

      expect(
        (auth as any).extractToken(
          requestWithRawAuthorization('Bearer ', 'http://localhost?token=querytoken')
        )
      ).toBe('querytoken')
    })

    test('通道优先级保持：X-Gotify-Key 优先于 Bearer 头与 query', () => {
      const request = new Request('http://localhost?token=querytoken', {
        headers: {
          'X-Gotify-Key': 'Aheaderkey',
          Authorization: `bearer ${MIXED_CASE_TOKEN}`
        }
      })
      expect((auth as any).extractToken(request)).toBe('Aheaderkey')
    })

    test('通道优先级保持：Bearer 头优先于 query', () => {
      const request = new Request('http://localhost?token=querytoken', {
        headers: { Authorization: `bearer ${MIXED_CASE_TOKEN}` }
      })
      expect((auth as any).extractToken(request)).toBe(MIXED_CASE_TOKEN)
    })
  })

  describe('hasCredentials：凭据层与提取层分层（空 Bearer = 认证已尝试）', () => {
    const auth = new Authenticator({} as any)

    test.each(['Bearer', 'bearer', 'BEARER'])(
      '格式合法的 %s 方案（token 即使无效）= 显式凭据',
      (scheme) => {
        const request = new Request('http://localhost', {
          headers: { Authorization: `${scheme} not-a-real-token` }
        })
        expect(auth.hasCredentials(request)).toBe(true)
      }
    )

    test.each([
      ['Bearer ', 'token 恰好为空'],
      ['bearer ', 'token 恰好为空（小写方案）'],
      ['BEARER ', 'token 恰好为空（大写方案）'],
      ['bearer    ', '纯空白 token（原样非空）']
    ])('%s（%s）= 凭据存在（认证已尝试 → 注册路径 401，绝不回退匿名）', (header) => {

      expect(auth.hasCredentials(requestWithRawAuthorization(header))).toBe(true)
    })

    test.each([
      ['Bearer', '裸方案（无空格）'],
      ['bearer', '裸方案小写（无空格）'],
      ['Bear', '短头'],
      ['BearerX token', '非 Bearer 方案前缀']
    ])('%s（%s）= 无凭据（未识别为 Bearer 头）', (header) => {
      const request = new Request('http://localhost', {
        headers: { Authorization: header }
      })
      expect(auth.hasCredentials(request)).toBe(false)
    })

    test('Basic 识别保持不变（提权入口不受本项影响）', () => {
      const request = new Request('http://localhost', {
        headers: { Authorization: 'Basic dXNlcjpwYXNz' }
      })
      expect(auth.hasCredentials(request)).toBe(true)
    })
  })

  describe('真实认证一致性（better-sqlite3 真库）', () => {
    test('Bearer/bearer/BEARER/bEaReR + 同一 token → 认证结果完全一致', async () => {
      const fixture = await makeBearerFixture()



      const results = await Promise.all(
        ['Bearer', 'bearer', 'BEARER', 'bEaReR'].map((scheme) => {
          const authenticator = new Authenticator(fixture.drizzle)
          return authenticator.authenticate(
            new Request('http://localhost', {
              headers: { Authorization: `${scheme} ${MIXED_CASE_TOKEN}` }
            })
          )
        })
      )

      for (const result of results) {
        expect(result).toEqual(results[0])
        expect(result).toMatchObject({
          userId: BASIC_USER_ID,
          isAdmin: false,
          tokenType: 'client',
          clientTokenLookup: MIXED_CASE_TOKEN
        })
      }
    })

    test('大小写被改动过的 token 不被认证（token 原样使用，绝不小写化折叠）', async () => {
      const fixture = await makeBearerFixture()
      const authenticator = new Authenticator(fixture.drizzle)

      const result = await authenticator.authenticate(
        new Request('http://localhost', {
          headers: { Authorization: `bearer ${MIXED_CASE_TOKEN.toLowerCase()}` }
        })
      )
      expect(result).toBeNull()
    })

    test('格式合法但无效的 Bearer 凭据不能通过认证', async () => {
      const fixture = await makeBearerFixture()
      const authenticator = new Authenticator(fixture.drizzle)

      const result = await authenticator.authenticate(
        new Request('http://localhost', {
          headers: { Authorization: 'bearer not-a-real-token' }
        })
      )
      expect(result).toBeNull()
    })

    test('纯空白 Bearer token 不能通过认证（原样非空 → 无效凭据，401 语义）', async () => {
      const fixture = await makeBearerFixture()
      const authenticator = new Authenticator(fixture.drizzle)


      const result = await authenticator.authenticate(requestWithRawAuthorization('Bearer    '))
      expect(result).toBeNull()
    })

    test('Basic 提权成功（requireClient 认 Basic 为 client 兼容身份）', async () => {
      const fixture = await makeBearerFixture()
      const authenticator = new Authenticator(fixture.drizzle)

      const result = await authenticator.requireClient(
        new Request('http://localhost', {
          headers: {
            Authorization: `Basic ${btoa(`${BASIC_USER}:${BASIC_USER_PASSWORD}`)}`
          }
        }),
        fixture.env as any
      )

      expect(result).toEqual({
        userId: BASIC_USER_ID,
        isAdmin: false,
        tokenType: 'client'
      })
    })
  })

  describe('注册路径：显式无效/空 Bearer 不得退回匿名（真实路由 + 真实认证链）', () => {
    let currentFixture: BearerFixture

    beforeEach(async () => {
      currentFixture = await makeBearerFixture()
    })


    function stubCreateUserSuccess() {
      mockCreateUser.mockReset()
      mockCreateUser.mockResolvedValue(
        new Response(JSON.stringify({ id: 99, name: 'anon', admin: false }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        })
      )
    }







    function withRawAuthorization(request: Request, raw: string): Request {
      const originalGet = request.headers.get.bind(request.headers)
      request.headers.get = (name: string) =>
        name.toLowerCase() === 'authorization' ? raw : originalGet(name)
      return request
    }

    function postUser(authorization: string, url = 'http://localhost/') {
      const request = withRawAuthorization(
        new Request(url, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization
          },
          body: JSON.stringify({ name: 'anon', pass: 'secret', admin: false })
        }),
        authorization
      )
      return user.fetch(
        request,
        { ...currentFixture.env, REGISTRATION: 'true' } as any,
        {} as any
      )
    }

    test.each([
      ['bearer not-a-real-token', '无效 token（小写方案）'],
      ['bearer ', 'token 恰好为空（小写方案）'],
      ['Bearer ', 'token 恰好为空（大写方案，修复前行为保持）'],
      ['BEARER ', 'token 恰好为空（混合大小写方案）']
    ])('REGISTRATION=true 下 %s → 401 且不创建用户（%s）', async (authorization) => {
      stubCreateUserSuccess()

      const response = await postUser(authorization)

      expect(response.status).toBe(401)
      expect(mockCreateUser).not.toHaveBeenCalled()
    })

    test.each(['Bearer', 'bearer'])(
      'REGISTRATION=true 下裸 %s（无分隔空格）→ 未识别 Bearer 头，匿名创建仍允许（边界钉住）',
      async (authorization) => {
        stubCreateUserSuccess()

        const response = await postUser(authorization)

        expect(response.status).toBe(200)
        expect(mockCreateUser).toHaveBeenCalledTimes(1)
        expect(mockCreateUser).toHaveBeenCalledWith(
          'anon',
          'secret',
          false,
          undefined,
          undefined,
          undefined
        )
      }
    )

    test('空 Bearer + 有效 query token → 仍经 query 认证（通道优先级不变，不走匿名路径）', async () => {
      stubCreateUserSuccess()




      const response = await postUser('Bearer ', `http://localhost/?token=${MIXED_CASE_TOKEN}`)

      expect(response.status).toBe(403)
      expect(mockCreateUser).not.toHaveBeenCalled()
    })
  })
})
