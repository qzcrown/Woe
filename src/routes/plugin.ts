import { Hono } from "hono";
import { HonoEnv } from "../types/hono.ts";
import { createDrizzle } from "../drizzle/index.ts";
import { Authenticator } from "../middleware/auth.ts";
import { PluginHandlers } from "../handlers/pluginHandlers.ts";
import { ApiResponse } from "../utils/response.ts";

const plugin = new Hono<HonoEnv>();

async function getClientAuth(c: any) {
  const drizzle = createDrizzle(c.env.DB);
  const authenticator = new Authenticator(drizzle);
  const pluginHandlers = new PluginHandlers(drizzle);

  const basicAuthUser = await authenticator.authenticateBasic(c.req.raw, c.env);
  if (basicAuthUser) {
    return { userId: basicAuthUser.id, isAdmin: basicAuthUser.admin, pluginHandlers };
  }
  const tokenInfo = await authenticator.authenticate(c.req.raw);
  if (!tokenInfo || tokenInfo.tokenType !== "client") {
    return null;
  }
  return { ...tokenInfo, pluginHandlers };
}

// GET /plugin
plugin.get("/", async (c) => {
  const auth = await getClientAuth(c);
  if (!auth) {
    return ApiResponse.error("Unauthorized", 401, "Client token or Basic auth required");
  }
  return await auth.pluginHandlers.getAllPlugins(auth.userId, auth.isAdmin || false);
});

// GET /plugin/:id/config
plugin.get("/:id/config", async (c) => {
  const auth = await getClientAuth(c);
  if (!auth) {
    return ApiResponse.error("Unauthorized", 401, "Client token or Basic auth required");
  }
  const id = c.req.param("id");
  return await auth.pluginHandlers.getPluginConfig(auth.userId, id, auth.isAdmin || false);
});

// POST /plugin/:id/config
plugin.post("/:id/config", async (c) => {
  const auth = await getClientAuth(c);
  if (!auth) {
    return ApiResponse.error("Unauthorized", 401, "Client token or Basic auth required");
  }
  const id = c.req.param("id");
  return await auth.pluginHandlers.updatePluginConfig(auth.userId, id, c.req.raw, auth.isAdmin || false);
});

// POST /plugin/:id/enable
plugin.post("/:id/enable", async (c) => {
  const auth = await getClientAuth(c);
  if (!auth) {
    return ApiResponse.error("Unauthorized", 401, "Client token or Basic auth required");
  }
  const id = c.req.param("id");
  return await auth.pluginHandlers.enablePlugin(auth.userId, id, auth.isAdmin || false);
});

// POST /plugin/:id/disable
plugin.post("/:id/disable", async (c) => {
  const auth = await getClientAuth(c);
  if (!auth) {
    return ApiResponse.error("Unauthorized", 401, "Client token or Basic auth required");
  }
  const id = c.req.param("id");
  return await auth.pluginHandlers.disablePlugin(auth.userId, id, auth.isAdmin || false);
});

// GET /plugin/:id/display
plugin.get("/:id/display", async (c) => {
  const auth = await getClientAuth(c);
  if (!auth) {
    return ApiResponse.error("Unauthorized", 401, "Client token or Basic auth required");
  }
  const id = c.req.param("id");
  return await auth.pluginHandlers.getPluginDisplay(auth.userId, id);
});

// GET /plugin/:id/logs
plugin.get("/:id/logs", async (c) => {
  const auth = await getClientAuth(c);
  if (!auth) {
    return ApiResponse.error("Unauthorized", 401, "Client token or Basic auth required");
  }
  const id = c.req.param("id");
  const url = new URL(c.req.url);
  const limitParam = url.searchParams.get("limit");
  const limit = limitParam ? Math.min(Math.max(parseInt(limitParam), 1), 200) : 50;
  return await auth.pluginHandlers.getPluginLogs(auth.userId, id, limit);
});

// POST /plugin - Create a new plugin instance (admin only)
plugin.post("/", async (c) => {
  const auth = await getClientAuth(c);
  if (!auth) {
    return ApiResponse.error("Unauthorized", 401, "Client token or Basic auth required");
  }
  if (!auth.isAdmin) {
    return ApiResponse.error("Forbidden", 403, "Admin access required");
  }
  return await auth.pluginHandlers.createPlugin(auth.userId, c.req.raw);
});

// DELETE /plugin/:id - Delete a plugin instance (admin only)
plugin.delete("/:id", async (c) => {
  const auth = await getClientAuth(c);
  if (!auth) {
    return ApiResponse.error("Unauthorized", 401, "Client token or Basic auth required");
  }
  if (!auth.isAdmin) {
    return ApiResponse.error("Forbidden", 403, "Admin access required");
  }
  const id = c.req.param("id");
  return await auth.pluginHandlers.deletePlugin(auth.userId, id);
});

// PUT /plugin/:id/name - Update plugin name
plugin.put("/:id/name", async (c) => {
  const auth = await getClientAuth(c);
  if (!auth) {
    return ApiResponse.error("Unauthorized", 401, "Client token or Basic auth required");
  }
  const id = c.req.param("id");
  return await auth.pluginHandlers.updatePluginName(auth.userId, id, c.req.raw, auth.isAdmin || false);
});

// POST /plugin/:id/image - Upload plugin icon
plugin.post("/:id/image", async (c) => {
  const auth = await getClientAuth(c);
  if (!auth) {
    return ApiResponse.error("Unauthorized", 401, "Client token or Basic auth required");
  }
  const id = c.req.param("id");
  return await auth.pluginHandlers.uploadPluginIcon(auth.userId, id, c.req.raw, c.env, auth.isAdmin || false);
});

// DELETE /plugin/:id/image - Delete plugin icon
plugin.delete("/:id/image", async (c) => {
  const auth = await getClientAuth(c);
  if (!auth) {
    return ApiResponse.error("Unauthorized", 401, "Client token or Basic auth required");
  }
  const id = c.req.param("id");
  return await auth.pluginHandlers.deletePluginIcon(auth.userId, id, c.env, auth.isAdmin || false);
});

export { plugin };
