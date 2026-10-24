import { authenticateMessageCreate, resolveMessageCreateTarget } from "../../src/handlers/messageHandlers";

function makeAuthenticator(overrides: { app?: any | null; client?: any | null }) {
  return {
    requireApp: jest.fn().mockResolvedValue(overrides.app ?? null),
    requireClient: jest.fn().mockResolvedValue(overrides.client ?? null),
  } as any;
}

function makeDrizzleWithApp(app: any | null) {
  return {
    select: jest.fn(() => ({
      from: jest.fn(() => ({
        where: jest.fn(() => ({
          get: jest.fn().mockResolvedValue(app),
        })),
      })),
    })),
  } as any;
}

const fakeRequest = new Request("https://woe.example/message", { method: "POST" });
const fakeEnv = {} as any;

describe("authenticateMessageCreate（先认证后绑定：只读凭据，不触 body）", () => {
  test("app token → { kind:'app' }，requireClient 不再调用", async () => {
    const auth = makeAuthenticator({ app: { userId: 1, resourceId: 5, tokenType: "app", isAdmin: false } });
    const result = await authenticateMessageCreate(auth, fakeRequest, fakeEnv);
    expect(result).toEqual({ kind: "app", appId: 5, userId: 1 });
    expect(auth.requireClient).not.toHaveBeenCalled();
  });

  test("client token → { kind:'client', userId }", async () => {
    const auth = makeAuthenticator({ client: { userId: 7, tokenType: "client", isAdmin: false } });
    const result = await authenticateMessageCreate(auth, fakeRequest, fakeEnv);
    expect(result).toEqual({ kind: "client", userId: 7 });
  });

  test("无任何有效认证 → 401 gotify 逐字文案", async () => {
    const auth = makeAuthenticator({});
    const result = await authenticateMessageCreate(auth, fakeRequest, fakeEnv);
    expect(result).toBeInstanceOf(Response);
    await expect((result as Response).json()).resolves.toEqual({
      error: "Unauthorized",
      errorCode: 401,
      errorDescription: "Application token, client token or Basic auth required",
    });
  });

  test("app token 真值但 resourceId 缺失 → 落入 client 分支，无有效认证 → 401", async () => {
    const auth = makeAuthenticator({ app: { userId: 1, tokenType: "app", isAdmin: false } });
    const result = await authenticateMessageCreate(auth, fakeRequest, fakeEnv);
    expect(result).toBeInstanceOf(Response);
    expect((result as Response).status).toBe(401);
    expect(auth.requireClient).toHaveBeenCalled();
  });
});

describe("resolveMessageCreateTarget（认证后，对齐 gotify api/message.go:357-371）", () => {
  test("app token：应用取自 token，忽略 body.appid，不查应用表", async () => {
    const drizzle = makeDrizzleWithApp({ id: 999, userId: 2 });
    const result = await resolveMessageCreateTarget(
      { kind: "app", appId: 5, userId: 1 },
      drizzle,
      { appid: 999 }
    );
    expect(result).toEqual({ appId: 5, userId: 1 });
    expect(drizzle.select).not.toHaveBeenCalled();
  });

  test("client token：无 appid → 400（gotify 逐字文案）", async () => {
    const result = await resolveMessageCreateTarget(
      { kind: "client", userId: 7 },
      makeDrizzleWithApp(null),
      {}
    );
    expect(result).toBeInstanceOf(Response);
    expect((result as Response).status).toBe(400);
    await expect((result as Response).json()).resolves.toEqual({
      error: "Bad Request",
      errorCode: 400,
      errorDescription: "appid is required when not authenticating with an application token",
    });
  });

  test("client token：appid 属于他人 → 400 appid not found", async () => {
    const drizzle = makeDrizzleWithApp({ id: 9, userId: 8 });
    const result = await resolveMessageCreateTarget({ kind: "client", userId: 7 }, drizzle, { appid: 9 });
    expect((result as Response).status).toBe(400);
    await expect((result as Response).json()).resolves.toMatchObject({ errorDescription: "appid not found" });
  });

  test("client token：appid 非法（0/字符串/负数/小数）→ 400", async () => {
    for (const bad of [0, -1, "3", 1.5]) {
      const result = await resolveMessageCreateTarget(
        { kind: "client", userId: 7 },
        makeDrizzleWithApp(null),
        { appid: bad as any }
      );
      expect((result as Response).status).toBe(400);
    }
  });

  test("client token：appid 属于本人 → 解析成功", async () => {
    const drizzle = makeDrizzleWithApp({ id: 9, userId: 7 });
    const result = await resolveMessageCreateTarget({ kind: "client", userId: 7 }, drizzle, { appid: 9 });
    expect(result).toEqual({ appId: 9, userId: 7 });
  });
});
