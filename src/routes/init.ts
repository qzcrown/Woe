import { Hono } from "hono";
import { HonoEnv } from "../types/hono.ts";
import { createDrizzle } from "../drizzle/index.ts";
import { Authenticator } from "../middleware/auth.ts";
import { ApiResponse } from "../utils/response.ts";

const init = new Hono<HonoEnv>();

// GET /init/status
init.get("/status", async (c) => {
  const drizzle = createDrizzle(c.env.DB);
  const { InitService } = await import("../services/initService.ts");
  const initService = new InitService(drizzle.$client);
  const status = await initService.getInitStatus();
  return ApiResponse.json(status);
});

// POST /init/admin
init.post("/admin", async (c) => {
  const drizzle = createDrizzle(c.env.DB);
  const { InitService } = await import("../services/initService.ts");
  const initService = new InitService(drizzle.$client);
  const authenticator = new Authenticator(drizzle);

  const isDefaultAuth = await authenticator.isDefaultInitAuth(c.req.raw, c.env);
  const initialized = await initService.isSystemInitialized();
  const hasAdmin = await initService.hasAdminUser();

  if (!isDefaultAuth || (initialized && hasAdmin)) {
    return ApiResponse.error(
      "Forbidden",
      403,
      "Initialization not allowed or default credentials invalid"
    );
  }

  // Ensure schema is up to date before admin creation
  try {
    await initService.ensureSchema();
  } catch (e) {
    return ApiResponse.error(
      "Database error",
      500,
      e instanceof Error ? e.message : String(e)
    );
  }

  const dbReady = await initService.validateDatabase();
  if (!dbReady) {
    return ApiResponse.error(
      "Service Unavailable",
      503,
      "Database validation failed"
    );
  }

  const body = (await c.req.json()) as { name: string; pass: string };
  if (!body?.name || !body?.pass) {
    return ApiResponse.error(
      "Bad Request",
      400,
      "Missing required fields: name and pass"
    );
  }

  const adminId = await initService.createAdminUser(body.name, body.pass);
  if (!adminId) {
    return ApiResponse.error(
      "User creation failed",
      400,
      "Could not create admin user"
    );
  }

  await initService.markAsInitialized();
  return ApiResponse.json({ ok: true });
});

export { init };
