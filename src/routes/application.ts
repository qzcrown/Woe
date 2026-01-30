import { Hono } from "hono";
import { HonoEnv } from "../types/hono.ts";
import { createDrizzle } from "../drizzle/index.ts";
import { Authenticator } from "../middleware/auth.ts";
import { ApplicationHandlers } from "../handlers/applicationHandlers.ts";
import { MessageHandlers } from "../handlers/messageHandlers.ts";
import { ApiResponse } from "../utils/response.ts";

const application = new Hono<HonoEnv>();

async function getClientAuth(c: any) {
  const drizzle = createDrizzle(c.env.DB);
  const authenticator = new Authenticator(drizzle);
  const applicationHandlers = new ApplicationHandlers(drizzle);
  const messageHandlers = new MessageHandlers(drizzle);

  const basicAuthUser = await authenticator.authenticateBasic(c.req.raw, c.env);
  if (basicAuthUser) {
    return { 
      userId: basicAuthUser.id, 
      isAdmin: basicAuthUser.admin, 
      tokenType: "client" as const,
      applicationHandlers, 
      messageHandlers,
      basicAuthUser
    };
  }
  const tokenInfo = await authenticator.authenticate(c.req.raw);
  if (!tokenInfo || tokenInfo.tokenType !== "client") {
    return null;
  }
  return { ...tokenInfo, applicationHandlers, messageHandlers, basicAuthUser: null };
}

// GET /application
application.get("/", async (c) => {
  const auth = await getClientAuth(c);
  if (!auth) {
    return ApiResponse.error("Unauthorized", 401, "Client token or Basic auth required");
  }
  return await auth.applicationHandlers.getAllApplications(auth.userId);
});

// POST /application
application.post("/", async (c) => {
  const auth = await getClientAuth(c);
  if (!auth) {
    return ApiResponse.error("Unauthorized", 401, "Client token or Basic auth required");
  }
  const body = (await c.req.json()) as { name: string; description?: string; defaultPriority?: number };
  if (!body.name) {
    return ApiResponse.error("Bad Request", 400, "Missing required field: name is required");
  }
  return await auth.applicationHandlers.createApplication(auth.userId, body.name, body.description, body.defaultPriority);
});

// GET /application/:id
application.get("/:id", async (c) => {
  const auth = await getClientAuth(c);
  if (!auth) {
    return ApiResponse.error("Unauthorized", 401, "Client token or Basic auth required");
  }
  const id = c.req.param("id");
  return await auth.applicationHandlers.getApplication(auth.userId, id);
});

// PUT /application/:id
application.put("/:id", async (c) => {
  const auth = await getClientAuth(c);
  if (!auth) {
    return ApiResponse.error("Unauthorized", 401, "Client token or Basic auth required");
  }
  const id = c.req.param("id");
  const body = (await c.req.json()) as { name?: string; description?: string; defaultPriority?: number };
  return await auth.applicationHandlers.updateApplication(auth.userId, id, body);
});

// DELETE /application/:id
application.delete("/:id", async (c) => {
  const auth = await getClientAuth(c);
  if (!auth) {
    return ApiResponse.error("Unauthorized", 401, "Client token or Basic auth required");
  }
  const id = c.req.param("id");
  return await auth.applicationHandlers.deleteApplication(auth.userId, id);
});

// POST /application/:id/image
application.post("/:id/image", async (c) => {
  const auth = await getClientAuth(c);
  if (!auth) {
    return ApiResponse.error("Unauthorized", 401, "Authentication required");
  }
  const id = c.req.param("id");
  return await auth.applicationHandlers.uploadApplicationImage(auth.userId, id, auth.isAdmin, c.req.raw, c.env);
});

// DELETE /application/:id/image
application.delete("/:id/image", async (c) => {
  const auth = await getClientAuth(c);
  if (!auth) {
    return ApiResponse.error("Unauthorized", 401, "Authentication required");
  }
  const id = c.req.param("id");
  return await auth.applicationHandlers.deleteApplicationImage(auth.userId, id, auth.isAdmin, c.env);
});

// GET /application/:id/message
application.get("/:id/message", async (c) => {
  const auth = await getClientAuth(c);
  if (!auth) {
    return ApiResponse.error("Unauthorized", 401, "Client token or Basic auth required");
  }
  const id = c.req.param("id");
  const url = new URL(c.req.url);
  const limitParam = url.searchParams.get("limit");
  const sinceParam = url.searchParams.get("since");
  const limit = limitParam ? Math.min(Math.max(parseInt(limitParam), 1), 200) : undefined;
  const since = sinceParam ? Math.max(parseInt(sinceParam), 0) : undefined;
  return await auth.messageHandlers.getApplicationMessages(auth.userId, id, limit, since, url.origin);
});

// DELETE /application/:id/message
application.delete("/:id/message", async (c) => {
  const auth = await getClientAuth(c);
  if (!auth) {
    return ApiResponse.error("Unauthorized", 401, "Client token or Basic auth required");
  }
  const id = c.req.param("id");
  return await auth.messageHandlers.deleteApplicationMessages(auth.userId, id);
});

export { application };
