import { Hono } from "hono";
import { HonoEnv } from "../types/hono.ts";
import { createDrizzle } from "../drizzle/index.ts";
import { Authenticator } from "../middleware/auth.ts";
import { UserHandlers } from "../handlers/userHandlers.ts";
import { ApiResponse } from "../utils/response.ts";

const user = new Hono<HonoEnv>();

async function getAuth(c: any) {
  const drizzle = createDrizzle(c.env.DB);
  const authenticator = new Authenticator(drizzle);
  const userHandlers = new UserHandlers(drizzle);

  let tokenInfo: any = null;
  const basicAuthUser = await authenticator.authenticateBasic(c.req.raw, c.env);
  if (basicAuthUser) {
    tokenInfo = { userId: basicAuthUser.id, isAdmin: basicAuthUser.admin };
  } else {
    tokenInfo = await authenticator.authenticate(c.req.raw);
  }

  return { tokenInfo, userHandlers, env: c.env };
}

user.get("/", async (c) => {
  const { tokenInfo, userHandlers } = await getAuth(c);
  if (!tokenInfo || !tokenInfo.isAdmin) {
    return ApiResponse.error("Forbidden", 403, "Admin access required");
  }
  return await userHandlers.getAllUsers();
});

user.post("/", async (c) => {
  const { tokenInfo, userHandlers, env } = await getAuth(c);
  const body = (await c.req.json()) as {
    name: string;
    pass: string;
    nickname: string;
    email: string;
    admin: boolean;
    description?: string;
  };

  if (!body.name || !body.pass) {
    return ApiResponse.error("Bad Request", 400, "Missing required fields: name and pass are required");
  }
  if (!body.nickname || !body.email) {
    return ApiResponse.error("Bad Request", 400, "Missing required fields: nickname and email are required");
  }
  if (body.admin === undefined) {
    return ApiResponse.error("Bad Request", 400, "Missing required field: admin is required");
  }

  const isRegistrationEnabled = env.REGISTRATION === "true";
  const isAdmin = tokenInfo?.isAdmin;

  if (!isRegistrationEnabled && !isAdmin) {
    return ApiResponse.error("Forbidden", 403, "Registration is disabled. Only admin can create users or enable REGISTRATION.");
  }

  const adminFlag = isAdmin ? body.admin : false;
  return await userHandlers.createUser(
    body.name, 
    body.pass, 
    adminFlag,
    body.nickname,
    body.email,
    body.description
  );
});

user.get("/:id", async (c) => {
  const { tokenInfo, userHandlers } = await getAuth(c);
  const id = c.req.param("id");

  if (!tokenInfo) {
    return ApiResponse.error("Unauthorized", 401, "Authentication required");
  }
  if (!tokenInfo.isAdmin && tokenInfo.userId !== parseInt(id)) {
    return ApiResponse.error("Forbidden", 403, "You can only view your own user or require admin privileges");
  }
  return await userHandlers.getUser(id);
});

user.put("/:id", async (c) => {
  const { tokenInfo, userHandlers } = await getAuth(c);
  const id = c.req.param("id");
  if (!tokenInfo || !tokenInfo.isAdmin) {
    return ApiResponse.error("Forbidden", 403, "Admin access required");
  }
  const body = (await c.req.json()) as { name?: string; pass?: string; admin?: boolean };
  return await userHandlers.updateUser(id, body);
});

user.post("/:id", async (c) => {
  const { tokenInfo, userHandlers } = await getAuth(c);
  const id = c.req.param("id");
  if (!tokenInfo || !tokenInfo.isAdmin) {
    return ApiResponse.error("Forbidden", 403, "Admin access required");
  }
  const body = (await c.req.json()) as { name?: string; pass?: string; admin?: boolean };
  return await userHandlers.updateUser(id, body);
});

user.delete("/:id", async (c) => {
  const { tokenInfo, userHandlers } = await getAuth(c);
  const id = c.req.param("id");
  if (!tokenInfo || !tokenInfo.isAdmin) {
    return ApiResponse.error("Forbidden", 403, "Admin access required");
  }
  return await userHandlers.deleteUser(id);
});

