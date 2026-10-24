jest.mock("file-type", () => ({
  fileTypeFromBuffer: jest.fn()
}), { virtual: true });

const mockResolve = jest.fn();

jest.mock("../../src/plugins/registry.ts", () => ({
  resolve: (...args: unknown[]) => mockResolve(...args)
}));

import { PluginHandlers } from "../../src/handlers/pluginHandlers";

function createDisplayDrizzleMock(pluginRow: Record<string, unknown> | null) {
  const getMock = jest.fn().mockResolvedValue(pluginRow);
  const whereMock = jest.fn().mockReturnValue({ get: getMock });
  const fromMock = jest.fn().mockReturnValue({ where: whereMock });
  const selectMock = jest.fn().mockReturnValue({ from: fromMock });

  return {
    select: selectMock
  } as any;
}

describe("PluginHandlers display contract", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("returns 403 when plugin is disabled", async () => {
    const drizzle = createDisplayDrizzleMock({
      id: 1,
      name: "Displayer",
      modulePath: "builtin/displayer",
      enabled: 0,
      configYaml: ""
    });
    const handlers = new PluginHandlers(drizzle);

    const response = await handlers.getPluginDisplay(7, "1");
    const body = await response.json() as { errorCode: number };

    expect(response.status).toBe(403);
    expect(body.errorCode).toBe(403);
  });

  test("returns JSON string empty when plugin has no renderDisplay", async () => {
    const drizzle = createDisplayDrizzleMock({
      id: 2,
      name: "Webhooker",
      modulePath: "builtin/webhooker",
      enabled: 1,
      configYaml: ""
    });
    mockResolve.mockReturnValue({
      init: jest.fn()
    });
    const handlers = new PluginHandlers(drizzle);

    const response = await handlers.getPluginDisplay(7, "2");
    const body = await response.json() as string;

    expect(response.status).toBe(200);
    expect(body).toBe("");
  });

  test("returns rendered string when plugin supports display", async () => {
    const drizzle = createDisplayDrizzleMock({
      id: 3,
      name: "Displayer",
      modulePath: "builtin/displayer",
      enabled: 1,
      configYaml: "showTitle: true"
    });
    const initMock = jest.fn();
    const renderDisplayMock = jest.fn().mockResolvedValue("rendered-content");
    mockResolve.mockReturnValue({
      init: initMock,
      renderDisplay: renderDisplayMock
    });
    const handlers = new PluginHandlers(drizzle);

    const response = await handlers.getPluginDisplay(7, "3");
    const body = await response.json() as string;

    expect(response.status).toBe(200);
    expect(body).toBe("rendered-content");
    expect(initMock).toHaveBeenCalledTimes(1);
    expect(renderDisplayMock).toHaveBeenCalledTimes(1);
  });

  test("returns 500 when renderDisplay throws", async () => {
    const drizzle = createDisplayDrizzleMock({
      id: 4,
      name: "Broken Displayer",
      modulePath: "builtin/displayer",
      enabled: 1,
      configYaml: ""
    });
    mockResolve.mockReturnValue({
      init: jest.fn(),
      renderDisplay: jest.fn().mockRejectedValue(new Error("boom"))
    });
    const handlers = new PluginHandlers(drizzle);

    const response = await handlers.getPluginDisplay(7, "4");
    const body = await response.json() as { errorCode: number };

    expect(response.status).toBe(500);
    expect(body.errorCode).toBe(500);
  });
});
