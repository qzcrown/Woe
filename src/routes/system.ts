import { Hono } from "hono";
import { HonoEnv } from "../types/hono.ts";
import { createDrizzle } from "../drizzle/index.ts";
import { ApiResponse } from "../utils/response.ts";

const system = new Hono<HonoEnv>();

// GET /health
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

// GET /version
system.get("/version", (c) => {
  return ApiResponse.json({
    version: c.env.VERSION || "1.0.0",
    commit: "unknown",
    buildDate: new Date().toISOString(),
  });
});

// GET /status
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
      version: c.env.VERSION || "1.0.0",
      health: dbStatus,
    });
  } catch (error) {
    console.error("Status check failed:", error);
    return ApiResponse.json({
      initialized: false,
      version: c.env.VERSION || "1.0.0",
      health: "unknown",
    });
  }
});

export { system };
