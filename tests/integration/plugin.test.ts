jest.mock('file-type', () => ({
  fileTypeFromBuffer: jest.fn()
}), { virtual: true })

import { PluginHandlers } from "../../src/handlers/pluginHandlers";

function createDrizzleMock(options: {
  selectGetResults?: unknown[];
  orderByResults?: unknown[];
} = {}) {
  const selectGet = jest.fn();
  for (const result of options.selectGetResults ?? []) {
    selectGet.mockResolvedValueOnce(result);
  }

  const orderBy = jest.fn();
  for (const result of options.orderByResults ?? []) {
    orderBy.mockResolvedValueOnce(result);
  }

  return {
    select: jest.fn(() => ({
      from: jest.fn(() => ({
        where: jest.fn(() => ({
          get: selectGet,
          orderBy
        }))
      }))
    })),
    update: jest.fn(() => ({
      set: jest.fn(() => ({
        where: jest.fn().mockResolvedValue({ meta: { changes: 1 } })
      }))
    })),
    __selectGet: selectGet,
    __orderBy: orderBy
  };
}

describe("PluginHandlers", () => {
  test("getAllPlugins returns mapped plugin list for admin", async () => {
    const drizzle = createDrizzleMock({
      orderByResults: [[
        {
          id: 1,
          userId: 1,
          name: "Test Plugin",
          token: "P12345",
          modulePath: "builtin/webhooker",
          enabled: 1,
          icon: null,
          configYaml: ""
        }
      ]]
    });
    const pluginHandlers = new PluginHandlers(drizzle as any);

    const response = await pluginHandlers.getAllPlugins(1, true);
    const data = await response.json() as any[];

    expect(response.status).toBe(200);
    expect(data).toHaveLength(1);
    expect(data[0].name).toBe("Test Plugin");
    expect(data[0].enabled).toBe(true);
    expect(data[0].modulePath).toBe("builtin/webhooker");
  });

  test("getPluginConfig returns YAML with correct content type", async () => {
    const drizzle = createDrizzleMock({
      selectGetResults: [
        {
          configYaml: "delay: 1000\ntarget_url: http://localhost:8080\n",
          modulePath: "builtin/webhooker"
        }
      ]
    });
    const pluginHandlers = new PluginHandlers(drizzle as any);

    const response = await pluginHandlers.getPluginConfig(1, "1", true);

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toContain("application/x-yaml");
    await expect(response.text()).resolves.toContain("delay: 1000");
  });

  test("updatePluginConfig stores YAML when content type is correct", async () => {


    const drizzle = createDrizzleMock({
      selectGetResults: [
        { id: 1, modulePath: "builtin/displayer" }
      ]
    });
    const pluginHandlers = new PluginHandlers(drizzle as any);

    const request = new Request("http://localhost/plugin/1/config", {
      method: "POST",
      headers: { "content-type": "application/x-yaml" },
      body: "delay: 2000\n"
    });

    const response = await pluginHandlers.updatePluginConfig(1, "1", request, true);
    const data = await response.json() as Record<string, never>;

    expect(response.status).toBe(200);
    expect(data).toEqual({});
    expect(drizzle.update).toHaveBeenCalled();
  });

  test("enablePlugin enables a plugin for admin", async () => {
    const drizzle = createDrizzleMock({
      selectGetResults: [
        { id: 1, modulePath: "builtin/webhooker" }
      ]
    });
    const pluginHandlers = new PluginHandlers(drizzle as any);

    const response = await pluginHandlers.enablePlugin(1, "1", true);
    const data = await response.json() as Record<string, never>;

    expect(response.status).toBe(200);
    expect(data).toEqual({});
    expect(drizzle.update).toHaveBeenCalled();
  });

  test("disablePlugin disables a plugin for admin", async () => {
    const drizzle = createDrizzleMock({
      selectGetResults: [
        { id: 1, modulePath: "builtin/webhooker" }
      ]
    });
    const pluginHandlers = new PluginHandlers(drizzle as any);

    const response = await pluginHandlers.disablePlugin(1, "1", true);
    const data = await response.json() as Record<string, never>;

    expect(response.status).toBe(200);
    expect(data).toEqual({});
    expect(drizzle.update).toHaveBeenCalled();
  });

  test("getPluginDisplay returns 403 for disabled plugin", async () => {
    const drizzle = createDrizzleMock({
      selectGetResults: [
        {
          id: 1,
          name: "Test Plugin",
          modulePath: "builtin/displayer",
          enabled: 0,
          configYaml: ""
        }
      ]
    });
    const pluginHandlers = new PluginHandlers(drizzle as any);

    const response = await pluginHandlers.getPluginDisplay(1, "1");
    const data = await response.json() as { errorCode: number };

    expect(response.status).toBe(403);
    expect(data.errorCode).toBe(403);
  });
});
