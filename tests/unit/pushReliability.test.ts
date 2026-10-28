import { PushOutboxService } from "../../src/services/push/outboxService";
import { consumePushQueueBatch } from "../../src/services/push/queueConsumer";
import { CleanupService } from "../../src/services/cleanupService";
import { DEFAULT_PUSH_DELIVERY_POLICY } from "../../src/services/push/contracts";

function makeBatchMessage(body: any) {
  return { body, ack: jest.fn(), retry: jest.fn() };
}





function makeResolver(
  provider: any | null,
  policy: any = { ...DEFAULT_PUSH_DELIVERY_POLICY },
  resolution?: "ready" | "disabled" | "init-failed" | "unregistered"
) {
  const status = resolution ?? (provider ? "ready" : "disabled");
  return {
    get: jest.fn().mockReturnValue(provider),
    getPolicy: jest.fn().mockReturnValue(status === "unregistered" ? null : policy),


    resolve: jest.fn().mockImplementation((platform: string) => {
      const nameMismatch =
        provider && typeof provider.name === "string" && provider.name !== platform;
      if (status === "unregistered" || nameMismatch) {
        return { status: "unregistered", provider: null, policy: null };
      }
      return status === "ready"
        ? { status: "ready", provider, policy }
        : { status, provider: null, policy };
    }),
  };
}

function makeOutboxStub(overrides: any = {}) {
  return {
    getJobById: jest.fn().mockResolvedValue({

      id: 1, userId: 1, messageId: 1, platform: "huawei", clientId: null,
      payloadJson: JSON.stringify({
        deviceToken: "t", message: "m", platform: "huawei",
        messageId: 1, appid: 1, date: "2026-09-02T00:00:00Z",
      }),
      status: "pending", attemptCount: 0, nextRetryAt: null,
      lastError: null, createdAt: null, updatedAt: null,
    }),
    markProcessing: jest.fn().mockResolvedValue('lease-1'),
    getPushTargetByClientId: jest.fn().mockResolvedValue({
      kind: "ready", clientId: 1, platform: "huawei",
      deviceToken: "t", tokenUpdatedAt: "2026-09-24T00:00:00.000Z", tokenStatus: "active",
    }),
    markSuccess: jest.fn(),
    scheduleRetry: jest.fn().mockResolvedValue(true),
    markDead: jest.fn().mockResolvedValue(true),
    suspend: jest.fn(),
    ...overrides,
  };
}

function expectClaimedCall(mock: jest.Mock, ...expected: unknown[]) {
  expect(mock).toHaveBeenCalledWith(...expected, "lease-1");
}

