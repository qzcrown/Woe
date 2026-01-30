import app from "./app.ts";
import { Env } from "./types/index.ts";

// Backend API and functional route prefixes
const backendPrefixes = [
  "/api",
  "/init",
  "/current",
  "/user",
  "/application",
  "/client",
  "/message",
  "/plugin",
  "/stream",
  "/image",
  "/health",
  "/version",
  "/status"
];

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    // Check if this is a backend API request
    const isBackendRequest = backendPrefixes.some(prefix => 
      path === prefix || path.startsWith(prefix + "/")
    );

    // Handle frontend routes and static assets
    if (!isBackendRequest) {
      if (env.ASSETS) {
        try {
          // Try to serve the static asset first
          let response = await env.ASSETS.fetch(request.clone());

          // If not found and doesn't look like a file request (no extension),
          // serve index.html for SPA routing
          if (response.status === 404 && !path.includes(".")) {
            const indexUrl = new URL(request.url);
            indexUrl.pathname = "/index.html";
            response = await env.ASSETS.fetch(new Request(indexUrl.toString(), request));

            // Follow redirects (wrangler dev returns 307 for /index.html -> /)
            if (response.status >= 300 && response.status < 400 && response.headers.has("Location")) {
              const redirectUrl = response.headers.get("Location");
              if (redirectUrl) {
                const newRequest = new Request(new URL(redirectUrl, request.url).toString(), request);
                response = await env.ASSETS.fetch(newRequest);
              }
            }
          }

          // Accept 2xx status codes (after following redirects)
          if (response.status >= 200 && response.status < 300) {
            const responseHeaders = new Headers(response.headers);
            // Cache assets for better performance
            if (path.startsWith("/assets/")) {
              responseHeaders.set("Cache-Control", "public, max-age=31536000, immutable");
            } else {
              responseHeaders.set("Cache-Control", "public, max-age=3600");
            }
            return new Response(response.body, {
              status: response.status,
              headers: responseHeaders,
            });
          }
        } catch (error) {
          console.error("Error serving assets:", error);
        }
      }

      // If we're here, it's a frontend route that failed to serve from ASSETS.
      // Instead of falling through to Hono (which returns API 404), return a clear error
      // if it's a path that should be handled by the frontend.
      if (!path.includes(".") || path === "/") {
        return new Response(
          `Frontend asset not found for path: ${path}. Please ensure the frontend is built ('npm run build') and the 'public' directory exists.`,
          { status: 404, headers: { "Content-Type": "text/plain" } }
        );
      }
    }

    // Handle backend API requests with Hono
    return app.fetch(request, env, ctx);
  },

  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    console.log("Scheduled task triggered, cron:", event.cron);
    const { CleanupService } = await import('./services/cleanupService.ts');
    const cleanupService = new CleanupService(env.DB);
    await cleanupService.cleanupOldPluginLogs(30);
  },
};
