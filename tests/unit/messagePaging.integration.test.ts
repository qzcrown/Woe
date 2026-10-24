















const mockAuthenticateBasic = jest.fn();
const mockAuthenticate = jest.fn();

jest.mock('../../src/middleware/auth.ts', () => ({
  Authenticator: jest.fn().mockImplementation(() => ({
    authenticateBasic: mockAuthenticateBasic,
    authenticate: mockAuthenticate,
  })),
  SESSION_NOT_ELEVATED_MESSAGE: 'session not elevated',
}));




jest.mock('../../src/handlers/applicationHandlers.ts', () => ({
  ApplicationHandlers: jest.fn().mockImplementation(() => ({
    getAllApplications: jest.fn(),
    createApplication: jest.fn(),
    getApplication: jest.fn(),
    updateApplication: jest.fn(),
    deleteApplication: jest.fn(),
    uploadApplicationImage: jest.fn(),
    deleteApplicationImage: jest.fn(),
  })),
}));

import { message } from '../../src/routes/message';
import { application } from '../../src/routes/application';
import { createMessageTestDb } from '../helpers/messageTestDb';
import { makeD1Sqlite } from '../helpers/d1Sqlite';
import { applications, messages } from '../../src/models';
import type { TestDb } from '../helpers/testDb';
import type { D1Database } from '@cloudflare/workers-types';
import { makeExecutionCtxStub, type ExecutionCtxStub } from '../helpers/executionContext';

const CURRENT_USER = 1;
const OTHER_USER = 2;
const CURRENT_APP = 1;
const OTHER_APP = 2;

const CURRENT_USER_MESSAGE_COUNT = 205;

const OTHER_USER_MESSAGE_COUNT = 29;
const TOTAL_ROWS = CURRENT_USER_MESSAGE_COUNT + OTHER_USER_MESSAGE_COUNT;

interface PagedBody {
  paging: { size: number; limit: number; since: number; next?: string };
  messages: Array<{ id: number; appid: number }>;
}

interface Fixture {
  testDb: TestDb;
  env: Record<string, unknown>;
  executionCtx: ExecutionCtxStub;

  fetchMessage: (query: string) => Promise<Response>;
  fetchApplicationMessage: (appId: number, query: string) => Promise<Response>;
  statementCount: () => number;
}


function makeFixture(): Fixture {
  const testDb = createMessageTestDb();
  testDb.db
    .insert(applications)
    .values([
      { id: CURRENT_APP, userId: CURRENT_USER, token: 'Aapp-token-user1', name: 'App One' },
      { id: OTHER_APP, userId: OTHER_USER, token: 'Aapp-token-user2', name: 'App Two' },
    ])
    .run();

  const rows = Array.from({ length: TOTAL_ROWS }, (_, index) => {
    const rowNumber = index + 1;
    const isOtherUser = rowNumber % 8 === 0;
    return {
      userid: isOtherUser ? OTHER_USER : CURRENT_USER,
      appid: isOtherUser ? OTHER_APP : CURRENT_APP,
      message: `m-${rowNumber}`,
      title: null,
      priority: 0,
      extras: null,
    };
  });
  testDb.db.insert(messages).values(rows).run();


  const base = makeD1Sqlite(testDb);
  let statements = 0;
  const countingDb = {
    prepare: (sql: string) => {
      statements += 1;
      return base.prepare(sql);
    },
    batch: base.batch.bind(base),
  } as unknown as D1Database;

  const executionCtx = makeExecutionCtxStub();
  const makeRequest = (path: string) =>
    new Request(`http://localhost${path}`, {
      method: 'GET',
      headers: { 'x-gotify-key': 'Cclient-token' },
    });

  return {
    testDb,
    env: { DB: countingDb },
    executionCtx,
    fetchMessage: async (query: string) =>
      message.fetch(makeRequest(`/${query}`), { DB: countingDb }, executionCtx),
    fetchApplicationMessage: async (appId: number, query: string) =>
      application.fetch(
        makeRequest(`/${appId}/message${query}`),
        { DB: countingDb },
        executionCtx
      ),
    statementCount: () => statements,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockAuthenticateBasic.mockResolvedValue(null);
  mockAuthenticate.mockResolvedValue({ userId: CURRENT_USER, tokenType: 'client' });
});

async function readBody(response: Response): Promise<PagedBody> {
  return (await response.json()) as PagedBody;
}