user.get("/:id/applications", async (c) => {
  const { tokenInfo, userHandlers } = await getAuth(c);
  const id = c.req.param("id");
  if (!tokenInfo || !tokenInfo.isAdmin) {
    return ApiResponse.error("Forbidden", 403, "Admin access required");
  }
  return await userHandlers.getUserApplications(parseInt(id));
});

user.get("/:id/clients", async (c) => {
  const { tokenInfo, userHandlers } = await getAuth(c);
  const id = c.req.param("id");
  if (!tokenInfo || !tokenInfo.isAdmin) {
    return ApiResponse.error("Forbidden", 403, "Admin access required");
  }
  return await userHandlers.getUserClients(parseInt(id));
});

user.get("/:id/plugins", async (c) => {
  const { tokenInfo, userHandlers } = await getAuth(c);
  const id = c.req.param("id");
  if (!tokenInfo || !tokenInfo.isAdmin) {
    return ApiResponse.error("Forbidden", 403, "Admin access required");
  }
  return await userHandlers.getUserPlugins(parseInt(id));
});

// PUT /user/:id/profile - Update user profile (nickname, email, description)
user.put("/:id/profile", async (c) => {
  const { tokenInfo, userHandlers } = await getAuth(c);
  const id = parseInt(c.req.param("id"));

  if (!tokenInfo) {
    return ApiResponse.error("Unauthorized", 401, "Authentication required");
  }

  const body = (await c.req.json()) as { nickname?: string; email?: string; description?: string };
  return await userHandlers.updateUserProfile(
    tokenInfo.userId,
    id,
    tokenInfo.isAdmin,
    body
  );
});

// POST /user/:id/avatar - Upload user avatar
user.post("/:id/avatar", async (c) => {
  const { tokenInfo, userHandlers, env } = await getAuth(c);
  const id = parseInt(c.req.param("id"));

  if (!tokenInfo) {
    return ApiResponse.error("Unauthorized", 401, "Authentication required");
  }

  return await userHandlers.uploadUserAvatar(
    tokenInfo.userId,
    id,
    tokenInfo.isAdmin,
    c.req.raw,
    env
  );
});

// DELETE /user/:id/avatar - Delete user avatar
user.delete("/:id/avatar", async (c) => {
  const { tokenInfo, userHandlers, env } = await getAuth(c);
  const id = parseInt(c.req.param("id"));

  if (!tokenInfo) {
    return ApiResponse.error("Unauthorized", 401, "Authentication required");
  }

  return await userHandlers.deleteUserAvatar(
    tokenInfo.userId,
    id,
    tokenInfo.isAdmin,
    env
  );
});

// GET /user/:id/plugin-permissions - Get plugin permissions for a user (admin only)
user.get("/:id/plugin-permissions", async (c) => {
  const { tokenInfo, userHandlers } = await getAuth(c);
  const id = c.req.param("id");
  if (!tokenInfo || !tokenInfo.isAdmin) {
    return ApiResponse.error("Forbidden", 403, "Admin access required");
  }
  return await userHandlers.getUserPluginPermissions(parseInt(id));
});

// PUT /user/:id/plugin-permissions - Update plugin permissions for a user (admin only)
user.put("/:id/plugin-permissions", async (c) => {
  const { tokenInfo, userHandlers } = await getAuth(c);
  const id = c.req.param("id");
  if (!tokenInfo || !tokenInfo.isAdmin) {
    return ApiResponse.error("Forbidden", 403, "Admin access required");
  }
  const body = (await c.req.json()) as { modulePaths: string[] };
  if (!body.modulePaths || !Array.isArray(body.modulePaths)) {
    return ApiResponse.error("Bad Request", 400, "modulePaths array is required");
  }
  return await userHandlers.updateUserPluginPermissions(parseInt(id), body.modulePaths);
});

// PUT /user/:id/disabled - Set user disabled status (admin only)
user.put("/:id/disabled", async (c) => {
  const { tokenInfo, userHandlers } = await getAuth(c);
  const id = c.req.param("id");

  if (!tokenInfo || !tokenInfo.isAdmin) {
    return ApiResponse.error("Forbidden", 403, "Admin access required");
  }

  const body = (await c.req.json()) as { disabled: boolean };
  if (typeof body.disabled !== "boolean") {
    return ApiResponse.error("Bad Request", 400, "disabled must be a boolean");
  }

  return await userHandlers.setUserDisabled(id, body.disabled);
});

export { user };
