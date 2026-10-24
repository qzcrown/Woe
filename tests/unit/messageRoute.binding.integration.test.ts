





















const mockIsEnqueueWritePaused = jest.fn().mockResolvedValue(false);

jest.mock('../../src/services/writeGateService.ts', () => ({
  isEnqueueWritePaused: mockIsEnqueueWritePaused,
  ENQUEUE_WRITE_GATE_KEY: 'enqueue_write_gate',
  ENQUEUE_WRITE_GATE_PAUSED: 'paused',
}));

import { message } from '../../src/routes/message';
import { createMessageTestDb } from '../helpers/messageTestDb';
import { makeExecutionCtxStub, type ExecutionCtxStub } from '../helpers/executionContext';
import { makeD1Sqlite } from '../helpers/d1Sqlite';
import { applications, clients } from '../../src/models';
import type { TestDb } from '../helpers/testDb';


const APP_NAME = 'Backup Monitor';
const APP_DEFAULT_PRIORITY = 5;

interface Fixture {
  env: Record<string, unknown>;
  executionCtx: ExecutionCtxStub;
  sendBatch: jest.Mock;

  post: (pathAndQuery: string, init?: { headers?: Record<string, string>; body?: BodyInit }) => Promise<Response>;
  messageCount: () => number;
  outboxCount: () => number;
  firstMessageRow: () => Record<string, any>;
}

function makeFixture(): Fixture {
  const testDb: TestDb = createMessageTestDb();


  testDb.sqlite
    .prepare("INSERT INTO users (id, name) VALUES (1, 'binding-owner-1'), (2, 'binding-owner-2')")
    .run();
  testDb.db
    .insert(applications)
    .values([
      { id: 1, userId: 1, token: 'Aapp-token-1', name: APP_NAME, defaultPriority: APP_DEFAULT_PRIORITY },
      { id: 2, userId: 1, token: 'Aapp-token-2', name: 'Second App', defaultPriority: 2 },
      { id: 3, userId: 2, token: 'Aapp-token-3', name: 'Other User App', defaultPriority: 1 },
    ])
    .run();
  testDb.db
    .insert(clients)
    .values([{ id: 1, userId: 1, token: 'Cclient-token-1', name: 'binding-cli-1' }])
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

  return {
    env,
    executionCtx,
    sendBatch,
    post: async (pathAndQuery, init = {}) =>
      await message.fetch(
        new Request(`http://localhost${pathAndQuery}`, { method: 'POST', ...init }),
        env as any,
        executionCtx
      ),
    messageCount: () =>
      (testDb.sqlite.prepare('SELECT COUNT(*) AS c FROM messages').get() as { c: number }).c,
    outboxCount: () =>
      (testDb.sqlite.prepare('SELECT COUNT(*) AS c FROM push_outbox').get() as { c: number }).c,
    firstMessageRow: () =>
      testDb.sqlite.prepare('SELECT * FROM messages ORDER BY id LIMIT 1').get() as Record<string, any>,
  };
}

async function readJson(response: Response): Promise<Record<string, any>> {
  return (await response.json()) as Record<string, any>;
}


function expectZeroWrites(fx: Fixture) {
  expect(fx.messageCount()).toBe(0);
  expect(fx.outboxCount()).toBe(0);
  expect(fx.sendBatch).not.toHaveBeenCalled();
}

beforeEach(() => {
  jest.clearAllMocks();
  mockIsEnqueueWritePaused.mockResolvedValue(false);
});