describe("provider 缺失/占位 → 挂起而非永久死信（queueConsumer）", () => {
  test("disabled（get 为 null、resolve=disabled）时 suspend（回 pending + 未来重试 + 不计尝试次数），不 markDead", async () => {
    const outbox = makeOutboxStub();
    const providers = makeResolver(null);
    const batch = { messages: [makeBatchMessage({ outboxId: 1, traceId: "t", attempt: 0, enqueueAt: new Date().toISOString() })] } as any;
    await consumePushQueueBatch(batch, { outbox, providers, queue: { sendBatch: jest.fn() } } as any);
    expect(providers.resolve).toHaveBeenCalledWith("huawei");
    expect(outbox.suspend).toHaveBeenCalledWith(
      1,
      expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
      expect.stringContaining("no provider for platform huawei"),
      "lease-1"
    );
    expect(outbox.markDead).not.toHaveBeenCalled();
    expect(batch.messages[0].ack).toHaveBeenCalled();
  });

  test("unregistered（平台未注册，插件包已删除）→ markDead Undeliverable，不挂起", async () => {
    const outbox = makeOutboxStub();
    const providers = makeResolver(null, undefined, "unregistered");
    const batch = { messages: [makeBatchMessage({ outboxId: 1, traceId: "t", attempt: 0, enqueueAt: new Date().toISOString() })] } as any;
    await consumePushQueueBatch(batch, { outbox, providers, queue: { sendBatch: jest.fn() } } as any);
    expectClaimedCall(outbox.markDead,1, 0, "Undeliverable: no provider for platform huawei");
    expect(outbox.suspend).not.toHaveBeenCalled();
    expect(batch.messages[0].ack).toHaveBeenCalled();
  });

  test("init-failed（装配失败降级）→ suspend 等待修复，不 markDead", async () => {
    const outbox = makeOutboxStub();
    const providers = makeResolver(null, undefined, "init-failed");
    const batch = { messages: [makeBatchMessage({ outboxId: 1, traceId: "t", attempt: 0, enqueueAt: new Date().toISOString() })] } as any;
    await consumePushQueueBatch(batch, { outbox, providers, queue: { sendBatch: jest.fn() } } as any);
    expect(outbox.suspend).toHaveBeenCalledWith(
      1,
      expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
      expect.stringContaining("no provider for platform huawei"),
      "lease-1"
    );
    expect(outbox.markDead).not.toHaveBeenCalled();
  });

  test("FIXTURE_NOT_IMPLEMENTED → markDead（占位 provider 属永久状态，不挂起）", async () => {
    const outbox = makeOutboxStub();
    const providers = makeResolver({
      send: jest.fn().mockResolvedValue({ ok: false, retriable: false, errorCode: "FIXTURE_NOT_IMPLEMENTED" }),
    });
    const batch = { messages: [makeBatchMessage({ outboxId: 1, traceId: "t", attempt: 0, enqueueAt: new Date().toISOString() })] } as any;
    await consumePushQueueBatch(batch, { outbox, providers, queue: { sendBatch: jest.fn() } } as any);
    expectClaimedCall(outbox.markDead,1, 1, "FIXTURE_NOT_IMPLEMENTED");
    expect(outbox.suspend).not.toHaveBeenCalled();
  });

  test("failureKind suspend → suspend（即便 retriable=false）", async () => {
    const outbox = makeOutboxStub();
    const providers = makeResolver({
      send: jest.fn().mockResolvedValue({ ok: false, retriable: false, failureKind: "suspend", errorCode: "FIXTURE_CONFIG_MISSING", errorMessage: "config missing" }),
    });
    const batch = { messages: [makeBatchMessage({ outboxId: 1, traceId: "t", attempt: 0, enqueueAt: new Date().toISOString() })] } as any;
    await consumePushQueueBatch(batch, { outbox, providers, queue: { sendBatch: jest.fn() } } as any);
    expect(outbox.suspend).toHaveBeenCalled();
    expect(outbox.markDead).not.toHaveBeenCalled();
  });

  test("普通可重试失败仍走 scheduleRetry（回归保护）", async () => {
    const outbox = makeOutboxStub();
    const providers = makeResolver(
      {
        send: jest.fn().mockResolvedValue({ ok: false, retriable: true, errorMessage: "503" }),
      },
      { maxRetries: 3, retryBackoffMs: 1000 }
    );
    const queue = { sendBatch: jest.fn().mockResolvedValue(undefined) };
    const batch = { messages: [makeBatchMessage({ outboxId: 1, traceId: "t", attempt: 0, enqueueAt: new Date().toISOString() })] } as any;
    await consumePushQueueBatch(batch, { outbox, providers, queue } as any);
    expect(outbox.scheduleRetry).toHaveBeenCalled();
    expect(outbox.suspend).not.toHaveBeenCalled();
  });

  test("载荷损坏仍直接 dead（不可恢复，非挂起场景）", async () => {
    const outbox = makeOutboxStub({
      getJobById: jest.fn().mockResolvedValue({
        id: 1, userId: 1, messageId: 1, platform: "huawei", clientId: null,
        payloadJson: "not-json", status: "pending", attemptCount: 0,
        nextRetryAt: null, lastError: null, createdAt: null, updatedAt: null,
      }),
    });
    const providers = makeResolver({ send: jest.fn() });
    const batch = { messages: [makeBatchMessage({ outboxId: 1, traceId: "t", attempt: 0, enqueueAt: new Date().toISOString() })] } as any;
    await consumePushQueueBatch(batch, { outbox, providers, queue: { sendBatch: jest.fn() } } as any);
    expectClaimedCall(outbox.markDead,1, 1, "Invalid outbox payload");
  });
});

