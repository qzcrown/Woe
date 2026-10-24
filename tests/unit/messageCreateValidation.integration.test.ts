


















const mockRequireApp = jest.fn();
const mockRequireClient = jest.fn();
const mockAuthenticateBasic = jest.fn();
const mockAuthenticate = jest.fn();

jest.mock('../../src/middleware/auth.ts', () => ({
  Authenticator: jest.fn().mockImplementation(() => ({
    requireApp: mockRequireApp,
    requireClient: mockRequireClient,
    authenticateBasic: mockAuthenticateBasic,
    authenticate: mockAuthenticate,
  })),
  SESSION_NOT_ELEVATED_MESSAGE: 'session not elevated',
}));

import { message } from '../../src/routes/message';
import { createMessageTestDb } from '../helpers/messageTestDb';
import { makeExecutionCtxStub, type ExecutionCtxStub } from '../helpers/executionContext';
import { makeD1Sqlite } from '../helpers/d1Sqlite';
import { applications } from '../../src/models';
import type { TestDb } from '../helpers/testDb';


const APP_NAME = 'Backup Monitor';
const APP_DEFAULT_PRIORITY = 5;

interface Fixture {
  testDb: TestDb;
  env: Record<string, unknown>;

  executionCtx: ExecutionCtxStub;

  broadcastFetch: jest.Mock;

  sendBatch: jest.Mock;
  postJson: (body: unknown) => Promise<Response>;
  postRawJson: (rawBody: string) => Promise<Response>;
  postForm: (fields: Record<string, string>) => Promise<Response>;
  messageCount: () => number;
  outboxCount: () => number;
  firstMessageRow: () => Record<string, any>;
}


function makeFixture(): Fixture {
  const testDb = createMessageTestDb();
  testDb.db
    .insert(applications)
    .values([
      { id: 1, userId: 1, token: 'Aapp-token-1', name: APP_NAME, defaultPriority: APP_DEFAULT_PRIORITY },
      { id: 2, userId: 1, token: 'Aapp-token-2', name: 'Second App', defaultPriority: 2 },
      { id: 3, userId: 2, token: 'Aapp-token-3', name: 'Other User App', defaultPriority: 1 },
    ])
    .run();


  const broadcastFetch = jest.fn().mockResolvedValue(new Response(null, { status: 200 }));
  const streamNamespace = {
    idFromName: (name: string) => ({ name }),
    get: () => ({ fetch: broadcastFetch }),
  };
  const sendBatch = jest.fn().mockResolvedValue(undefined);

  const env = {
    DB: makeD1Sqlite(testDb),
    MESSAGE_STREAM_HUB: streamNamespace,
    PUSH_QUEUE: { sendBatch },
  };
  const executionCtx = makeExecutionCtxStub();

  const makeRequest = (body: string, contentType: string) =>
    new Request('http://localhost/', {
      method: 'POST',
      headers: { 'content-type': contentType, 'x-gotify-key': 'Aignored-auth-mocked' },
      body,
    });

  return {
    testDb,
    env,
    executionCtx,
    broadcastFetch,
    sendBatch,
    postJson: async (body: unknown) =>
      message.fetch(makeRequest(JSON.stringify(body), 'application/json'), env, executionCtx),
    postRawJson: async (rawBody: string) =>
      message.fetch(makeRequest(rawBody, 'application/json'), env, executionCtx),
    postForm: async (fields: Record<string, string>) =>
      message.fetch(
        makeRequest(new URLSearchParams(fields).toString(), 'application/x-www-form-urlencoded'),
        env,
        executionCtx
      ),
    messageCount: () =>
      (testDb.sqlite.prepare('SELECT COUNT(*) AS c FROM messages').get() as { c: number }).c,
    outboxCount: () =>
      (testDb.sqlite.prepare('SELECT COUNT(*) AS c FROM push_outbox').get() as { c: number }).c,
    firstMessageRow: () =>
      testDb.sqlite
        .prepare('SELECT * FROM messages ORDER BY id LIMIT 1')
        .get() as Record<string, any>,
  };
}