describe('POST /message query 绑定（form 默认路径）', () => {
  test('query-only（无 CT 无 body，token 亦在 query）=> 200，值按 query 入库', async () => {
    const fx = makeFixture();

    const response = await fx.post('/?token=Aapp-token-1&message=hi&title=T&priority=2');

    expect(response.status).toBe(200);
    const body = await readJson(response);
    expect(body).toMatchObject({ appid: 1, message: 'hi', title: 'T', priority: 2 });
    expect(fx.firstMessageRow()).toMatchObject({ appid: 1, message: 'hi', title: 'T', priority: 2 });
  });

  test('query-only priority 缺省 => 应用 defaultPriority；title 缺省回填应用名', async () => {
    const fx = makeFixture();

    const response = await fx.post('/?token=Aapp-token-1&message=hi');

    expect(response.status).toBe(200);
    expect((await readJson(response)).priority).toBe(APP_DEFAULT_PRIORITY);
    expect(fx.firstMessageRow()).toMatchObject({ priority: APP_DEFAULT_PRIORITY, title: APP_NAME });
  });

  test('query priority=（空串）=> 显式 0（不采用应用默认）', async () => {
    const fx = makeFixture();

    const response = await fx.post('/?token=Aapp-token-1&message=hi&priority=');

    expect(response.status).toBe(200);
    expect((await readJson(response)).priority).toBe(0);
    expect(fx.firstMessageRow().priority).toBe(0);
  });

  test('query title 纯空白 => 回填应用名', async () => {
    const fx = makeFixture();

    const response = await fx.post('/?token=Aapp-token-1&message=hi&title=%20');

    expect(response.status).toBe(200);
    expect(fx.firstMessageRow().title).toBe(APP_NAME);
  });

  test('query extras JSON 字符串 => 解析并入（Woe form 扩展在默认路径保持）', async () => {
    const fx = makeFixture();

    const response = await fx.post(
      `/?token=Aapp-token-1&message=hi&extras=${encodeURIComponent('{"a":1}')}`
    );

    expect(response.status).toBe(200);
    expect(JSON.parse(fx.firstMessageRow().extras)).toEqual({ a: 1 });
  });

  test('query-only 缺 message => 400 零写入', async () => {
    const fx = makeFixture();

    const response = await fx.post('/?token=Aapp-token-1&title=T');

    expect(response.status).toBe(400);
    await expect(readJson(response)).resolves.toMatchObject({
      errorDescription: 'Missing required field: message is required',
    });
    expectZeroWrites(fx);
  });
});

describe('POST /message urlencoded：body 首值优先，query 补缺', () => {
  const FORM_CT = { 'content-type': 'application/x-www-form-urlencoded' };

  test('body=message=body、query=message=query&title=T => 入库 message=body / title=T', async () => {
    const fx = makeFixture();

    const response = await fx.post('/?token=Aapp-token-1&message=query&title=T', {
      headers: FORM_CT,
      body: 'message=body&priority=1',
    });

    expect(response.status).toBe(200);
    expect(fx.firstMessageRow()).toMatchObject({ message: 'body', title: 'T', priority: 1 });
  });

  test('重复字段取首值（message=first&message=second => first）', async () => {
    const fx = makeFixture();

    const response = await fx.post('/?token=Aapp-token-1', {
      headers: FORM_CT,
      body: 'message=first&message=second',
    });

    expect(response.status).toBe(200);
    expect(fx.firstMessageRow().message).toBe('first');
  });

  test('body message 为空串 => 不回退 query，400 零写入', async () => {
    const fx = makeFixture();

    const response = await fx.post('/?token=Aapp-token-1&message=query', {
      headers: FORM_CT,
      body: 'message=',
    });

    expect(response.status).toBe(400);
    await expect(readJson(response)).resolves.toMatchObject({
      errorDescription: 'Missing required field: message is required',
    });
    expectZeroWrites(fx);
  });
});

describe('POST /message JSON：只绑 body，query 不合并', () => {
  const JSON_CT = { 'content-type': 'application/json' };

  test('JSON message 优先于 query message；query title 不并入（回填应用名）', async () => {
    const fx = makeFixture();

    const response = await fx.post('/?token=Aapp-token-1&message=query&title=Q', {
      headers: JSON_CT,
      body: JSON.stringify({ message: 'body' }),
    });

    expect(response.status).toBe(200);
    expect(fx.firstMessageRow()).toMatchObject({ message: 'body', title: APP_NAME });
  });

  test('JSON 缺 message => 不因 query message 成功，400 零写入', async () => {
    const fx = makeFixture();

    const response = await fx.post('/?token=Aapp-token-1&message=query', {
      headers: JSON_CT,
      body: JSON.stringify({ title: 'x' }),
    });

    expect(response.status).toBe(400);
    await expect(readJson(response)).resolves.toMatchObject({
      errorDescription: 'Missing required field: message is required',
    });
    expectZeroWrites(fx);
  });
});