function expectOwnedDescending(ids: number[]) {
  const sorted = [...ids].sort((a, b) => b - a);
  expect(ids).toEqual(sorted);
  for (const id of ids) {
    expect(id % 8).not.toBe(0);
  }
}

describe('消息列表分页真库验收（205 条当前用户消息）', () => {
  test('缺省页只返回 100 条（limit+1 探测 next，ID 降序，属主过滤保持）', async () => {
    const fx = makeFixture();

    const response = await fx.fetchMessage('?');
    const body = await readBody(response);

    expect(response.status).toBe(200);
    expect(body.messages).toHaveLength(100);
    expectOwnedDescending(body.messages.map((m) => m.id));
    expect(body.paging).toMatchObject({ size: 100, limit: 100 });
    expect(body.paging.next).toBe(`/message?limit=100&since=${body.messages[99].id}`);
  });

  test('limit=200 只返回 200 条（不返回 205 条）', async () => {
    const fx = makeFixture();

    const response = await fx.fetchMessage('?limit=200');
    const body = await readBody(response);

    expect(response.status).toBe(200);
    expect(body.messages).toHaveLength(200);
    expectOwnedDescending(body.messages.map((m) => m.id));
    expect(body.paging).toMatchObject({ size: 200, limit: 200 });
    expect(body.paging.next).toBe(`/message?limit=200&since=${body.messages[199].id}`);
  });

  test.each([
    '?limit=abc',
    '?limit=1.5',
    '?limit=10abc',
    '?limit=0',
    '?limit=201',
    '?limit=',
    '?since=abc',
    '?since=-1',
  ])('%s => 400 且零 SQL 语句（不读取 205 条）', async (query) => {
    const fx = makeFixture();
    const before = fx.statementCount();

    const response = await fx.fetchMessage(query);

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: 'Bad Request',
      errorCode: 400,
    });
    expect(fx.statementCount()).toBe(before);
  });

  test('合法 since 续页：不重复第一页且 ID 降序延续', async () => {
    const fx = makeFixture();

    const first = await readBody(await fx.fetchMessage('?'));
    expect(first.messages).toHaveLength(100);

    const cursor = first.messages[99].id;
    const second = await readBody(await fx.fetchMessage(`?since=${cursor}`));

    expect(second.messages).toHaveLength(100);
    expectOwnedDescending(second.messages.map((m) => m.id));

    const firstIds = new Set(first.messages.map((m) => m.id));
    for (const m of second.messages) {
      expect(m.id).toBeLessThan(cursor);
      expect(firstIds.has(m.id)).toBe(false);
    }
    expect(second.paging.since).toBe(second.messages[99].id);
    expect(second.paging.next).toBe(`/message?limit=100&since=${second.messages[99].id}`);
  });

  test('当前用户 205 条：limit=200 + since 续页可走完且全程不越权', async () => {
    const fx = makeFixture();
    const seen = new Set<number>();

    let cursor: number | undefined;
    let pages = 0;
    do {
      const page = await readBody(await fx.fetchMessage(cursor ? `?limit=200&since=${cursor}` : '?limit=200'));
      expectOwnedDescending(page.messages.map((m) => m.id));
      for (const m of page.messages) {
        expect(seen.has(m.id)).toBe(false);
        seen.add(m.id);
      }
      cursor = page.messages[page.messages.length - 1]?.id;
      pages += 1;
      if (!page.paging.next) break;
    } while (pages < 5);

    expect(seen.size).toBe(CURRENT_USER_MESSAGE_COUNT);
    expect(pages).toBe(2);
  });

  describe('GET /application/:id/message（同一解析器）', () => {
    test('缺省页 100 条且只含该应用消息；limit=200 只 200 条', async () => {
      const fx = makeFixture();

      const defaultPage = await readBody(await fx.fetchApplicationMessage(CURRENT_APP, '?'));
      expect(defaultPage.messages).toHaveLength(100);
      expectOwnedDescending(defaultPage.messages.map((m) => m.id));
      for (const m of defaultPage.messages) {
        expect(m.appid).toBe(CURRENT_APP);
      }
      expect(defaultPage.paging.next).toMatch(/^\/application\/1\/message\?limit=100&since=\d+$/);

      const full = await readBody(await fx.fetchApplicationMessage(CURRENT_APP, '?limit=200'));
      expect(full.messages).toHaveLength(200);
      expect(full.paging.next).toMatch(/^\/application\/1\/message\?limit=200&since=\d+$/);
    });

    test('非法 limit => 400 且零 SQL 语句', async () => {
      const fx = makeFixture();
      const before = fx.statementCount();

      const response = await fx.fetchApplicationMessage(CURRENT_APP, '?limit=abc');

      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toMatchObject({
        error: 'Bad Request',
        errorCode: 400,
      });
      expect(fx.statementCount()).toBe(before);
    });

    test('其他用户的应用：属主过滤保持现状，不泄露其消息', async () => {
      const fx = makeFixture();

      const response = await fx.fetchApplicationMessage(OTHER_APP, '?limit=200');
      const body = await readBody(response);

      expect(response.status).toBe(200);
      expect(body.messages).toHaveLength(0);
      expect(body.paging.next).toBeUndefined();
    });
  });
});