beforeEach(() => {
  jest.clearAllMocks();


  mockRequireApp.mockResolvedValue({ userId: 1, resourceId: 1, tokenType: 'app', isAdmin: false });
  mockRequireClient.mockResolvedValue(null);
  mockAuthenticateBasic.mockResolvedValue(null);
  mockAuthenticate.mockResolvedValue(null);
});


function useClientToken() {
  mockRequireApp.mockResolvedValue(null);
  mockRequireClient.mockResolvedValue({ userId: 1, tokenType: 'client', isAdmin: false });
}


async function readJson(response: Response): Promise<Record<string, any>> {
  return (await response.json()) as Record<string, any>;
}

describe('POST /message 统一字段校验（真库）', () => {
  describe('priority', () => {
    test.each([-1, 0, 1, 2, 3, 4, 5, 9, 10, Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER])('JSON 显式 priority %p 合法并按原值入库', async (priority) => {
      const fx = makeFixture();

      const response = await fx.postJson({ message: 'hi', priority });

      expect(response.status).toBe(200);
      expect((await readJson(response)).priority).toBe(priority);
      expect(fx.firstMessageRow().priority).toBe(priority);
    });

    test('preserves_default_priority_five_when_priority_absent_or_null（JSON 缺省/null => 应用 defaultPriority=5）', async () => {
      const absent = makeFixture();
      const absentResponse = await absent.postJson({ message: 'hi' });
      expect(absentResponse.status).toBe(200);
      expect((await readJson(absentResponse)).priority).toBe(5);
      expect(absent.firstMessageRow().priority).toBe(5);

      const nullPriority = makeFixture();
      const nullResponse = await nullPriority.postJson({ message: 'hi', priority: null });
      expect(nullResponse.status).toBe(200);
      expect((await readJson(nullResponse)).priority).toBe(5);
      expect(nullPriority.firstMessageRow().priority).toBe(5);
    });

    test.each([{}, { priority: null }])('inherits existing fractional default without explicit-field revalidation: %p', async (fields) => {
      const fx = makeFixture();
      fx.testDb.sqlite.prepare('UPDATE applications SET default_priority = ? WHERE id = 1').run(2.5);
      const response = await fx.postJson({ message: 'inherited default', ...fields });
      expect(response.status).toBe(200);
      expect((await readJson(response)).priority).toBe(2.5);
      expect(fx.firstMessageRow().priority).toBe(2.5);
    });

    test('form priority 省略 => 应用 defaultPriority=5', async () => {
      const fx = makeFixture();

      const response = await fx.postForm({ message: 'hi' });

      expect(response.status).toBe(200);
      expect((await readJson(response)).priority).toBe(5);
      expect(fx.firstMessageRow().priority).toBe(5);
    });

    test('form_empty_priority_is_explicit_zero_not_app_default（priority= => 显式0，defaultPriority=5 也不采用）', async () => {
      const fx = makeFixture();

      const response = await fx.postForm({ message: 'hi', priority: '' });

      expect(response.status).toBe(200);
      const body = await readJson(response);
      expect(body.priority).toBe(0);
      expect(fx.firstMessageRow().priority).toBe(0);
    });

    test.each([
      ['空白（priority= ）', ' '],
      ['小数（priority=2.5）', '2.5'],
      ['非数字（priority=abc）', 'abc'],
    ])('form %s => 400 且不入库', async (_label, priority) => {
      const fx = makeFixture();

      const response = await fx.postForm({ message: 'hi', priority });

      expect(response.status).toBe(400);
      expect(fx.messageCount()).toBe(0);
    });

    test.each([
      ['空串', ''],
      ['数字字符串', '2'],
      ['小数', 2.5],
      ['true', true],
      ['false', false],
      ['数组', []],
      ['对象', {}],
      ['低于安全范围', Number.MIN_SAFE_INTEGER - 1],
      ['高于安全范围', Number.MAX_SAFE_INTEGER + 1],
    ])('JSON priority %s => 400 且不入库', async (_label, priority) => {
      const fx = makeFixture();

      const response = await fx.postJson({ message: 'hi', priority });

      expect(response.status).toBe(400);
      expect(fx.messageCount()).toBe(0);
    });
  });

  describe('message', () => {
    test("JSON message ' '（纯空白）合法，原样入库不 trim", async () => {
      const fx = makeFixture();

      const response = await fx.postJson({ message: ' ' });

      expect(response.status).toBe(200);
      expect((await readJson(response)).message).toBe(' ');
      expect(fx.firstMessageRow().message).toBe(' ');
    });

    test.each([
      ['null', null],
      ['空串', ''],
      ['数字', 123],
      ['布尔', true],
      ['数组', []],
      ['对象', {}],
    ])('JSON message %s => 400 且不入库', async (_label, msg) => {
      const fx = makeFixture();

      const response = await fx.postJson({ message: msg });

      expect(response.status).toBe(400);
      expect(fx.messageCount()).toBe(0);
    });

    test('form 缺 message 字段 => 400 且不入库', async () => {
      const fx = makeFixture();

      const response = await fx.postForm({ title: 't' });

      expect(response.status).toBe(400);
      expect(fx.messageCount()).toBe(0);
    });
  });

  describe('title', () => {
    test('form_empty_title_uses_application_name（title= => 存应用名 Backup Monitor，响应同值）', async () => {
      const fx = makeFixture();

      const response = await fx.postForm({ message: 'hi', title: '' });

      expect(response.status).toBe(200);
      const body = await readJson(response);
      expect(body.title).toBe(APP_NAME);
      expect(fx.firstMessageRow().title).toBe(APP_NAME);
    });

    test('form title 省略 => 存应用名', async () => {
      const fx = makeFixture();

      const response = await fx.postForm({ message: 'hi' });

      expect(response.status).toBe(200);
      expect((await readJson(response)).title).toBe(APP_NAME);
      expect(fx.firstMessageRow().title).toBe(APP_NAME);
    });

    test('form 纯空白 title => 存应用名（Gotify TrimSpace 回填语义）', async () => {
      const fx = makeFixture();

      const response = await fx.postForm({ message: 'hi', title: ' ' });

      expect(response.status).toBe(200);
      expect((await readJson(response)).title).toBe(APP_NAME);
      expect(fx.firstMessageRow().title).toBe(APP_NAME);
    });

    test('form 非空白 title => 原样保留（DB 与响应同值）', async () => {
      const fx = makeFixture();

      const response = await fx.postForm({ message: 'hi', title: 'Custom Title' });

      expect(response.status).toBe(200);
      expect((await readJson(response)).title).toBe('Custom Title');
      expect(fx.firstMessageRow().title).toBe('Custom Title');
    });

    test('JSON title null => 存应用名（gotify 语义回归）', async () => {
      const fx = makeFixture();

      const response = await fx.postJson({ message: 'hi', title: null });

      expect(response.status).toBe(200);
      expect((await readJson(response)).title).toBe(APP_NAME);
      expect(fx.firstMessageRow().title).toBe(APP_NAME);
    });

    test('JSON 非字符串 title（123）=> 400 且不入库', async () => {
      const fx = makeFixture();

      const response = await fx.postJson({ message: 'hi', title: 123 });

      expect(response.status).toBe(400);
      expect(fx.messageCount()).toBe(0);
    });
  });

  describe('extras', () => {
    test('JSON 合法嵌套 extras 完整持久化并原样响应', async () => {
      const fx = makeFixture();
      const extras = { tags: ['a'], nested: { items: [1] } };

      const response = await fx.postJson({ message: 'hi', extras });

      expect(response.status).toBe(200);
      expect((await readJson(response)).extras).toEqual(extras);
      expect(JSON.parse(fx.firstMessageRow().extras)).toEqual(extras);
    });

    test('JSON extras 空对象 {} => 200 合法', async () => {
      const fx = makeFixture();

      const response = await fx.postJson({ message: 'hi', extras: {} });

      expect(response.status).toBe(200);
      expect((await readJson(response)).extras).toEqual({});
      expect(fx.messageCount()).toBe(1);
    });

    test('JSON extras null => 200 合法（存储语义保持不静默改写；读取面归一化省略）', async () => {
      const fx = makeFixture();

      const response = await fx.postJson({ message: 'hi', extras: null });

      expect(response.status).toBe(200);

      expect(Object.prototype.hasOwnProperty.call(await readJson(response), 'extras')).toBe(false);
      expect(fx.messageCount()).toBe(1);

      expect(fx.firstMessageRow().extras).toBe('null');
    });

    test('JSON extras 缺省 => 200 合法', async () => {
      const fx = makeFixture();

      const response = await fx.postJson({ message: 'hi' });

      expect(response.status).toBe(200);
      expect(fx.messageCount()).toBe(1);
    });

    test.each([
      ['顶层数组', []],
      ['字符串', 'text'],
      ['数字', 1],
      ['布尔', true],
    ])('JSON extras %s => 400 且不入库', async (_label, extras) => {
      const fx = makeFixture();

      const response = await fx.postJson({ message: 'hi', extras });

      expect(response.status).toBe(400);
      expect(fx.messageCount()).toBe(0);
    });

    test('form extras 为顶层数组 JSON => 400 且不入库', async () => {
      const fx = makeFixture();

      const response = await fx.postForm({ message: 'hi', extras: '[]' });

      expect(response.status).toBe(400);
      expect(fx.messageCount()).toBe(0);
    });

    test('form extras 为顶层标量 JSON => 400 且不入库', async () => {
      const fx = makeFixture();

      const response = await fx.postForm({ message: 'hi', extras: 'text' });

      expect(response.status).toBe(400);
      expect(fx.messageCount()).toBe(0);
    });

    test('form extras 非法 JSON => 400 且不入库（Woe 扩展语义）', async () => {
      const fx = makeFixture();

      const response = await fx.postForm({ message: 'hi', extras: '{not-valid-json' });

      expect(response.status).toBe(400);
      expect(fx.messageCount()).toBe(0);
    });
  });

  describe('JSON 顶层形状', () => {
    test.each([
      ['顶层数组', '["hi"]'],
      ['顶层字符串', '"text"'],
      ['顶层数字', '5'],
    ])('JSON 顶层 %s => 400 且不入库', async (_label, rawBody) => {
      const fx = makeFixture();

      const response = await fx.postRawJson(rawBody);

      expect(response.status).toBe(400);
      expect(fx.messageCount()).toBe(0);
    });
  });

  describe('rejects_invalid_fields_without_message_or_push_side_effects', () => {
    test.each([
      ['JSON 非法 priority（数字字符串）', (fx: Fixture) => fx.postJson({ message: 'hi', priority: '2' })],
      ['JSON 非法 priority（小数）', (fx: Fixture) => fx.postJson({ message: 'hi', priority: 2.5 })],
      ['JSON 非法 extras（顶层数组）', (fx: Fixture) => fx.postJson({ message: 'hi', extras: [] })],
      ['JSON 非法 message（数字）', (fx: Fixture) => fx.postJson({ message: 123 })],
      ['JSON 顶层数组', (fx: Fixture) => fx.postRawJson('[]')],
      ['form 非法 priority（2.5）', (fx: Fixture) => fx.postForm({ message: 'hi', priority: '2.5' })],
      ['form 非法 extras JSON', (fx: Fixture) => fx.postForm({ message: 'hi', extras: '{not-valid-json' })],
    ])('%s => 400 且零消息/推送副作用', async (_label, send) => {
      const fx = makeFixture();

      const response = await (send as (f: Fixture) => Promise<Response>)(fx);

      expect(response.status).toBe(400);

      expect(fx.messageCount()).toBe(0);

      expect(fx.broadcastFetch).not.toHaveBeenCalled();

      expect(fx.outboxCount()).toBe(0);

      expect(fx.executionCtx.waitUntil).not.toHaveBeenCalled();
      expect(fx.sendBatch).not.toHaveBeenCalled();
    });

    test('合法对照组：插入+广播发生；无 pending outbox 行则不入队', async () => {
      const fx = makeFixture();

      const response = await fx.postJson({ message: 'hi' });

      expect(response.status).toBe(200);
      expect(fx.messageCount()).toBe(1);
      expect(fx.broadcastFetch).toHaveBeenCalledTimes(1);

      await fx.executionCtx.waitUntil.mock.calls[0]?.[0];
      expect(fx.sendBatch).not.toHaveBeenCalled();
    });
  });

  describe('不同 appid 路径回归（应用选择策略不变）', () => {
    test('client token + JSON appid=2 => 消息落在 app 2 并采用其 defaultPriority=2', async () => {
      useClientToken();
      const fx = makeFixture();

      const response = await fx.postJson({ message: 'hi', appid: 2 });

      expect(response.status).toBe(200);
      const body = await readJson(response);
      expect(body.appid).toBe(2);
      expect(body.priority).toBe(2);
      expect(fx.firstMessageRow().appid).toBe(2);
      expect(fx.firstMessageRow().priority).toBe(2);
    });

    test('client token + form appid=2 + priority= => 显式0（不采用 app2 默认2）', async () => {
      useClientToken();
      const fx = makeFixture();

      const response = await fx.postForm({ message: 'hi', appid: '2', priority: '' });

      expect(response.status).toBe(200);
      expect((await readJson(response)).priority).toBe(0);
      const row = fx.firstMessageRow();
      expect(row.appid).toBe(2);
      expect(row.priority).toBe(0);
    });

    test('app token + body appid 999 => 忽略 body.appid，消息落在 token 应用', async () => {
      const fx = makeFixture();

      const response = await fx.postJson({ message: 'hi', appid: 999 });

      expect(response.status).toBe(200);
      expect((await readJson(response)).appid).toBe(1);
      expect(fx.firstMessageRow().appid).toBe(1);
    });

    test('client token + 他人 appid=3 => 400 appid not found，不插入', async () => {
      useClientToken();
      const fx = makeFixture();

      const response = await fx.postJson({ message: 'hi', appid: 3 });

      expect(response.status).toBe(400);
      expect(fx.messageCount()).toBe(0);
    });
  });
});


