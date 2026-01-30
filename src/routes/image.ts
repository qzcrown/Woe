import { Hono } from "hono";
import { HonoEnv } from "../types/hono.ts";
import { ApiResponse } from "../utils/response.ts";

const image = new Hono<HonoEnv>();

// GET /image/:filename - Serve images from R2
image.get("/*", async (c) => {
  if (!c.env.R2) {
    return ApiResponse.error("Service Unavailable", 503, "R2 storage not configured");
  }

  // Get the filename from the path (everything after /image/)
  const path = c.req.path;
  const filename = path.replace(/^\/image\//, "").replace(/^\/api\/v1\/image\//, "");

  const object = await c.env.R2.get(filename);

  if (!object) {
    return new Response("Image not found", { status: 404 });
  }

  return new Response(object.body, {
    headers: {
      "Content-Type": object.httpMetadata?.contentType || "image/jpeg",
      "Cache-Control": "public, max-age=31536000",
    },
  });
});

export { image };
