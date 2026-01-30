import { Hono } from "hono";
import { HonoEnv } from "../types/hono.ts";
import { createDrizzle } from "../drizzle/index.ts";
import { Authenticator } from "../middleware/auth.ts";
import { MessageHandlers } from "../handlers/messageHandlers.ts";
import { ClientHandlers } from "../handlers/clientHandlers.ts";
import { ApiResponse } from "../utils/response.ts";

const stream = new Hono<HonoEnv>();

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Gotify-Key",
};

// GET /stream - WebSocket endpoint
stream.get("/", async (c) => {
  const drizzle = createDrizzle(c.env.DB);
  const authenticator = new Authenticator(drizzle);
  const messageHandlers = new MessageHandlers(drizzle);
  const clientHandlers = new ClientHandlers(drizzle);

  const tokenInfo = await authenticator.authenticate(c.req.raw);
  if (!tokenInfo) {
    return ApiResponse.error("Unauthorized", 401, "Authentication required");
  }

  // 如果是客户端token，更新客户端的最后使用时间
  if (tokenInfo.tokenType === "client" && tokenInfo.resourceId) {
    try {
      await clientHandlers.updateLastUsed(tokenInfo.resourceId);
    } catch (error) {
      console.error("Failed to update client last_used:", error);
      // 静默失败，不影响WebSocket连接
    }
  }

  const upgrade = c.req.header("Upgrade");
  if (!upgrade || upgrade.toLowerCase() !== "websocket") {
    return ApiResponse.json({ ok: true });
  }

  const pair = new WebSocketPair();
  const [client, server] = Object.values(pair);
  await messageHandlers.handleWebSocket(server);
  
  return new Response(null, {
    status: 101,
    webSocket: client,
    headers: corsHeaders,
  });
});

export { stream };
