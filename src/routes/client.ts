import { Hono } from "hono";
import { HonoEnv } from "../types/hono.ts";
import { createDrizzle } from "../drizzle/index.ts";
import { Authenticator } from "../middleware/auth.ts";
import { ClientHandlers } from "../handlers/clientHandlers.ts";
import { ApiResponse } from "../utils/response.ts";

const client = new Hono<HonoEnv>();

async function getClientAuth(c: any) {
  const drizzle = createDrizzle(c.env.DB);
  const authenticator = new Authenticator(drizzle);
  const clientHandlers = new ClientHandlers(drizzle);

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

// GET /client
client.get("/", async (c) => {
  const auth = await getClientAuth(c);
  if (!auth) {
    return ApiResponse.error("Unauthorized", 401, "Client token or Basic auth required");
  }
  return await auth.clientHandlers.getAllClients(auth.userId);
});

// POST /client
client.post("/", async (c) => {
  const auth = await getClientAuth(c);
  if (!auth) {
    return ApiResponse.error("Unauthorized", 401, "Client token or Basic auth required");
  }
  const body = (await c.req.json()) as { name: string };
  return await auth.clientHandlers.createClient(auth.userId, body.name);
});

// GET /client/:id
client.get("/:id", async (c) => {
  const auth = await getClientAuth(c);
  if (!auth) {
    return ApiResponse.error("Unauthorized", 401, "Client token or Basic auth required");
  }
  const id = c.req.param("id");
  return await auth.clientHandlers.getClient(auth.userId, id);
});

// PUT /client/:id
client.put("/:id", async (c) => {
  const auth = await getClientAuth(c);
  if (!auth) {
    return ApiResponse.error("Unauthorized", 401, "Client token or Basic auth required");
  }
  const id = c.req.param("id");
  const body = (await c.req.json()) as { name: string };
  return await auth.clientHandlers.updateClient(auth.userId, id, body.name);
});

// DELETE /client/:id
client.delete("/:id", async (c) => {
  const auth = await getClientAuth(c);
  if (!auth) {
    return ApiResponse.error("Unauthorized", 401, "Client token or Basic auth required");
  }
  const id = c.req.param("id");
  return await auth.clientHandlers.deleteClient(auth.userId, id);
});

export { client };