const P3_LISTS = [
  {
    name: 'GET /message',
    fetchPage: (fx: Fixture, query: string) => fx.fetchMessage(query),
    nextPath: (limit: number, since: number) => `/message?limit=${limit}&since=${since}`,
  },
  {
    name: 'GET /application/:id/message',
    fetchPage: (fx: Fixture, query: string) => fx.fetchApplicationMessage(CURRENT_APP, query),
    nextPath: (limit: number, since: number) =>
      `/application/${CURRENT_APP}/message?limit=${limit}&since=${since}`,
  },
];

describe.each(P3_LISTS)('末页 paging.since（%s，真库）', ({ fetchPage, nextPath }) => {
  test('(a) 少于 limit 的末页 => since=0 且无 next', async () => {
    const fx = makeFixture();

    const body = await readBody(await fetchPage(fx, '?limit=200&since=30'));

    expect(body.messages).toHaveLength(26);
    expect(body.paging).toMatchObject({ size: 26, limit: 200, since: 0 });
    expect(body.paging.next).toBeUndefined();
  });

  test('(b) 恰好 limit 行但无下一页 => since=0 且无 next（满末页）', async () => {
    const fx = makeFixture();

    const body = await readBody(await fetchPage(fx, '?limit=100&since=115'));

    expect(body.messages).toHaveLength(100);
    expect(body.messages[99].id).toBe(1);
    expect(body.paging).toMatchObject({ size: 100, limit: 100, since: 0 });
    expect(body.paging.next).toBeUndefined();
  });

  test('(c) 存在下一页 => since=末条 ID 且 next 为相对路径', async () => {
    const fx = makeFixture();

    const body = await readBody(await fetchPage(fx, '?limit=100'));

    expect(body.messages).toHaveLength(100);
    expect(body.paging).toMatchObject({ size: 100, limit: 100, since: body.messages[99].id });
    expect(body.paging.next).toBe(nextPath(100, body.messages[99].id));
  });

  test('(d) 空页且请求 since 非零 => since=0 且无 next（不回显请求 since）', async () => {
    const fx = makeFixture();

    const body = await readBody(await fetchPage(fx, '?since=1'));

    expect(body.messages).toHaveLength(0);
    expect(body.paging).toMatchObject({ size: 0, limit: 100, since: 0 });
    expect(body.paging.next).toBeUndefined();
  });
});

describe('真实续页走完（无重复 + 满末页不生成 next）', () => {
  test.each(P3_LISTS)('%s：limit=41 走完 205 条（41×5 恰好整除），末页 since=0 无 next', async ({ fetchPage }) => {
    const fx = makeFixture();
    const seen = new Set<number>();
    let cursor: number | undefined;
    let pages = 0;
    let lastPage: PagedBody | undefined;

    do {
      const page = await readBody(
        await fetchPage(fx, cursor ? `?limit=41&since=${cursor}` : '?limit=41')
      );
      pages += 1;
      lastPage = page;

      expect(page.messages).toHaveLength(Math.min(41, CURRENT_USER_MESSAGE_COUNT - seen.size));
      expectOwnedDescending(page.messages.map((m) => m.id));
      for (const m of page.messages) {
        expect(seen.has(m.id)).toBe(false);
        seen.add(m.id);
      }
      cursor = page.messages[page.messages.length - 1].id;
      if (!page.paging.next) break;
    } while (pages < 10);

    expect(pages).toBe(5);
    expect(seen.size).toBe(CURRENT_USER_MESSAGE_COUNT);
    expect(lastPage!.paging).toMatchObject({ size: 41, limit: 41, since: 0 });
    expect(lastPage!.paging.next).toBeUndefined();
  });
});
