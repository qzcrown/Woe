











const mockRequireApp = jest.fn();
const mockRequireClient = jest.fn();
const mockAuthenticateBasic = jest.fn();
const mockAuthenticate = jest.fn();
const mockIsEnqueueWritePaused = jest.fn().mockResolvedValue(false);

const mockDrizzle: any = {
  select: jest.fn(),
  insert: jest.fn(),
  update: jest.fn(),
};

jest.mock("../../src/drizzle/index.ts", () => ({
  createDrizzle: jest.fn(() => mockDrizzle),
}));

jest.mock("../../src/services/writeGateService.ts", () => ({
  isEnqueueWritePaused: mockIsEnqueueWritePaused,
  ENQUEUE_WRITE_GATE_KEY: "enqueue_write_gate",
  ENQUEUE_WRITE_GATE_PAUSED: "paused",
}));

jest.mock("../../src/middleware/auth.ts", () => ({
  Authenticator: jest.fn().mockImplementation(() => ({
    requireApp: mockRequireApp,
    requireClient: mockRequireClient,
    authenticateBasic: mockAuthenticateBasic,
    authenticate: mockAuthenticate,
  })),
}));

import { message } from "../../src/routes/message";


let mockInsertCalls: any[] = [];

let mockAppOwnershipRow: any = null;

let mockAppCreateRow: any = { userId: 1, defaultPriority: 5, name: "Test App" };

let mockInsertReturningRows: any[] = [];

function createdRow(overrides: Record<string, any> = {}) {
  return {
    id: 42,
    appId: 5,
    message: "hi",
    title: "",
    priority: 5,
    date: "2026-09-02T00:00:00Z",
    extras: null,
    ...overrides,
  };
}

function makeFormRequest(fields: Record<string, string>, headers: Record<string, string> = {}) {
  return new Request("http://localhost/", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", ...headers },
    body: new URLSearchParams(fields).toString(),
  });
}

const mockEnv: any = { DB: {} };
const mockExecutionCtx: any = { waitUntil: jest.fn() };

beforeEach(() => {
  jest.clearAllMocks();
  mockInsertCalls = [];
  mockAppOwnershipRow = null;
  mockAppCreateRow = { userId: 1, defaultPriority: 5, name: "Test App" };
  mockInsertReturningRows = [createdRow()];
  mockIsEnqueueWritePaused.mockResolvedValue(false);

  mockRequireApp.mockResolvedValue(null);
  mockRequireClient.mockResolvedValue(null);
  mockAuthenticateBasic.mockResolvedValue(null);
  mockAuthenticate.mockResolvedValue(null);

  mockDrizzle.select.mockImplementation((selection: any) => ({
    from: () => ({
      where: () => ({
        get: () =>
          Promise.resolve(
            selection && typeof selection === "object"
              ? "defaultPriority" in selection
                ? mockAppCreateRow
                : "userId" in selection
                  ? mockAppOwnershipRow
                  : null
              : null
          ),
        all: () => Promise.resolve([]),
        orderBy: () => [],
      }),
    }),
  }));

  mockDrizzle.insert.mockImplementation(() => ({
    values: (v: any) => {
      mockInsertCalls.push(v);
      return { returning: () => Promise.resolve(mockInsertReturningRows) };
    },
  }));

  mockDrizzle.update.mockImplementation(() => ({
    set: () => ({ where: () => Promise.resolve(undefined) }),
  }));
});

