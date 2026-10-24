








import { Hono } from "hono";
import { HonoEnv } from "../types/hono.ts";
import { createDrizzle } from "../drizzle/index.ts";
import { ApiResponse } from "../utils/response.ts";
import { buildInfo } from "../generated/buildInfo.ts";
import { isRegistrationEnabled } from "../utils/registrationConfig.ts";

const system = new Hono<HonoEnv>();



system.get("/health", async (c) => {
  try {
    const drizzle = createDrizzle(c.env.DB);
    const dbResult = await drizzle.$client.prepare("SELECT 1 as test").first();
    const dbStatus = dbResult ? "green" : "red";

    return ApiResponse.json({
      health: dbStatus,
      database: dbStatus,
    });
  } catch (error) {
    console.error("Health check failed:", error);
    return ApiResponse.json(
      {
        health: "red",
        database: "red",
      },
      500
    );
  }
});


system.get("/version", () => {


  return ApiResponse.json(
    {
      version: buildInfo.version,
      commit: buildInfo.commit,
      buildDate: buildInfo.buildDate,
    },
    200,
    { "Cache-Control": "no-store" }
  );
});


system.get("/gotifyinfo", (c) => {


  return ApiResponse.json({
    version: buildInfo.version,
    register: isRegistrationEnabled(c.env.REGISTRATION),
    localAuth: true,
    oidc: false,
    oidcIdpName: "",
    oidcAutoRedirect: false,
  });
});


system.get("/status", async (c) => {
  try {
    const drizzle = createDrizzle(c.env.DB);
    const { InitService } = await import("../services/initService.ts");
    const initService = new InitService(drizzle.$client);

    const dbResult = await drizzle.$client.prepare("SELECT 1 as test").first();
    const dbStatus = dbResult ? "green" : "red";
    const isInitialized = await initService.isSystemInitialized();

    return ApiResponse.json({
      initialized: isInitialized,
      version: buildInfo.version,
      health: dbStatus,
    });
  } catch (error) {
    console.error("Status check failed:", error);
    return ApiResponse.json({
      initialized: false,
      version: buildInfo.version,
      health: "unknown",
    });
  }
});

export { system };
