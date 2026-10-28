jest.mock('file-type', () => ({
  fileTypeFromBuffer: jest.fn()
}), { virtual: true })

import { PluginHandlers } from "../../src/handlers/pluginHandlers";
import { register } from "../../src/plugins/registry";
import { registerPluginTask } from "../../src/plugins/jobs/registry";

const EVENT_MODULE = 'test/plugin-handler-event'
const TASK_MODULE = 'test/plugin-handler-task'
register(EVENT_MODULE, ({ id, name }) => ({
  id,
  name,
  capabilities: ['test'],
  configExample: 'event: true',
  init() {}
}))
registerPluginTask({
  modulePath: TASK_MODULE,
  supportedSubjectTypes: ['message'],
  createTask: async () => ({ run: async () => ({ ok: true as const }) })
})

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
          modulePath: TASK_MODULE,
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
    expect(data[0].modulePath).toBe(TASK_MODULE);
  });

  test("getPluginConfig returns YAML with correct content type", async () => {
    const drizzle = createDrizzleMock({

      selectGetResults: [
        { modulePath: TASK_MODULE },
        {
          configYaml: "delay: 1000\ntarget_url: http://localhost:8080\n"
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
        { id: 1, modulePath: EVENT_MODULE }
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
        { id: 1, modulePath: TASK_MODULE }
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
        { id: 1, modulePath: TASK_MODULE }
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
          modulePath: EVENT_MODULE,
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

describe("PluginHandlers unknown module availability guard", () => {

  const GHOST_MODULE = "test/ghost-module";

  test("getAllPlugins marks known module available and ghost module unavailable without configExample factory", async () => {
    const drizzle = createDrizzleMock({
      orderByResults: [[
        {
          id: 1,
          userId: 7,
          name: "Known",
          token: "P1",
          modulePath: EVENT_MODULE,
          enabled: 1,
          icon: null,
          configYaml: ""
        },
        {
          id: 2,
          userId: 7,
          name: "Ghost",
          token: "P2",
          modulePath: GHOST_MODULE,
          enabled: 1,
          icon: null,
          configYaml: "apiKey: sk-live-legacy\n"
        }
      ]]
    });
    const pluginHandlers = new PluginHandlers(drizzle as any);
    const configExampleSpy = jest
      .spyOn(pluginHandlers as any, "getConfigExample")
      .mockResolvedValue("known-example");

    const response = await pluginHandlers.getAllPlugins(7, true);
    const data = await response.json() as any[];

    expect(response.status).toBe(200);
    expect(data).toHaveLength(2);
    expect(data[0]).toMatchObject({ modulePath: EVENT_MODULE, availability: "available" });
    expect(data[0].configExample).toBe("known-example");

    expect(data[1]).toMatchObject({ modulePath: GHOST_MODULE, availability: "unavailable" });
    expect(data[1].configExample).toBe("");
    expect(configExampleSpy).toHaveBeenCalledTimes(1);
    expect(configExampleSpy).toHaveBeenCalledWith(EVENT_MODULE);
  });

  test("getPluginConfig returns 409 plugin-unavailable for ghost module before reading config", async () => {
    const drizzle = createDrizzleMock({
      selectGetResults: [{ modulePath: GHOST_MODULE }]
    });
    const pluginHandlers = new PluginHandlers(drizzle as any);

    const response = await pluginHandlers.getPluginConfig(7, "1", true);
    const data = await response.json() as any;

    expect(response.status).toBe(409);
    expect(data.errorCode).toBe("plugin-unavailable");
    expect(JSON.stringify(data)).not.toContain("sk-live");

    expect(drizzle.__selectGet).toHaveBeenCalledTimes(1);
  });

  test("updatePluginConfig returns 409 plugin-unavailable for ghost module without writing", async () => {
    const drizzle = createDrizzleMock({
      selectGetResults: [{ id: 1, modulePath: GHOST_MODULE }]
    });
    const pluginHandlers = new PluginHandlers(drizzle as any);

    const request = new Request("http://localhost/plugin/1/config", {
      method: "POST",
      headers: { "content-type": "application/x-yaml" },
      body: "apiKey: sk-live-rotate\n"
    });
    const response = await pluginHandlers.updatePluginConfig(7, "1", request, true);
    const data = await response.json() as any;

    expect(response.status).toBe(409);
    expect(data.errorCode).toBe("plugin-unavailable");
    expect(drizzle.update).not.toHaveBeenCalled();
  });

  test("enablePlugin returns 409 plugin-unavailable for ghost module", async () => {
    const drizzle = createDrizzleMock({
      selectGetResults: [{ id: 1, modulePath: GHOST_MODULE }]
    });
    const pluginHandlers = new PluginHandlers(drizzle as any);

    const response = await pluginHandlers.enablePlugin(7, "1", true);
    const data = await response.json() as any;

    expect(response.status).toBe(409);
    expect(data.errorCode).toBe("plugin-unavailable");
    expect(drizzle.update).not.toHaveBeenCalled();
  });

  test("disablePlugin stays available for ghost module", async () => {
    const drizzle = createDrizzleMock({
      selectGetResults: [{ id: 1, modulePath: GHOST_MODULE }]
    });
    const pluginHandlers = new PluginHandlers(drizzle as any);

    const response = await pluginHandlers.disablePlugin(7, "1", true);

    expect(response.status).toBe(200);
    expect(drizzle.update).toHaveBeenCalled();
  });

  test("getPluginDisplay returns 409 plugin-unavailable for enabled ghost module", async () => {
    const drizzle = createDrizzleMock({
      selectGetResults: [{ id: 1, name: "Ghost", modulePath: GHOST_MODULE, enabled: 1 }]
    });
    const pluginHandlers = new PluginHandlers(drizzle as any);

    const response = await pluginHandlers.getPluginDisplay(7, "1");
    const data = await response.json() as any;

    expect(response.status).toBe(409);
    expect(data.errorCode).toBe("plugin-unavailable");
    expect(drizzle.__selectGet).toHaveBeenCalledTimes(1);
  });
});
