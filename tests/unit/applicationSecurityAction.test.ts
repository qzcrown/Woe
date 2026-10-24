









import { ApplicationHandlers } from "../../src/handlers/applicationHandlers";
import { resolveTokenForLookup } from "../../src/utils/enhancedToken";

jest.mock('file-type', () => ({
  fileTypeFromBuffer: jest.fn()
}), { virtual: true })

function createDrizzleMock(existingApp: any | null, options: { updateChanges?: number } = {}) {
  const state = {
    updatedToken: null as string | null,
    updateCalls: 0,
    selectCalls: 0
  };

  const updateChanges = options.updateChanges ?? (existingApp ? 1 : 0);
  return {
    __state: state,
    select: jest.fn(() => {
      state.selectCalls += 1;
      return {
        from: jest.fn(() => ({
          where: jest.fn(() => ({
            get: jest.fn().mockResolvedValue(existingApp),
          })),
        })),
      };
    }),
    update: jest.fn(() => ({
      set: jest.fn((payload: any) => {
        state.updatedToken = payload.token;
        return {
          where: jest.fn(() => {
            state.updateCalls += 1;
            return Promise.resolve({ meta: { changes: updateChanges } });
          }),
        };
      }),
    })),
  };
}

describe("updateApplicationSecurity 无操作动作（regenerateToken=false）", () => {
  test("属主应用 → 200 {}，不轮换 token、无数据库写入、响应无 token 字段", async () => {
    const drizzle = createDrizzleMock({ id: 9 });
    const handlers = new ApplicationHandlers(drizzle as any);
    const res = await handlers.updateApplicationSecurity(7, "9", false);
    expect(res.status).toBe(200);
    const body = await res.json() as any;

    expect(body).toEqual({});
    expect(Object.keys(body)).toHaveLength(0);

    expect(drizzle.__state.updateCalls).toBe(0);
    expect(drizzle.__state.updatedToken).toBeNull();
  });

  test("无操作不能在查询前提前返回成功：先执行资源/属主查询", async () => {
    const drizzle = createDrizzleMock({ id: 9 });
    const handlers = new ApplicationHandlers(drizzle as any);
    await handlers.updateApplicationSecurity(7, "9", false);
    expect(drizzle.__state.selectCalls).toBe(1);
  });

  test("非属主/不存在 → 404，不轮换", async () => {
    const drizzle = createDrizzleMock(null);
    const handlers = new ApplicationHandlers(drizzle as any);
    const res = await handlers.updateApplicationSecurity(7, "9", false);
    expect(res.status).toBe(404);
    const body = await res.json() as any;
    expect(body.errorDescription).toBe("Application not found or no permission");
    expect(drizzle.__state.updateCalls).toBe(0);
  });

  test("非法 id → 400", async () => {
    const drizzle = createDrizzleMock({ id: 9 });
    const handlers = new ApplicationHandlers(drizzle as any);
    const res = await handlers.updateApplicationSecurity(7, "abc", false);
    expect(res.status).toBe(400);
    const body = await res.json() as any;
    expect(body.errorDescription).toBe("Invalid application ID");
    expect(drizzle.__state.updateCalls).toBe(0);
  });
});

describe("updateApplicationSecurity 轮换动作（regenerateToken=true，行为保持）", () => {
  test("非法 id → 400，不轮换（handler 层 true×非法 ID，与无动作共享同一入口校验）", async () => {
    const drizzle = createDrizzleMock({ id: 9 });
    const handlers = new ApplicationHandlers(drizzle as any);
    const res = await handlers.updateApplicationSecurity(7, "abc", true);
    expect(res.status).toBe(400);
    const body = await res.json() as any;
    expect(body.errorDescription).toBe("Invalid application ID");
    expect(drizzle.__state.updateCalls).toBe(0);
  });

  test("属主应用 → 200 且返回新 token（privateForm 响应、publicForm 入库）", async () => {
    const drizzle = createDrizzleMock({ id: 9 });
    const handlers = new ApplicationHandlers(drizzle as any);
    const res = await handlers.updateApplicationSecurity(7, "9", true);
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body).toEqual({
      regenerateToken: { token: expect.stringMatching(/^gtfya\.[A-Za-z0-9\-_]{43}$/) },
    });
    expect(drizzle.__state.updateCalls).toBe(1);

    expect(drizzle.__state.updatedToken).toMatch(/^gtfya\.[A-Za-z0-9\-_]{43}$/);
    expect(drizzle.__state.updatedToken).not.toBe(body.regenerateToken.token);
    await expect(resolveTokenForLookup(body.regenerateToken.token)).resolves.toBe(drizzle.__state.updatedToken);
  });

  test("非属主/不存在 → 404，不更新（与无操作共享同一属主检查）", async () => {
    const drizzle = createDrizzleMock(null);
    const handlers = new ApplicationHandlers(drizzle as any);
    const res = await handlers.updateApplicationSecurity(7, "9", true);
    expect(res.status).toBe(404);
    expect(drizzle.__state.updateCalls).toBe(0);
  });

  test("并发删除（select 命中但 update changes===0）→ 404", async () => {
    const drizzle = createDrizzleMock({ id: 9 }, { updateChanges: 0 });
    const handlers = new ApplicationHandlers(drizzle as any);
    const res = await handlers.updateApplicationSecurity(7, "9", true);
    expect(res.status).toBe(404);
    const body = await res.json() as any;
    expect(body.errorDescription).toBe("Application not found or no permission");
    expect(drizzle.__state.updateCalls).toBe(1);
  });
});

describe("regenerateApplicationToken 兼容入口复用共享实现", () => {
  test("等价于 updateApplicationSecurity(…, true)：轮换并返回 privateForm", async () => {
    const drizzle = createDrizzleMock({ id: 9 });
    const handlers = new ApplicationHandlers(drizzle as any);
    const res = await handlers.regenerateApplicationToken(7, "9");
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.regenerateToken.token).toMatch(/^gtfya\.[A-Za-z0-9\-_]{43}$/);
    expect(drizzle.__state.updateCalls).toBe(1);
  });

  test("非属主 → 404（共享检查）", async () => {
    const drizzle = createDrizzleMock(null);
    const handlers = new ApplicationHandlers(drizzle as any);
    const res = await handlers.regenerateApplicationToken(7, "9");
    expect(res.status).toBe(404);
    expect(drizzle.__state.updateCalls).toBe(0);
  });
});
