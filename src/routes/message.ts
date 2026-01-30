import { Hono } from "hono";
import { HonoEnv } from "../types/hono.ts";
import { createDrizzle } from "../drizzle/index.ts";
import { Authenticator } from "../middleware/auth.ts";
import { MessageHandlers } from "../handlers/messageHandlers.ts";
import { ApiResponse } from "../utils/response.ts";

const message = new Hono<HonoEnv>();

async function getClientAuth(c: any) {
  const drizzle = createDrizzle(c.env.DB);
  const authenticator = new Authenticator(drizzle);
  const messageHandlers = new MessageHandlers(drizzle);

  const basicAuthUser = await authenticator.authenticateBasic(c.req.raw, c.env);
  if (basicAuthUser) {
    return { userId: basicAuthUser.id, messageHandlers, tokenType: "client" as const };
  }
  const tokenInfo = await authenticator.authenticate(c.req.raw);
  if (!tokenInfo || tokenInfo.tokenType !== "client") {
    return null;
  }
  return { ...tokenInfo, messageHandlers };
}

async function getAppAuth(c: any) {
  const drizzle = createDrizzle(c.env.DB);
  const authenticator = new Authenticator(drizzle);
  const messageHandlers = new MessageHandlers(drizzle);

  const tokenInfo = await authenticator.authenticate(c.req.raw);
  if (!tokenInfo || tokenInfo.tokenType !== "app") {
    return null;
  }
  return { ...tokenInfo, messageHandlers };
}

// GET /message
message.get("/", async (c) => {
  const auth = await getClientAuth(c);
  if (!auth) {
    return ApiResponse.error("Unauthorized", 401, "Client token or Basic auth required");
  }
  const url = new URL(c.req.url);
  const limitParam = url.searchParams.get("limit");
  const sinceParam = url.searchParams.get("since");
  const limit = limitParam ? Math.min(Math.max(parseInt(limitParam), 1), 200) : undefined;
  const since = sinceParam ? Math.max(parseInt(sinceParam), 0) : undefined;
  return await auth.messageHandlers.getAllMessages(auth.userId, limit, since, url.origin);
});

// POST /message (requires app token)
message.post("/", async (c) => {
  const contentType = c.req.header("content-type") || "";
  if (!contentType.includes("application/json")) {
    return ApiResponse.error("Bad Request", 400, "Content-Type must be application/json");
  }

  const body = (await c.req.json()) as { message: string; title?: string; priority?: number; extras?: any };
  if (!body.message) {
    return ApiResponse.error("Bad Request", 400, "Missing required field: message is required");
  }
  if (body.extras !== undefined && typeof body.extras !== "object") {
    return ApiResponse.error("Bad Request", 400, "extras must be an object");
  }

  const auth = await getAppAuth(c);
  if (!auth) {
    return ApiResponse.error("Unauthorized", 401, "Application token required");
  }
  return await auth.messageHandlers.createMessage(auth.resourceId!, body.message, body.title, body.priority, body.extras);
});

// DELETE /message
message.delete("/", async (c) => {
  const auth = await getClientAuth(c);
  if (!auth) {
    return ApiResponse.error("Unauthorized", 401, "Client token or Basic auth required");
  }
  return await auth.messageHandlers.deleteAllMessages(auth.userId);
});

// DELETE /message/:id
message.delete("/:id", async (c) => {
  const auth = await getClientAuth(c);
  if (!auth) {
    return ApiResponse.error("Unauthorized", 401, "Client token or Basic auth required");
  }
  const id = c.req.param("id");
  return await auth.messageHandlers.deleteMessage(auth.userId, id);
});

export { message };