describe('POST /message multipart：只绑文本字段', () => {
  function makeMultipart(fields: Record<string, string>, pathAndQuery: string): Request {
    const form = new FormData();
    for (const [name, value] of Object.entries(fields)) form.append(name, value);
    return new Request(`http://localhost${pathAndQuery}`, { method: 'POST', body: form });
  }

  test('文本 message/title/priority => 200，值入库', async () => {
    const fx = makeFixture();

    const response = await message.fetch(
      makeMultipart({ message: 'hi', title: 'T', priority: '2' }, '/?token=Aapp-token-1'),
      fx.env as any,
      fx.executionCtx
    );

    expect(response.status).toBe(200);
    const body = await readJson(response);
    expect(body).toMatchObject({ appid: 1, message: 'hi', title: 'T', priority: 2 });
    expect(fx.firstMessageRow()).toMatchObject({ message: 'hi', title: 'T', priority: 2 });
  });

  test('只有 query message（multipart 无 message 文本）=> 400 零写入', async () => {
    const fx = makeFixture();

    const response = await message.fetch(
      makeMultipart({ title: 'T' }, '/?token=Aapp-token-1&message=query'),
      fx.env as any,
      fx.executionCtx
    );

    expect(response.status).toBe(400);
    await expect(readJson(response)).resolves.toMatchObject({
      errorDescription: 'Missing required field: message is required',
    });
    expectZeroWrites(fx);
  });

  test('与 message 同名 File 部件 => 400 零写入', async () => {
    const fx = makeFixture();
    const form = new FormData();
    form.append('message', new Blob(['file-content']), 'payload.txt');

    const response = await message.fetch(
      new Request('http://localhost/?token=Aapp-token-1', { method: 'POST', body: form }),
      fx.env as any,
      fx.executionCtx
    );

    expect(response.status).toBe(400);
    await expect(readJson(response)).resolves.toMatchObject({ errorCode: 400 });
    expectZeroWrites(fx);
  });

  test('无关文件字段忽略不持久化，文本 message 正常入库', async () => {
    const fx = makeFixture();
    const form = new FormData();
    form.append('message', 'hi');
    form.append('attachment', new Blob(['irrelevant']), 'note.txt');

    const response = await message.fetch(
      new Request('http://localhost/?token=Aapp-token-1', { method: 'POST', body: form }),
      fx.env as any,
      fx.executionCtx
    );

    expect(response.status).toBe(200);
    expect(fx.firstMessageRow()).toMatchObject({ message: 'hi' });
    expect(fx.firstMessageRow().attachment).toBeUndefined();
  });
});

describe('POST /message 缺失/未知 Content-Type：form 默认路径只读 query', () => {
  test('未知类型（text/plain）+ query => 200；body 不强行解析（无 query => 400 零写入）', async () => {
    const withQuery = makeFixture();
    const okResponse = await withQuery.post('/?token=Aapp-token-1&message=from-query', {
      headers: { 'content-type': 'text/plain' },
      body: 'message=body',
    });
    expect(okResponse.status).toBe(200);
    expect(withQuery.firstMessageRow().message).toBe('from-query');

    const withoutQuery = makeFixture();
    const badResponse = await withoutQuery.post('/?token=Aapp-token-1', {
      headers: { 'content-type': 'text/plain' },
      body: 'message=body',
    });
    expect(badResponse.status).toBe(400);
    await expect(readJson(badResponse)).resolves.toMatchObject({
      errorDescription: 'Missing required field: message is required',
    });
    expectZeroWrites(withoutQuery);
  });
});

