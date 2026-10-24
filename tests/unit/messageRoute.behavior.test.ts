











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

let mockOutboxPendingRows: any[] = [];

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

function makePostRequest(body: string | object | null, headers: Record<string, string> = {}) {
  return new Request("http://localhost/", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
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
  mockOutboxPendingRows = [];

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
        orderBy: () => mockOutboxPendingRows,
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

describe("POST /message route behavior (app token | client token | basic)", () => {
  test("app token: creates message under token's app, body.appid ignored", async () => {
    mockRequireApp.mockResolvedValue({ userId: 1, resourceId: 5, tokenType: "app", isAdmin: false });

    const response = await message.fetch(
      makePostRequest({ message: "hi", appid: 999 }, { "x-gotify-key": "Aapp-token" }),
      mockEnv,
      mockExecutionCtx
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ id: 42, appid: 5, message: "hi" });
    expect(mockInsertCalls[0]).toMatchObject({ appid: 5, userid: 1, message: "hi" });
    expect(mockRequireClient).not.toHaveBeenCalled();
    expect(mockExecutionCtx.waitUntil).not.toHaveBeenCalled();
  });

  test("client token without appid: 400 with gotify-exact message", async () => {
    mockRequireClient.mockResolvedValue({ userId: 7, tokenType: "client", isAdmin: false });

    const response = await message.fetch(
      makePostRequest({ message: "hi" }, { "x-gotify-key": "Cclient-token" }),
      mockEnv,
      mockExecutionCtx
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Bad Request",
      errorCode: 400,
      errorDescription: "appid is required when not authenticating with an application token",
    });
    expect(mockDrizzle.insert).not.toHaveBeenCalled();
  });

  test("client token with own appid: creates message under that app", async () => {
    mockRequireClient.mockResolvedValue({ userId: 7, tokenType: "client", isAdmin: false });
    mockAppOwnershipRow = { id: 9, userId: 7 };
    mockAppCreateRow = { userId: 7, defaultPriority: 0 };
    mockInsertReturningRows = [createdRow({ id: 43, appId: 9, priority: 0 })];

    const response = await message.fetch(
      makePostRequest({ message: "hi", appid: 9 }, { "x-gotify-key": "Cclient-token" }),
      mockEnv,
      mockExecutionCtx
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ id: 43, appid: 9 });
    expect(mockInsertCalls[0]).toMatchObject({ appid: 9, userid: 7 });
  });

  test("no valid auth at all: 401 with gotify-exact message", async () => {
    const response = await message.fetch(
      makePostRequest({ message: "hi" }, { "x-gotify-key": "Cbad-token" }),
      mockEnv,
      mockExecutionCtx
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: "Unauthorized",
      errorCode: 401,
      errorDescription: "Application token, client token or Basic auth required",
    });
  });

  test("auth exception during target resolution: generic 500, no leaked error text", async () => {
    const errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    mockRequireApp.mockRejectedValue(new Error("boom-secret-detail"));

    const response = await message.fetch(makePostRequest({ message: "hi" }), mockEnv, mockExecutionCtx);

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: "Internal Server Error",
      errorCode: 500,
      errorDescription: "Internal server error",
    });
    expect(mockDrizzle.insert).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  test("DB exception during app ownership lookup: generic 500, no leaked error text", async () => {
    const errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    mockRequireClient.mockResolvedValue({ userId: 7, tokenType: "client", isAdmin: false });
    mockDrizzle.select.mockImplementation(() => ({
      from: () => ({
        where: () => ({
          get: () => Promise.reject(new Error("d1-unavailable")),
          all: () => Promise.resolve([]),
          orderBy: () => [],
        }),
      }),
    }));

    const response = await message.fetch(
      makePostRequest({ message: "hi", appid: 9 }, { "x-gotify-key": "Cclient-token" }),
      mockEnv,
      mockExecutionCtx
    );

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: "Internal Server Error",
      errorCode: 500,
      errorDescription: "Internal server error",
    });
    expect(mockDrizzle.insert).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  test("先认证后绑定：无凭据 + malformed JSON → 401（不再先做 body 解析）", async () => {
    const response = await message.fetch(
      makePostRequest("{not-valid-json", {}),
      mockEnv,
      mockExecutionCtx
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: "Unauthorized",
      errorCode: 401,
      errorDescription: "Application token, client token or Basic auth required",
    });
  });

  test("malformed JSON body: 400 Invalid JSON body", async () => {
    mockRequireApp.mockResolvedValue({ userId: 1, resourceId: 5, tokenType: "app", isAdmin: false });
    const response = await message.fetch(
      makePostRequest("{not-valid-json", { "x-gotify-key": "Aapp-token" }),
      mockEnv,
      mockExecutionCtx
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Bad Request",
      errorCode: 400,
      errorDescription: "Invalid JSON body",
    });
  });

  test("null JSON body: 400 Invalid JSON body (parseJsonBody 拒绝字面 null，不再流入字段守卫)", async () => {
    mockRequireApp.mockResolvedValue({ userId: 1, resourceId: 5, tokenType: "app", isAdmin: false });
    const response = await message.fetch(
      makePostRequest(null, { "x-gotify-key": "Aapp-token" }),
      mockEnv,
      mockExecutionCtx
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Bad Request",
      errorCode: 400,
      errorDescription: "Invalid JSON body",
    });
  });

  test("non-string title (123): 400 title must be a string, no insert", async () => {
    mockRequireApp.mockResolvedValue({ userId: 1, resourceId: 5, tokenType: "app", isAdmin: false });

    const response = await message.fetch(
      makePostRequest({ message: "hi", title: 123 }, { "x-gotify-key": "Aapp-token" }),
      mockEnv,
      mockExecutionCtx
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Bad Request",
      errorCode: 400,
      errorDescription: "title must be a string",
    });
    expect(mockDrizzle.insert).not.toHaveBeenCalled();
  });

  test("client token with own appid, title null: 200, title defaults to app name (gotify parity)", async () => {
    mockRequireClient.mockResolvedValue({ userId: 7, tokenType: "client", isAdmin: false });
    mockAppOwnershipRow = { id: 9, userId: 7 };
    mockAppCreateRow = { userId: 7, defaultPriority: 0, name: "Test App" };
    mockInsertReturningRows = [createdRow({ id: 44, appId: 9, title: "Test App" })];

    const response = await message.fetch(
      makePostRequest({ message: "hi", title: null, appid: 9 }, { "x-gotify-key": "Cclient-token" }),
      mockEnv,
      mockExecutionCtx
    );

    expect(response.status).toBe(200);
    expect(mockInsertCalls[0]).toMatchObject({ appid: 9, userid: 7, message: "hi", title: "Test App" });
  });

  test("successful create with PUSH_QUEUE: publishes pending outbox jobs via waitUntil", async () => {
    mockRequireApp.mockResolvedValue({ userId: 1, resourceId: 5, tokenType: "app", isAdmin: false });
    mockOutboxPendingRows = [{ id: 101 }];
    const sendBatch = jest.fn().mockResolvedValue(undefined);
    const envWithQueue = { ...mockEnv, PUSH_QUEUE: { sendBatch } };

    const response = await message.fetch(
      makePostRequest({ message: "hi" }, { "x-gotify-key": "Aapp-token" }),
      envWithQueue,
      mockExecutionCtx
    );

    expect(response.status).toBe(200);
    expect(mockExecutionCtx.waitUntil).toHaveBeenCalledTimes(1);
    const pipeline = mockExecutionCtx.waitUntil.mock.calls[0][0] as Promise<void>;
    await pipeline;
    expect(sendBatch).toHaveBeenCalledTimes(1);
    const batch = sendBatch.mock.calls[0][0];
    expect(batch[0].body.outboxId).toBe(101);
    expect(typeof batch[0].body.traceId).toBe("string");
  });

  describe("enqueue write gate (system_state.enqueue_write_gate)", () => {
    test("gate paused: 503 with maintenance message, before auth/body — no auth, no insert", async () => {
      mockIsEnqueueWritePaused.mockResolvedValue(true);

      const response = await message.fetch(
        makePostRequest({ message: "hi" }, { "x-gotify-key": "Aapp-token" }),
        mockEnv,
        mockExecutionCtx
      );

      expect(response.status).toBe(503);
      await expect(response.json()).resolves.toEqual({
        error: "Service Unavailable",
        errorCode: 503,
        errorDescription: "Message creation is paused for deployment maintenance (enqueue write gate)",
      });

      expect(mockRequireApp).not.toHaveBeenCalled();
      expect(mockRequireClient).not.toHaveBeenCalled();
      expect(mockAuthenticate).not.toHaveBeenCalled();
      expect(mockAuthenticateBasic).not.toHaveBeenCalled();
      expect(mockDrizzle.insert).not.toHaveBeenCalled();
      expect(mockIsEnqueueWritePaused).toHaveBeenCalledTimes(1);
      expect(mockIsEnqueueWritePaused).toHaveBeenCalledWith(mockDrizzle);
    });

    test("gate open: representative happy path unaffected, gate consulted once", async () => {
      mockRequireApp.mockResolvedValue({ userId: 1, resourceId: 5, tokenType: "app", isAdmin: false });

      const response = await message.fetch(
        makePostRequest({ message: "hi" }, { "x-gotify-key": "Aapp-token" }),
        mockEnv,
        mockExecutionCtx
      );

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toMatchObject({ id: 42, appid: 5, message: "hi" });
      expect(mockIsEnqueueWritePaused).toHaveBeenCalledTimes(1);
      expect(mockInsertCalls[0]).toMatchObject({ appid: 5, userid: 1, message: "hi" });
    });
  });
});
