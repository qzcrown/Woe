import { Hono } from "hono";
import { HonoEnv } from "./types/hono.ts";
import { createDrizzle } from "./drizzle/index.ts";
import { MigrationRunner } from "./services/migrationRunner.ts";
import { ApiResponse } from "./utils/response.ts";

// Import routes
import { system } from "./routes/system.ts";
import { init } from "./routes/init.ts";
import { current } from "./routes/current.ts";
import { user } from "./routes/user.ts";
import { application } from "./routes/application.ts";
import { client } from "./routes/client.ts";
import { message } from "./routes/message.ts";
import { plugin } from "./routes/plugin.ts";
import { stream } from "./routes/stream.ts";
import { image } from "./routes/image.ts";

const app = new Hono<HonoEnv>();

// CORS preflight
app.options("*", (c) => {
  return new Response(null, {
    status: 200,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Gotify-Key",
    },
  });
});

// Migration middleware - runs on first request
let migrationRan = false;
app.use("*", async (c, next) => {
  if (!migrationRan) {
    try {
      const migrationRunner = new MigrationRunner(c.env.DB);
      await migrationRunner.runPendingMigrations();
      migrationRan = true;
      console.log("Database migrations completed successfully");
    } catch (e) {
      console.error("Migration failed:", e instanceof Error ? e.message : e);
    }
  }
  await next();
});

// Mount routes - root paths
app.route("/", system);
app.route("/init", init);
app.route("/current", current);
app.route("/user", user);
app.route("/application", application);
app.route("/client", client);
app.route("/message", message);
app.route("/plugin", plugin);
app.route("/stream", stream);
app.route("/image", image);

// Mount routes - /api/v1 prefix
app.route("/api/v1", system);
app.route("/api/v1/init", init);
app.route("/api/v1/current", current);
app.route("/api/v1/user", user);
app.route("/api/v1/application", application);
app.route("/api/v1/client", client);
app.route("/api/v1/message", message);
app.route("/api/v1/plugin", plugin);
app.route("/api/v1/stream", stream);
app.route("/api/v1/image", image);

// 404 handler
app.notFound((c) => {
  return ApiResponse.error("Not Found", 404, "Endpoint not found");
});

// Error handler
app.onError((err, c) => {
  console.error("Unhandled error:", err);
  return ApiResponse.error("Internal Server Error", 500, err instanceof Error ? err.message : "Unknown error");
});

export default app;