describe("enqueueForUserDevices 共享入队可用性检查", () => {
  function makeEnqueueDrizzle() {
    return {
      select: jest.fn(() => ({
        from: jest.fn(() => ({
          where: jest.fn().mockResolvedValue([{ id: 1, deviceToken: "token-1" }])
        }))
      })),
      all: jest.fn().mockResolvedValue([{ id: 11 }])
    };
  }

  const input = {
    userId: 7,
    messageId: 100,
    appid: 42,
    date: "2026-10-19T12:00:00.000Z",
    platform: "huawei",
    title: "hello",
    message: "world"
  };

  test("ready → accepted，走既有幂等插入", async () => {
    const drizzle = makeEnqueueDrizzle();
    const providers = makeResolver({ name: "huawei", send: jest.fn() });
    const result = await new PushOutboxService(drizzle as any).enqueueForUserDevices(input, providers as any);

    expect(result).toEqual({ status: "accepted", count: 1, outboxIds: [11] });
    expect(drizzle.all).toHaveBeenCalledTimes(1);
  });

  test.each([
    ["disabled", "disabled"],
    ["init-failed", "init-failed"],
    ["unregistered", "unregistered"]
  ])("%s → unavailable 且不查询设备、不插入行", async (_name, status) => {
    const drizzle = makeEnqueueDrizzle();
    const providers = makeResolver(null, undefined, status as never);
    const result = await new PushOutboxService(drizzle as any).enqueueForUserDevices(input, providers as any);

    expect(result).toEqual({ status: "unavailable", reason: status });
    expect(drizzle.select).not.toHaveBeenCalled();
    expect(drizzle.all).not.toHaveBeenCalled();
  });

  test("web/unknown 等未注册平台不产生厂商 outbox（unregistered 语义）", async () => {
    const drizzle = makeEnqueueDrizzle();
    const providers = makeResolver({ name: "huawei", send: jest.fn() });
    const result = await new PushOutboxService(drizzle as any).enqueueForUserDevices(
      { ...input, platform: "web" },
      providers as any
    );

    expect(result).toEqual({ status: "unavailable", reason: "unregistered" });
    expect(drizzle.select).not.toHaveBeenCalled();
  });
});

describe("outboxService.reclaimStaleProcessing", () => {
  test("UPDATE 置回 pending 且 lastError 标注回收，返回行数", async () => {
    const state: any = { setPayload: null };
    const drizzle = {
      update: jest.fn(() => ({
        set: jest.fn((payload: any) => {
          state.setPayload = payload;
          return {
            where: jest.fn(() => Promise.resolve({ meta: { changes: 2 } })),
          };
        }),
      })),
    };
    const svc = new PushOutboxService(drizzle as any);
    const count = await svc.reclaimStaleProcessing(10 * 60 * 1000);
    expect(count).toBe(2);
    expect(state.setPayload.status).toBe("pending");
    expect(state.setPayload.lastError).toContain("Reclaimed");
  });
});

describe("cleanupService.cleanupPushOutbox", () => {
  test("仅清理终态（success/dead）且按参数化天数", async () => {
    const prepare = jest.fn().mockReturnThis();
    const bind = jest.fn().mockReturnThis();
    const run = jest.fn().mockResolvedValue({ meta: { changes: 5 } });
    const db = { prepare, bind, run } as any;
    const svc = new CleanupService(db);
    const result = await svc.cleanupPushOutbox(30);
    expect(result.success).toBe(true);
    expect(result.deletedCount).toBe(5);
    expect(prepare.mock.calls[0][0]).toContain("status IN ('success', 'dead')");
    expect(bind).toHaveBeenCalledWith("30");
  });

  test("执行出错时返回 success:false 而非抛出", async () => {
    const db = {
      prepare: jest.fn().mockReturnThis(),
      bind: jest.fn().mockReturnThis(),
      run: jest.fn().mockRejectedValue(new Error("D1 down")),
    } as any;
    const svc = new CleanupService(db);
    const result = await svc.cleanupPushOutbox(30);
    expect(result.success).toBe(false);
    expect(result.deletedCount).toBe(0);
    expect(result.error).toContain("D1 down");
  });
});
