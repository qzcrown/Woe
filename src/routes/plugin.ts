









import { Hono } from "hono";
import { HonoEnv } from "../types/hono.ts";
import { createDrizzle } from "../drizzle/index.ts";
import { Authenticator } from "../middleware/auth.ts";
import { PluginHandlers } from "../handlers/pluginHandlers.ts";
import { ApiResponse } from "../utils/response.ts";
import { validatePositiveIntegerId } from "../utils/routeParams.ts";

const plugin = new Hono<HonoEnv>();


async function getClientAuth(c: any) {
  const drizzle = createDrizzle(c.env.DB);
  const authenticator = new Authenticator(drizzle);
  const pluginHandlers = new PluginHandlers(drizzle, c.env);

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


plugin.get("/available", async (c) => {
  const auth = await getClientAuth(c);
  if (!auth) {
    return ApiResponse.error("Unauthorized", 401, "Client token or Basic auth required");
  }
  if (!auth.isAdmin) {
    return ApiResponse.error("Forbidden", 403, "Admin access required");
  }
  return await auth.pluginHandlers.getAvailablePlugins();
});


plugin.get("/", async (c) => {
  const auth = await getClientAuth(c);
  if (!auth) {
    return ApiResponse.error("Unauthorized", 401, "Client token or Basic auth required");
  }
  return await auth.pluginHandlers.getAllPlugins(auth.userId, auth.isAdmin || false);
});


plugin.get("/:id/config", async (c) => {
  const id = c.req.param("id");
  const invalidIdResponse = validatePositiveIntegerId(id);
  if (invalidIdResponse) {
    return invalidIdResponse;
  }

  const auth = await getClientAuth(c);
  if (!auth) {
    return ApiResponse.error("Unauthorized", 401, "Client token or Basic auth required");
  }
  return await auth.pluginHandlers.getPluginConfig(auth.userId, id, auth.isAdmin || false);
});


plugin.post("/:id/config", async (c) => {
  const id = c.req.param("id");
  const invalidIdResponse = validatePositiveIntegerId(id);
  if (invalidIdResponse) {
    return invalidIdResponse;
  }

  const auth = await getClientAuth(c);
  if (!auth) {
    return ApiResponse.error("Unauthorized", 401, "Client token or Basic auth required");
  }
  return await auth.pluginHandlers.updatePluginConfig(auth.userId, id, c.req.raw, auth.isAdmin || false);
});


plugin.post("/:id/enable", async (c) => {
  const id = c.req.param("id");
  const invalidIdResponse = validatePositiveIntegerId(id);
  if (invalidIdResponse) {
    return invalidIdResponse;
  }

  const auth = await getClientAuth(c);
  if (!auth) {
    return ApiResponse.error("Unauthorized", 401, "Client token or Basic auth required");
  }
  return await auth.pluginHandlers.enablePlugin(auth.userId, id, auth.isAdmin || false);
});


plugin.post("/:id/disable", async (c) => {
  const id = c.req.param("id");
  const invalidIdResponse = validatePositiveIntegerId(id);
  if (invalidIdResponse) {
    return invalidIdResponse;
  }

  const auth = await getClientAuth(c);
  if (!auth) {
    return ApiResponse.error("Unauthorized", 401, "Client token or Basic auth required");
  }
  return await auth.pluginHandlers.disablePlugin(auth.userId, id, auth.isAdmin || false);
});


plugin.get("/:id/display", async (c) => {
  const id = c.req.param("id");
  const invalidIdResponse = validatePositiveIntegerId(id);
  if (invalidIdResponse) {
    return invalidIdResponse;
  }

  const auth = await getClientAuth(c);
  if (!auth) {
    return ApiResponse.error("Unauthorized", 401, "Client token or Basic auth required");
  }
  return await auth.pluginHandlers.getPluginDisplay(auth.userId, id);
});


plugin.get("/:id/logs", async (c) => {
  const id = c.req.param("id");
  const invalidIdResponse = validatePositiveIntegerId(id);
  if (invalidIdResponse) {
    return invalidIdResponse;
  }

  const auth = await getClientAuth(c);
  if (!auth) {
    return ApiResponse.error("Unauthorized", 401, "Client token or Basic auth required");
  }
  const url = new URL(c.req.url);
  const limitParam = url.searchParams.get("limit");
  const limit = limitParam ? Math.min(Math.max(parseInt(limitParam), 1), 200) : 50;
  return await auth.pluginHandlers.getPluginLogs(auth.userId, id, limit);
});


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


plugin.delete("/:id", async (c) => {
  const id = c.req.param("id");
  const invalidIdResponse = validatePositiveIntegerId(id);
  if (invalidIdResponse) {
    return invalidIdResponse;
  }

  const auth = await getClientAuth(c);
  if (!auth) {
    return ApiResponse.error("Unauthorized", 401, "Client token or Basic auth required");
  }
  if (!auth.isAdmin) {
    return ApiResponse.error("Forbidden", 403, "Admin access required");
  }
  return await auth.pluginHandlers.deletePlugin(id);
});


plugin.put("/:id/name", async (c) => {
  const id = c.req.param("id");
  const invalidIdResponse = validatePositiveIntegerId(id);
  if (invalidIdResponse) {
    return invalidIdResponse;
  }

  const auth = await getClientAuth(c);
  if (!auth) {
    return ApiResponse.error("Unauthorized", 401, "Client token or Basic auth required");
  }
  return await auth.pluginHandlers.updatePluginName(auth.userId, id, c.req.raw, auth.isAdmin || false);
});


plugin.post("/:id/image", async (c) => {
  const id = c.req.param("id");
  const invalidIdResponse = validatePositiveIntegerId(id);
  if (invalidIdResponse) {
    return invalidIdResponse;
  }

  const auth = await getClientAuth(c);
  if (!auth) {
    return ApiResponse.error("Unauthorized", 401, "Client token or Basic auth required");
  }
  return await auth.pluginHandlers.uploadPluginIcon(auth.userId, id, c.req.raw, c.env, auth.isAdmin || false);
});


plugin.delete("/:id/image", async (c) => {
  const id = c.req.param("id");
  const invalidIdResponse = validatePositiveIntegerId(id);
  if (invalidIdResponse) {
    return invalidIdResponse;
  }

  const auth = await getClientAuth(c);
  if (!auth) {
    return ApiResponse.error("Unauthorized", 401, "Client token or Basic auth required");
  }
  return await auth.pluginHandlers.deletePluginIcon(auth.userId, id, c.env, auth.isAdmin || false);
});

export { plugin };
