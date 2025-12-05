/**
 * Integration tests for Plugin API
 * These tests verify that all plugin endpoints work correctly
 *
 * To run these tests, you need to:
 * 1. Apply the migration: wrangler d1 execute woe_db --file=migrations/0003_create_plugin_configs_table.sql
 * 2. Ensure you have an admin user and valid token
 * 3. Run the tests: npm test
 */

import { PluginHandlers } from "../../src/handlers/pluginHandlers";

// Mock D1 Database for testing
const createMockDb = () => ({
  prepare: jest.fn().mockReturnThis(),
  bind: jest.fn().mockReturnThis(),
  all: jest.fn().mockResolvedValue({ results: [] }),
  first: jest.fn().mockResolvedValue(null),
  run: jest.fn().mockResolvedValue({ changes: 1 }),
});

describe("PluginHandlers", () => {
  let mockDb: any;
  let pluginHandlers: PluginHandlers;

  beforeEach(() => {
    mockDb = createMockDb();
    pluginHandlers = new PluginHandlers(mockDb);
  });

  describe("getAllPlugins", () => {
    it("should return array of plugins for user", async () => {
      mockDb.all.mockResolvedValue({
        results: [{
          id: 1,
          userId: 1,
          name: "Test Plugin",
          token: "P12345",
          modulePath: "test/plugin",
          enabled: 1,
          capabilities: '["webhook"]',
          author: "test",
          license: "MIT",
          website: "https://example.com"
        }]
      });

      const response = await pluginHandlers.getAllPlugins(1);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(Array.isArray(data)).toBe(true);
      expect(data[0].name).toBe("Test Plugin");
      expect(data[0].enabled).toBe(true);
    });
  });

  describe("getPluginConfig", () => {
    it("should return YAML config for plugin", async () => {
      mockDb.first.mockResolvedValue({
        config_yaml: "delay: 1000\ntarget_url: http://localhost:8080\n",
        module_path: "test/plugin"
      });

      const response = await pluginHandlers.getPluginConfig(1, "1");

      expect(response.status).toBe(200);
      expect(response.headers.get("Content-Type")).toContain("application/x-yaml");
    });

    it("should return 404 for non-existent plugin", async () => {
      mockDb.first.mockResolvedValue(null);

      const response = await pluginHandlers.getPluginConfig(1, "999");

      expect(response.status).toBe(404);
    });
  });

  describe("updatePluginConfig", () => {
    it("should update plugin config", async () => {
      mockDb.first.mockResolvedValue({ id: 1 });
      mockDb.run.mockResolvedValue({ changes: 1 });

      const mockRequest = {
        text: jest.fn().mockResolvedValue("delay: 2000\n"),
      } as any;

      const response = await pluginHandlers.updatePluginConfig(1, "1", mockRequest);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data).toEqual({});
    });
  });

  describe("enablePlugin", () => {
    it("should enable a plugin", async () => {
      mockDb.run.mockResolvedValue({ changes: 1 });

      const response = await pluginHandlers.enablePlugin(1, "1");
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data).toEqual({});
    });
  });

  describe("disablePlugin", () => {
    it("should disable a plugin", async () => {
      mockDb.run.mockResolvedValue({ changes: 1 });

      const response = await pluginHandlers.disablePlugin(1, "1");
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data).toEqual({});
    });
  });

  describe("getPluginDisplay", () => {
    it("should return display info for plugin", async () => {
      mockDb.first.mockResolvedValue({
        module_path: "test/plugin",
        enabled: 1,
        config_yaml: "delay: 1000"
      });

      const response = await pluginHandlers.getPluginDisplay(1, "1");
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(typeof data).toBe("string");
      expect(data).toContain("Plugin ID: 1");
    });
  });
});

describe("Plugin API endpoints with YAML support", () => {
  describe("getPluginConfig", () => {
    it("should return YAML content type header", async () => {
      const mockDb = createMockDb();
      mockDb.first.mockResolvedValue({
        config_yaml: "setting: value\nanother: value2\n",
        module_path: "test/plugin"
      });

      const pluginHandlers = new PluginHandlers(mockDb);
      const response = await pluginHandlers.getPluginConfig(1, "1");

      expect(response.headers.get("Content-Type")).toContain("application/x-yaml");
    });
  });
});

export {};