describe('POST /message appid 属主约束（client token 路径）', () => {
  test('query appid 属于本人 => 200 入库该应用', async () => {
    const fx = makeFixture();

    const response = await fx.post('/?token=Cclient-token-1&message=hi&appid=2');

    expect(response.status).toBe(200);
    expect(fx.firstMessageRow()).toMatchObject({ appid: 2, message: 'hi' });
  });

  test('query appid 属于他人 => 400 appid not found，零写入', async () => {
    const fx = makeFixture();

    const response = await fx.post('/?token=Cclient-token-1&message=hi&appid=3');

    expect(response.status).toBe(400);
    await expect(readJson(response)).resolves.toMatchObject({ errorDescription: 'appid not found' });
    expectZeroWrites(fx);
  });

  test('client token 无 appid => 400，零写入', async () => {
    const fx = makeFixture();

    const response = await fx.post('/?token=Cclient-token-1&message=hi');

    expect(response.status).toBe(400);
    await expect(readJson(response)).resolves.toMatchObject({
      errorDescription: 'appid is required when not authenticating with an application token',
    });
    expectZeroWrites(fx);
  });
});

describe('POST /message 认证与写闸门', () => {
  test('匿名（无 token）query-only => 401，零写入', async () => {
    const fx = makeFixture();

    const response = await fx.post('/?message=hi&title=T');

    expect(response.status).toBe(401);
    await expect(readJson(response)).resolves.toMatchObject({
      errorDescription: 'Application token, client token or Basic auth required',
    });
    expectZeroWrites(fx);
  });

  test('写闸门 paused => 503 先于解析/认证（无 token 亦 503 而非 401），零写入', async () => {
    const fx = makeFixture();
    mockIsEnqueueWritePaused.mockResolvedValue(true);

    const noAuth = await fx.post('/?message=hi');
    expect(noAuth.status).toBe(503);
    await expect(readJson(noAuth)).resolves.toMatchObject({
      errorDescription: expect.stringContaining('enqueue write gate'),
    });

    const withAuth = await fx.post('/?token=Aapp-token-1&message=hi&title=T&priority=2');
    expect(withAuth.status).toBe(503);

    expectZeroWrites(fx);
  });
});


describe('signed safe priority through every request binding', () => {
  const values = [-1, 5, Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER];
  test.each(['json', 'form', 'multipart', 'query'])('%s preserves priorities through storage and authenticated read', async (encoding) => {
    for (const priority of values) {
      const fx = makeFixture();
      let response: Response;
      const target = '/?token=Aapp-token-1';
      if (encoding === 'json') response = await fx.post(target, { headers: {'content-type':'application/json'}, body: JSON.stringify({message:'priority regression',priority}) });
      else if (encoding === 'form') response = await fx.post(target, { headers: {'content-type':'application/x-www-form-urlencoded'}, body: new URLSearchParams({message:'priority regression',priority:String(priority)}).toString() });
      else if (encoding === 'multipart') {
        const body = new FormData(); body.set('message','priority regression'); body.set('priority',String(priority));
        response = await fx.post(target, {body});
      } else response = await fx.post(`${target}&message=priority&priority=${priority}`);
      expect(response.status).toBe(200);
      const created = await readJson(response);
      expect(created.priority).toBe(priority);
      expect(fx.firstMessageRow().priority).toBe(priority);
      const fetched = await message.fetch(new Request(`http://localhost/${created.id}?token=Cclient-token-1`), fx.env as any, fx.executionCtx);
      expect(fetched.status).toBe(200);
      expect((await readJson(fetched)).priority).toBe(priority);
    }
  });
  test.each(['json', 'form', 'multipart', 'query'])('%s rejects unsafe priorities without writes', async (encoding) => {
    for (const priority of [Number.MIN_SAFE_INTEGER-1, Number.MAX_SAFE_INTEGER+1]) {
      const fx = makeFixture();
      const target = '/?token=Aapp-token-1';
      let response: Response;
      if (encoding === 'json') response = await fx.post(target, {headers:{'content-type':'application/json'},body:JSON.stringify({message:'unsafe',priority})});
      else if (encoding === 'form') response = await fx.post(target,{headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({message:'unsafe',priority:String(priority)}).toString()});
      else if (encoding === 'multipart') { const body=new FormData();body.set('message','unsafe');body.set('priority',String(priority));response=await fx.post(target,{body}); }
      else response=await fx.post(`${target}&message=unsafe&priority=${priority}`);
      expect(response.status).toBe(400);
      expectZeroWrites(fx);
    }
  });
});
