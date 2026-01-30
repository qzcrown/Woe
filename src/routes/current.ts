import { Hono } from "hono";
import { HonoEnv } from "../types/hono.ts";
import { createDrizzle } from "../drizzle/index.ts";
import { Authenticator } from "../middleware/auth.ts";
import { UserHandlers } from "../handlers/userHandlers.ts";
import { ApiResponse } from "../utils/response.ts";

const current = new Hono<HonoEnv>();

// GET /current/user
current.get("/user", async (c) => {
  const drizzle = createDrizzle(c.env.DB);
  const authenticator = new Authenticator(drizzle);
  const userHandlers = new UserHandlers(drizzle);

  let userId: number | undefined;

  // Try Basic Auth first (for login flow)
  const basicAuthUser = await authenticator.authenticateBasic(c.req.raw, c.env);
  if (basicAuthUser) {
    userId = basicAuthUser.id;
  } else {
    // Fall back to token authentication
    const tokenInfo = await authenticator.authenticate(c.req.raw);
    if (!tokenInfo) {
      return ApiResponse.error("Unauthorized", 401, "Authentication required");
    }
    userId = tokenInfo.userId;
  }

  return await userHandlers.getCurrentUser(userId);
});

// POST /current/user/password
current.post("/user/password", async (c) => {
  const drizzle = createDrizzle(c.env.DB);
  const authenticator = new Authenticator(drizzle);
  const userHandlers = new UserHandlers(drizzle);

  let tokenInfo: any = null;
  let basicAuthUser: any = null;

  // Try Basic Auth first
  basicAuthUser = await authenticator.authenticateBasic(c.req.raw, c.env);
  if (basicAuthUser) {
    tokenInfo = { userId: basicAuthUser.id, isAdmin: basicAuthUser.admin };
  } else {
    // Fall back to token authentication
    tokenInfo = await authenticator.authenticate(c.req.raw);
  }

  if (!tokenInfo) {
    return ApiResponse.error("Unauthorized", 401, "Authentication required");
  }

  const body = (await c.req.json()) as { oldPassword: string; newPassword: string };
  return await userHandlers.updateCurrentUserPassword(
    tokenInfo.userId,
    body.oldPassword,
    body.newPassword
  );
});

export { current };
