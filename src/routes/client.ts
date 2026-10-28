








import { Hono } from "hono";
import { HonoEnv } from "../types/hono.ts";
import { createDrizzle } from "../drizzle/index.ts";
import { Authenticator, SESSION_NOT_ELEVATED_MESSAGE } from "../middleware/auth.ts";
import { ClientHandlers } from "../handlers/clientHandlers.ts";
import { ApiResponse, parseJsonBody } from "../utils/response.ts";
import { validatePositiveIntegerId } from "../utils/routeParams.ts";
import { DurableObjectMessageStreamHub } from "../services/messageStreamHub.ts";

const client = new Hono<HonoEnv>();


async function getClientAuth(c: any) {
  const drizzle = createDrizzle(c.env.DB);
  const authenticator = new Authenticator(drizzle);
  const clientHandlers = new ClientHandlers(drizzle, c.env.DB);

  const basicAuthUser = await authenticator.authenticateBasic(c.req.raw, c.env);
  if (basicAuthUser) {
    return { userId: basicAuthUser.id, isAdmin: basicAuthUser.admin, clientHandlers };
  }
  const tokenInfo = await authenticator.authenticate(c.req.raw);
  if (!tokenInfo || tokenInfo.tokenType !== "client") {
    return null;
  }
  return { ...tokenInfo, clientHandlers };
}


client.get("/", async (c) => {
  const auth = await getClientAuth(c);
  if (!auth) {
    return ApiResponse.error("Unauthorized", 401, "Client token or Basic auth required");
  }
  return await auth.clientHandlers.getAllClients(auth.userId);
});


client.post("/", async (c) => {
  const auth = await getClientAuth(c);
  if (!auth) {
    return ApiResponse.error("Unauthorized", 401, "Client token or Basic auth required");
  }
  const parsed = await parseJsonBody<{
    name: string;

    platform?: string;
    deviceUid?: string;
    deviceToken?: string;
    appVersion?: string;
    deviceModel?: string;
    expiresAfterInactivitySeconds?: number;
  }>(c.req.raw);
  if (!parsed.ok) return parsed.response;
  const body = parsed.data;
  return await auth.clientHandlers.createClient(auth.userId, body);
});


client.get("/:id", async (c) => {
  const id = c.req.param("id");
  const invalidIdResponse = validatePositiveIntegerId(id);
  if (invalidIdResponse) {
    return invalidIdResponse;
  }

  const auth = await getClientAuth(c);
  if (!auth) {
    return ApiResponse.error("Unauthorized", 401, "Client token or Basic auth required");
  }
  return await auth.clientHandlers.getClient(auth.userId, id);
});


client.put("/:id", async (c) => {
  const id = c.req.param("id");
  const invalidIdResponse = validatePositiveIntegerId(id);
  if (invalidIdResponse) {
    return invalidIdResponse;
  }

  const auth = await getClientAuth(c);
  if (!auth) {
    return ApiResponse.error("Unauthorized", 401, "Client token or Basic auth required");
  }

  const parsed = await parseJsonBody<unknown>(c.req.raw);
  if (!parsed.ok) return parsed.response;
  return await auth.clientHandlers.updateClient(auth.userId, id, parsed.data);
});


client.put("/:id/push-state", async (c) => {
  const id = c.req.param("id");
  const invalidIdResponse = validatePositiveIntegerId(id);
  if (invalidIdResponse) {
    return invalidIdResponse;
  }

  const auth = await getClientAuth(c);
  if (!auth) {
    return ApiResponse.error("Unauthorized", 401, "Client token or Basic auth required");
  }
  const parsed = await parseJsonBody<{ state?: "active" | "inactive" }>(c.req.raw);
  if (!parsed.ok) return parsed.response;
  const body = parsed.data;
  return await auth.clientHandlers.updatePushState(auth.userId, id, body.state);
});


client.post("/:id/deactivate", async (c) => {
  const id = c.req.param("id");
  const invalidIdResponse = validatePositiveIntegerId(id);
  if (invalidIdResponse) return invalidIdResponse;
  const auth = await getClientAuth(c);
  if (!auth) return ApiResponse.error("Unauthorized", 401, "Client token or Basic auth required");
  return await auth.clientHandlers.deactivateClient(auth.userId, id);
});


client.post("/:id/elevate", async (c) => {
  const id = c.req.param("id");
  const invalidIdResponse = validatePositiveIntegerId(id);
  if (invalidIdResponse) {
    return invalidIdResponse;
  }

  const drizzle = createDrizzle(c.env.DB);
  const authenticator = new Authenticator(drizzle);

  const elevated = await authenticator.requireElevatedClient(c.req.raw, c.env);
  if (!elevated) {
    return ApiResponse.error("Forbidden", 403, SESSION_NOT_ELEVATED_MESSAGE);
  }

  const parsed = await parseJsonBody<{ durationSeconds: number }>(c.req.raw);
  if (!parsed.ok) return parsed.response;

  const clientHandlers = new ClientHandlers(drizzle);
  return await clientHandlers.elevateClient(elevated.userId, id, parsed.data.durationSeconds);
});


client.delete("/:id", async (c) => {
  const id = c.req.param("id");
  const invalidIdResponse = validatePositiveIntegerId(id);
  if (invalidIdResponse) {
    return invalidIdResponse;
  }

  const drizzle = createDrizzle(c.env.DB);
  const authenticator = new Authenticator(drizzle);

  const elevated = await authenticator.requireElevatedClient(c.req.raw, c.env);
  if (!elevated) {
    return ApiResponse.error("Forbidden", 403, SESSION_NOT_ELEVATED_MESSAGE);
  }

  const clientHandlers = new ClientHandlers(drizzle);
  const response = await clientHandlers.deleteClient(elevated.userId, id);
  if (response.ok && c.env.MESSAGE_STREAM_HUB) {
    try {
      const streamHub = new DurableObjectMessageStreamHub(c.env.MESSAGE_STREAM_HUB);
      await streamHub.disconnectClient(elevated.userId, Number(id));
    } catch (error) {

      console.error("Failed to disconnect deleted client stream:", error);
    }
  }
  return response;
});

export { client };