describe('parsed JSON precision contract', () => {
  test.each([
    ['9007199254740991.1', 9007199254740991],
    ['1.00000000000000001', 1],
  ])('accepts the parsed integer from %s', async (literal, expected) => {
    const fx = makeFixture();
    const response = await fx.postRawJson(`{"message":"precision","priority":${literal}}`);
    expect(response.status).toBe(200);
    expect((await response.json() as any).priority).toBe(expected);
    expect(fx.firstMessageRow().priority).toBe(expected);
  });
  test.each(['9007199254740992', '-9007199254740992', '1e309'])('rejects parsed unsafe value %s without side effects', async (literal) => {
    const fx = makeFixture();
    const response = await fx.postRawJson(`{"message":"precision","priority":${literal}}`);
    expect(response.status).toBe(400);
    expect(fx.messageCount()).toBe(0);
    expect(fx.broadcastFetch).not.toHaveBeenCalled();
    expect(fx.outboxCount()).toBe(0);
    expect(fx.sendBatch).not.toHaveBeenCalled();
  });
});


describe('Pulse issue 2 notification', () => {
  test('preserves markdown, extras and priority 5 in the database and response', async () => {
    const payload = require('../fixtures/pulse-issue-2.json');
    const fx = makeFixture();
    const response = await fx.postJson(payload);
    expect(response.status).toBe(200);
    const body = await readJson(response);
    expect(body).toMatchObject(payload);
    expect(fx.firstMessageRow()).toMatchObject({priority:5,message:payload.message,title:payload.title});
    expect(JSON.parse(fx.firstMessageRow().extras)).toEqual(payload.extras);
  });
});