describe("POST /message form body (Woe 扩展)", () => {
  test("form 编码创建消息成功（client token + appid）", async () => {
    mockRequireClient.mockResolvedValue({ userId: 7, tokenType: "client", isAdmin: false });
    mockAppOwnershipRow = { id: 9, userId: 7 };
    mockAppCreateRow = { userId: 7, defaultPriority: 0 };
    mockInsertReturningRows = [createdRow({ id: 43, appId: 9, title: "t", priority: 2 })];

    const response = await message.fetch(
      makeFormRequest(
        { message: "hi", title: "t", priority: "2", appid: "9" },
        { "x-gotify-key": "Cclient-token" }
      ),
      mockEnv,
      mockExecutionCtx
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ id: 43, appid: 9, message: "hi", title: "t", priority: 2 });
    expect(mockInsertCalls[0]).toMatchObject({ appid: 9, userid: 7, message: "hi", title: "t", priority: 2 });
  });

  test("Content-Type 带参数后缀（; charset=UTF-8）仍按 form 解析", async () => {
    mockRequireClient.mockResolvedValue({ userId: 7, tokenType: "client", isAdmin: false });
    mockAppOwnershipRow = { id: 9, userId: 7 };
    mockAppCreateRow = { userId: 7, defaultPriority: 0 };
    mockInsertReturningRows = [createdRow({ id: 43, appId: 9, priority: 2 })];

    const response = await message.fetch(
      makeFormRequest(
        { message: "hi", priority: "2", appid: "9" },
        { "content-type": "application/x-www-form-urlencoded; charset=UTF-8", "x-gotify-key": "Cclient-token" }
      ),
      mockEnv,
      mockExecutionCtx
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ id: 43, appid: 9 });
    expect(mockInsertCalls[0]).toMatchObject({ appid: 9, userid: 7, priority: 2 });
  });

  test("extras 为合法 JSON 字符串时并入消息（Woe 扩展）", async () => {
    mockRequireApp.mockResolvedValue({ userId: 1, resourceId: 5, tokenType: "app", isAdmin: false });
    mockInsertReturningRows = [createdRow({ id: 44, extras: JSON.stringify({ foo: "bar" }) })];

    const response = await message.fetch(
      makeFormRequest(
        { message: "hi", extras: JSON.stringify({ foo: "bar" }) },
        { "x-gotify-key": "Aapp-token" }
      ),
      mockEnv,
      mockExecutionCtx
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ id: 44, extras: { foo: "bar" } });
    expect(mockInsertCalls[0].extras).toBe(JSON.stringify({ foo: "bar" }));
  });

  test("extras 非法 JSON → 400，不入库", async () => {
    mockRequireApp.mockResolvedValue({ userId: 1, resourceId: 5, tokenType: "app", isAdmin: false });

    const response = await message.fetch(
      makeFormRequest(
        { message: "hi", extras: "{not-valid-json" },
        { "x-gotify-key": "Aapp-token" }
      ),
      mockEnv,
      mockExecutionCtx
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Bad Request",
      errorCode: 400,
      errorDescription: "extras must be valid JSON",
    });
    expect(mockDrizzle.insert).not.toHaveBeenCalled();
  });

  test("priority 非数字 → 400，不入库", async () => {
    mockRequireApp.mockResolvedValue({ userId: 1, resourceId: 5, tokenType: "app", isAdmin: false });

    const response = await message.fetch(
      makeFormRequest(
        { message: "hi", priority: "abc" },
        { "x-gotify-key": "Aapp-token" }
      ),
      mockEnv,
      mockExecutionCtx
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Bad Request",
      errorCode: 400,
      errorDescription: "priority must be an integer",
    });
    expect(mockDrizzle.insert).not.toHaveBeenCalled();
  });

  test("不安全 priority → 400，不入库", async () => {
    mockRequireClient.mockResolvedValue({ userId: 7, tokenType: "client", isAdmin: false });
    mockAppOwnershipRow = { id: 9, userId: 7 };
    mockAppCreateRow = { userId: 7, defaultPriority: 0 };

    const response = await message.fetch(
      makeFormRequest(
        { message: "hi", priority: "9007199254740992", appid: "9" },
        { "x-gotify-key": "Cclient-token" }
      ),
      mockEnv,
      mockExecutionCtx
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Bad Request",
      errorCode: 400,
      errorDescription: "Priority must be a safe integer",
    });
    expect(mockDrizzle.insert).not.toHaveBeenCalled();
  });

  test("缺 message 字段 → 400", async () => {
    mockRequireApp.mockResolvedValue({ userId: 1, resourceId: 5, tokenType: "app", isAdmin: false });

    const response = await message.fetch(
      makeFormRequest({ title: "t" }, { "x-gotify-key": "Aapp-token" }),
      mockEnv,
      mockExecutionCtx
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Bad Request",
      errorCode: 400,
      errorDescription: "Missing required field: message is required",
    });
    expect(mockDrizzle.insert).not.toHaveBeenCalled();
  });

  test("appid 非数字 → 400（form 字段类型转换守卫），不入库", async () => {
    mockRequireClient.mockResolvedValue({ userId: 7, tokenType: "client", isAdmin: false });

    const response = await message.fetch(
      makeFormRequest(
        { message: "hi", appid: "xyz" },
        { "x-gotify-key": "Cclient-token" }
      ),
      mockEnv,
      mockExecutionCtx
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Bad Request",
      errorCode: 400,
      errorDescription: "appid must be an integer",
    });
    expect(mockDrizzle.insert).not.toHaveBeenCalled();
  });

  test("不支持的 Content-Type（text/plain）：body 不强行解析（form 默认路径），query 仍可绑定", async () => {

    mockRequireApp.mockResolvedValue({ userId: 1, resourceId: 5, tokenType: "app", isAdmin: false });

    const response = await message.fetch(
      makeFormRequest({ message: "hi" }, { "content-type": "text/plain" }),
      mockEnv,
      mockExecutionCtx
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Bad Request",
      errorCode: 400,
      errorDescription: "Missing required field: message is required",
    });
    expect(mockDrizzle.insert).not.toHaveBeenCalled();


    mockRequireApp.mockResolvedValue({ userId: 1, resourceId: 5, tokenType: "app", isAdmin: false });
    mockInsertReturningRows = [createdRow({ id: 45, message: "from query" })];
    const viaQuery = await message.fetch(
      new Request("http://localhost/?message=from%20query", {
        method: "POST",
        headers: { "content-type": "text/plain", "x-gotify-key": "Aapp-token" },
      }),
      mockEnv,
      mockExecutionCtx
    );

    expect(viaQuery.status).toBe(200);
    expect(mockInsertCalls[0]).toMatchObject({ message: "from query" });
  });
});
