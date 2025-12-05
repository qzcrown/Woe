import { Authenticator } from "./middleware/auth.ts";
import { UserHandlers } from "./handlers/userHandlers.ts";
import { ApplicationHandlers } from "./handlers/applicationHandlers.ts";
import { ClientHandlers } from "./handlers/clientHandlers.ts";
import { MessageHandlers } from "./handlers/messageHandlers.ts";
import { PluginHandlers } from "./handlers/pluginHandlers.ts";
import { Env } from "./types/index.ts";
import { ApiResponse } from "./utils/response.ts";

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const method = request.method;
    const path = url.pathname;

    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Gotify-Key",
    };

    if (method === "OPTIONS") {
      return new Response(null, { status: 200, headers: corsHeaders });
    }

    // Initialize handlers
    const authenticator = new Authenticator(env.DB);

    const userHandlers = new UserHandlers(env.DB);
    const applicationHandlers = new ApplicationHandlers(env.DB);
    const clientHandlers = new ClientHandlers(env.DB);
    const messageHandlers = new MessageHandlers(env.DB);
    const pluginHandlers = new PluginHandlers(env.DB);

    try {
      try {
        const { InitializationService } = await import("./services/initializationService.ts");
        const initService = new InitializationService(env.DB);
        await initService.runAutoMigrationsIfNeeded();
      } catch (e) {
        console.warn("Auto migrations check failed:", e instanceof Error ? e.message : e);
      }
      // Serve static assets for the web UI
      // Define frontend SPA routes that should serve index.html
      const frontendRoutes = ["/", "/login", "/setup", "/messages", "/applications", "/clients", "/users"];
      const isFrontendRoute = frontendRoutes.includes(path) ||
                              path.startsWith("/assets/") ||
                              path.includes(".");

      if (isFrontendRoute) {
        try {
          // Try to serve from assets first
          if (env.ASSETS) {
            // For frontend routes (not static assets), serve index.html
            // For static assets like /assets/ or files with extensions, serve the actual file
            const assetPath = (path === "/" || frontendRoutes.includes(path)) ? "/index.html" : path;

            const asset = await env.ASSETS.fetch(new Request(`https://assets.example.com${assetPath}`));

            if (asset.status === 200) {
              const responseHeaders = new Headers(asset.headers);
              responseHeaders.set('Cache-Control', 'public, max-age=3600');
              return new Response(asset.body, {
                status: asset.status,
                headers: responseHeaders
              });
            }
          }
        } catch (error) {
          // If asset not found, continue to API routes
          console.log('Asset not found:', path);
        }
      }

      // System endpoints
      if (path === "/health" && method === "GET") {
        try {
          // Test database connection
          const dbResult = await env.DB.prepare("SELECT 1 as test").first();
          const dbStatus = dbResult ? "green" : "red";

          return ApiResponse.json({
            health: dbStatus,  // Overall health matches DB status
            database: dbStatus
          });
        } catch (error) {
          console.error("Health check failed:", error);
          return ApiResponse.json({
            health: "red",
            database: "red"
          }, 500);
        }
      }

      if (path === "/version" && method === "GET") {
        return ApiResponse.json({
          version: env.VERSION || "1.0.0",
          commit: "unknown",
          buildDate: new Date().toISOString()
        });
      }

      if (path === "/status" && method === "GET") {
        try {
          // Dynamically import to avoid issues if service doesn't exist
          const { InitializationService } = await import("./services/initializationService.ts");
          const initService = new InitializationService(env.DB);

          const dbResult = await env.DB.prepare("SELECT 1 as test").first();
          const dbStatus = dbResult ? "green" : "red";
          const isInitialized = await initService.isSystemInitialized();

          return ApiResponse.json({
            initialized: isInitialized,
            version: env.VERSION || "1.0.0",
            health: dbStatus
          });
        } catch (error) {
          console.error("Status check failed:", error);
          // Even if status check fails, return basic info
          return ApiResponse.json({
            initialized: false,
            version: env.VERSION || "1.0.0",
            health: "unknown"
          });
        }
      }

      // WebSocket endpoint
      if (path === "/stream" && method === "GET") {
        const tokenInfo = await authenticator.authenticate(request);
        if (!tokenInfo) {
          return ApiResponse.error("Unauthorized", 401, "Authentication required");
        }
        const upgrade = request.headers.get("Upgrade");
        if (!upgrade || upgrade.toLowerCase() !== "websocket") {
          return ApiResponse.json({ ok: true });
        }
        const pair = new WebSocketPair();
        const [client, server] = Object.values(pair);
        await messageHandlers.handleWebSocket(server);
        return new Response(null, {
          status: 101,
          webSocket: client,
          headers: corsHeaders,
        });
      }

      // Parse path segments
      let apiPath = path;
      // Remove /api/v1 prefix if present
      if (path.startsWith('/api/v1')) {
        apiPath = path.substring('/api/v1'.length);
      }
      const pathSegments = apiPath.split('/').filter(Boolean);

      // Image serving endpoint
      if (pathSegments[0] === "api" && pathSegments[1] === "v1" && pathSegments[2] === "image" && method === "GET") {
        if (!env.R2) {
          return ApiResponse.error("Service Unavailable", 503, "R2 storage not configured");
        }

        const filename = pathSegments.slice(3).join('/');
        const object = await env.R2.get(filename);

        if (!object) {
          return new Response("Image not found", { status: 404 });
        }

        return new Response(object.body, {
          headers: {
            "Content-Type": object.httpMetadata?.contentType || "image/jpeg",
            "Cache-Control": "public, max-age=31536000",
          },
        });
      }

      // Current user endpoints (/current/user)
      if (pathSegments[0] === "current") {
        if (pathSegments[1] === "user" && pathSegments[2] === "password" && method === "POST") {
          // POST /current/user/password
          let tokenInfo: any = null;
          let basicAuthUser: any = null;

          // Try Basic Auth first
          basicAuthUser = await authenticator.authenticateBasic(request, env);
          if (basicAuthUser) {
            tokenInfo = { userId: basicAuthUser.id, isAdmin: basicAuthUser.admin };
          } else {
            // Fall back to token authentication
            tokenInfo = await authenticator.authenticate(request);
          }

          if (!tokenInfo) {
            return ApiResponse.error("Unauthorized", 401, "Authentication required");
          }
          const body = await request.json() as { pass: string }; // Corrected parameter name 'pass' from 'password' based on spec
          return await userHandlers.updateCurrentUserPassword(tokenInfo.userId, body.pass);
        } else if (pathSegments[1] === "user" && method === "GET") {
          // GET /current/user - Support both Basic Auth and token authentication per Gotify spec
          let userId: number | undefined;

          // Try Basic Auth first (for login flow)
          const basicAuthUser = await authenticator.authenticateBasic(request, env);
          if (basicAuthUser) {
            userId = basicAuthUser.id;
          } else {
            // Fall back to token authentication
            const tokenInfo = await authenticator.authenticate(request);
            if (!tokenInfo) {
              return ApiResponse.error("Unauthorized", 401, "Authentication required");
            }
            userId = tokenInfo.userId;
          }

          return await userHandlers.getCurrentUser(userId);
        }
      }

      // User endpoints (/user, /user/{id})
      if (pathSegments[0] === "user") {
        if (!pathSegments[1] && method === "GET") {
          // GET /user - Requires clientToken (can also use basic auth per spec)
          let userId: number | undefined;
          // Try Basic Auth first
          const basicAuthUser = await authenticator.authenticateBasic(request, env);
          if (basicAuthUser) {
            if (!basicAuthUser.admin) {
              return ApiResponse.error("Forbidden", 403, "Admin access required");
            }
            userId = basicAuthUser.id;
          } else {
            // Fall back to token authentication
            const tokenInfo = await authenticator.authenticate(request);
            if (!tokenInfo || !tokenInfo.isAdmin) {
              return ApiResponse.error("Forbidden", 403, "Admin access required");
            }
            userId = tokenInfo.userId;
          }
          return await userHandlers.getAllUsers();
        } else if (!pathSegments[1] && method === "POST") {
          // POST /user - Create user (admin only or if registration is enabled)
          // Support both token auth and basic auth
          let tokenInfo: any = null;
          let basicAuthUser: any = null;

          // Try Basic Auth first
          basicAuthUser = await authenticator.authenticateBasic(request, env);
          if (basicAuthUser) {
            tokenInfo = { userId: basicAuthUser.id, isAdmin: basicAuthUser.admin };
          } else {
            // Fall back to token authentication
            tokenInfo = await authenticator.authenticate(request);
          }

          const body = await request.json() as { name: string; pass: string; admin?: boolean };

          // Validate required fields
          if (!body.name || !body.pass) {
            return ApiResponse.error("Bad Request", 400, "Missing required fields: name and pass are required");
          }
          if (body.admin === undefined) {
            return ApiResponse.error("Bad Request", 400, "Missing required field: admin is required");
          }

          // Check if registration is enabled or user is authenticated as admin
          const isRegistrationEnabled = env.REGISTRATION === 'true';
          const isAdmin = tokenInfo?.isAdmin;

          if (!isRegistrationEnabled && !isAdmin) {
            return ApiResponse.error("Forbidden", 403, "Registration is disabled. Only admin can create users or enable REGISTRATION.");
          }

          // If creating as admin, allow admin flag to be set
          // If creating via registration, force admin to false
          const adminFlag = isAdmin ? body.admin : false;

          return await userHandlers.createUser(body.name, body.pass, adminFlag);
        } else if (pathSegments[1] && method === "GET") {
          // GET /user/{id} - Requires clientToken (can also use basic auth per spec)
          let tokenInfo: any = null;
          let basicAuthUser: any = null;

          // Try Basic Auth first
          basicAuthUser = await authenticator.authenticateBasic(request, env);
          if (basicAuthUser) {
            tokenInfo = { userId: basicAuthUser.id, isAdmin: basicAuthUser.admin };
          } else {
            // Fall back to token authentication
            tokenInfo = await authenticator.authenticate(request);
          }

          if (!tokenInfo) {
            return ApiResponse.error("Unauthorized", 401, "Authentication required");
          }

          // Check if user is accessing their own record or is admin
          if (!tokenInfo.isAdmin && tokenInfo.userId !== parseInt(pathSegments[1])) {
            return ApiResponse.error("Forbidden", 403, "You can only view your own user or require admin privileges");
          }
          return await userHandlers.getUser(pathSegments[1]);
        } else if (pathSegments[1] && (method === "PUT" || method === "POST")) {
          // PUT /user/{id} - UPDATE user (corrected from POST to PUT per spec)
          let tokenInfo: any = null;
          let basicAuthUser: any = null;

          // Try Basic Auth first
          basicAuthUser = await authenticator.authenticateBasic(request, env);
          if (basicAuthUser) {
            tokenInfo = { userId: basicAuthUser.id, isAdmin: basicAuthUser.admin };
          } else {
            // Fall back to token authentication
            tokenInfo = await authenticator.authenticate(request);
          }

          if (!tokenInfo || !tokenInfo.isAdmin) {
            return ApiResponse.error("Forbidden", 403, "Admin access required");
          }
          const body = await request.json() as { name?: string; pass?: string; admin?: boolean };
          return await userHandlers.updateUser(pathSegments[1], body);
        } else if (pathSegments[1] && method === "DELETE") {
          // DELETE /user/{id}
          let tokenInfo: any = null;
          let basicAuthUser: any = null;

          // Try Basic Auth first
          basicAuthUser = await authenticator.authenticateBasic(request, env);
          if (basicAuthUser) {
            tokenInfo = { userId: basicAuthUser.id, isAdmin: basicAuthUser.admin };
          } else {
            // Fall back to token authentication
            tokenInfo = await authenticator.authenticate(request);
          }

          if (!tokenInfo || !tokenInfo.isAdmin) {
            return ApiResponse.error("Forbidden", 403, "Admin access required");
          }
          return await userHandlers.deleteUser(pathSegments[1]);
        }
      }

      // Application endpoints (/application, /application/{id})
      if (pathSegments[0] === "application") {
        // Check for /application/{id}/image first (more specific)
        if (pathSegments.length === 3 && pathSegments[2] === "image") {
          if (method === "POST") {
            // POST /application/{id}/image
            let tokenInfo: any = null;
            let basicAuthUser: any = null;

            // Try Basic Auth first
            basicAuthUser = await authenticator.authenticateBasic(request, env);
            if (basicAuthUser) {
              tokenInfo = { userId: basicAuthUser.id, isAdmin: basicAuthUser.admin };
            } else {
              // Fall back to token authentication
              tokenInfo = await authenticator.authenticate(request);
            }

            if (!tokenInfo || !tokenInfo.isAdmin) {
              return ApiResponse.error("Forbidden", 403, "Admin access required");
            }
            return await applicationHandlers.uploadApplicationImage(tokenInfo.userId, pathSegments[1], request, env);
          } else if (method === "DELETE") {
            // DELETE /application/{id}/image
            let tokenInfo: any = null;
            let basicAuthUser: any = null;

            // Try Basic Auth first
            basicAuthUser = await authenticator.authenticateBasic(request, env);
            if (basicAuthUser) {
              tokenInfo = { userId: basicAuthUser.id, isAdmin: basicAuthUser.admin };
            } else {
              // Fall back to token authentication
              tokenInfo = await authenticator.authenticate(request);
            }

            if (!tokenInfo || !tokenInfo.isAdmin) {
              return ApiResponse.error("Forbidden", 403, "Admin access required");
            }
            return await applicationHandlers.deleteApplicationImage(tokenInfo.userId, pathSegments[1], env);
          }
        }
        // Check for /application/{id}/message
        else if (pathSegments.length === 3 && pathSegments[2] === "message") {
          if (method === "GET") {
            // GET /application/{id}/message
            let tokenInfo: any = null;
            let basicAuthUser: any = null;

            // Try Basic Auth first
            basicAuthUser = await authenticator.authenticateBasic(request, env);
            if (basicAuthUser) {
              tokenInfo = { userId: basicAuthUser.id, isAdmin: basicAuthUser.admin };
            } else {
              // Fall back to token authentication
              tokenInfo = await authenticator.authenticate(request);
            }

            if (!basicAuthUser && (!tokenInfo || tokenInfo.tokenType !== "client")) {
              return ApiResponse.error("Unauthorized", 401, "Client token or Basic auth required");
            }

            const limitParam = url.searchParams.get("limit");
            const sinceParam = url.searchParams.get("since");
            const limit = limitParam ? Math.min(Math.max(parseInt(limitParam), 1), 200) : undefined;
            const since = sinceParam ? Math.max(parseInt(sinceParam), 0) : undefined;
            const effectiveUserId = basicAuthUser ? basicAuthUser.id : tokenInfo.userId;
            return await messageHandlers.getApplicationMessages(effectiveUserId, pathSegments[1], limit, since, url.origin);
          } else if (method === "DELETE") {
            // DELETE /application/{id}/message
            let tokenInfo: any = null;
            let basicAuthUser: any = null;

            // Try Basic Auth first
            basicAuthUser = await authenticator.authenticateBasic(request, env);
            if (basicAuthUser) {
              tokenInfo = { userId: basicAuthUser.id, isAdmin: basicAuthUser.admin };
            } else {
              // Fall back to token authentication
              tokenInfo = await authenticator.authenticate(request);
            }

            if (!basicAuthUser && (!tokenInfo || tokenInfo.tokenType !== "client")) {
              return ApiResponse.error("Unauthorized", 401, "Client token or Basic auth required");
            }
            const effectiveUserId = basicAuthUser ? basicAuthUser.id : tokenInfo.userId;
            return await messageHandlers.deleteApplicationMessages(effectiveUserId, pathSegments[1]);
          }
        }
        // Application CRUD operations
        else if (!pathSegments[1]) {
          if (method === "GET") {
            // GET /application
            let tokenInfo: any = null;
            let basicAuthUser: any = null;

            // Try Basic Auth first
            basicAuthUser = await authenticator.authenticateBasic(request, env);
            if (basicAuthUser) {
              tokenInfo = { userId: basicAuthUser.id, isAdmin: basicAuthUser.admin };
            } else {
              // Fall back to token authentication
              tokenInfo = await authenticator.authenticate(request);
            }

            if (!basicAuthUser && (!tokenInfo || tokenInfo.tokenType !== "client")) {
              return ApiResponse.error("Unauthorized", 401, "Client token or Basic auth required");
            }
            return await applicationHandlers.getAllApplications(tokenInfo.userId);
          } else if (method === "POST") {
            // POST /application
            let tokenInfo: any = null;
            let basicAuthUser: any = null;

            // Try Basic Auth first
            basicAuthUser = await authenticator.authenticateBasic(request, env);
            if (basicAuthUser) {
              tokenInfo = { userId: basicAuthUser.id, isAdmin: basicAuthUser.admin };
            } else {
              // Fall back to token authentication
              tokenInfo = await authenticator.authenticate(request);
            }

            if (!basicAuthUser && (!tokenInfo || tokenInfo.tokenType !== "client")) {
              return ApiResponse.error("Unauthorized", 401, "Client token or Basic auth required");
            }
            const body = await request.json() as { name: string; description?: string; defaultPriority?: number };

            // Validate required fields
            if (!body.name) {
              return ApiResponse.error("Bad Request", 400, "Missing required field: name is required");
            }

            return await applicationHandlers.createApplication(tokenInfo.userId, body.name, body.description, body.defaultPriority);
          }
        } else if (pathSegments[1]) {
          const id = pathSegments[1];
          if (method === "GET") {
            // GET /application/{id}
            let tokenInfo: any = null;
            let basicAuthUser: any = null;

            // Try Basic Auth first
            basicAuthUser = await authenticator.authenticateBasic(request, env);
            if (basicAuthUser) {
              tokenInfo = { userId: basicAuthUser.id, isAdmin: basicAuthUser.admin };
            } else {
              // Fall back to token authentication
              tokenInfo = await authenticator.authenticate(request);
            }

            if (!basicAuthUser && (!tokenInfo || tokenInfo.tokenType !== "client")) {
              return ApiResponse.error("Unauthorized", 401, "Client token or Basic auth required");
            }
            return await applicationHandlers.getApplication(tokenInfo.userId, id);
          } else if (method === "PUT") {
            // PUT /application/{id}
            let tokenInfo: any = null;
            let basicAuthUser: any = null;

            // Try Basic Auth first
            basicAuthUser = await authenticator.authenticateBasic(request, env);
            if (basicAuthUser) {
              tokenInfo = { userId: basicAuthUser.id, isAdmin: basicAuthUser.admin };
            } else {
              // Fall back to token authentication
              tokenInfo = await authenticator.authenticate(request);
            }

            if (!basicAuthUser && (!tokenInfo || tokenInfo.tokenType !== "client")) {
              return ApiResponse.error("Unauthorized", 401, "Client token or Basic auth required");
            }
            const body = await request.json() as { name?: string; description?: string; defaultPriority?: number };
            return await applicationHandlers.updateApplication(tokenInfo.userId, id, body);
          } else if (method === "DELETE") {
            // DELETE /application/{id}
            let tokenInfo: any = null;
            let basicAuthUser: any = null;

            // Try Basic Auth first
            basicAuthUser = await authenticator.authenticateBasic(request, env);
            if (basicAuthUser) {
              tokenInfo = { userId: basicAuthUser.id, isAdmin: basicAuthUser.admin };
            } else {
              // Fall back to token authentication
              tokenInfo = await authenticator.authenticate(request);
            }

            if (!basicAuthUser && (!tokenInfo || tokenInfo.tokenType !== "client")) {
              return ApiResponse.error("Unauthorized", 401, "Client token or Basic auth required");
            }
            return await applicationHandlers.deleteApplication(tokenInfo.userId, id);
          }
        }
      }

      // Client endpoints (/client, /client/{id})
      if (pathSegments[0] === "client") {
        if (!pathSegments[1] && method === "GET") {
          // GET /client - Support Basic Auth per Gotify spec
          let tokenInfo: any = null;
          let basicAuthUser: any = null;

          // Try Basic Auth first
          basicAuthUser = await authenticator.authenticateBasic(request, env);
          if (basicAuthUser) {
            tokenInfo = { userId: basicAuthUser.id, isAdmin: basicAuthUser.admin };
          } else {
            // Fall back to token authentication
            tokenInfo = await authenticator.authenticate(request);
          }

          if (!basicAuthUser && (!tokenInfo || tokenInfo.tokenType !== "client")) {
            return ApiResponse.error("Unauthorized", 401, "Client token or Basic auth required");
          }
          return await clientHandlers.getAllClients(tokenInfo.userId);
        } else if (!pathSegments[1] && method === "POST") {
          // POST /client - Support Basic Auth per Gotify spec
          let userId: number | undefined;

          // Try Basic Auth first
          const basicAuthUser = await authenticator.authenticateBasic(request, env);
          if (basicAuthUser) {
            userId = basicAuthUser.id;
          } else {
            // Fall back to token authentication (must be client token)
            const tokenInfo = await authenticator.authenticate(request);
            if (!tokenInfo || tokenInfo.tokenType !== "client") {
              return ApiResponse.error("Unauthorized", 401, "Client token or Basic auth required");
            }
            userId = tokenInfo.userId;
          }

          if (!userId) {
            return ApiResponse.error("Unauthorized", 401, "Authentication required");
          }

          const body = await request.json() as { name: string };
          return await clientHandlers.createClient(userId, body.name);
        } else if (pathSegments[1] && method === "GET") {
          // GET /client/{id} - Support Basic Auth per Gotify spec
          let tokenInfo: any = null;
          let basicAuthUser: any = null;

          // Try Basic Auth first
          basicAuthUser = await authenticator.authenticateBasic(request, env);
          if (basicAuthUser) {
            tokenInfo = { userId: basicAuthUser.id, isAdmin: basicAuthUser.admin };
          } else {
            // Fall back to token authentication
            tokenInfo = await authenticator.authenticate(request);
          }

          if (!basicAuthUser && (!tokenInfo || tokenInfo.tokenType !== "client")) {
            return ApiResponse.error("Unauthorized", 401, "Client token or Basic auth required");
          }
          return await clientHandlers.getClient(tokenInfo.userId, pathSegments[1]);
        } else if (pathSegments[1] && method === "PUT") {
          // PUT /client/{id} - Support Basic Auth per Gotify spec
          let tokenInfo: any = null;
          let basicAuthUser: any = null;

          // Try Basic Auth first
          basicAuthUser = await authenticator.authenticateBasic(request, env);
          if (basicAuthUser) {
            tokenInfo = { userId: basicAuthUser.id, isAdmin: basicAuthUser.admin };
          } else {
            // Fall back to token authentication
            tokenInfo = await authenticator.authenticate(request);
          }

          if (!basicAuthUser && (!tokenInfo || tokenInfo.tokenType !== "client")) {
            return ApiResponse.error("Unauthorized", 401, "Client token or Basic auth required");
          }
          const body = await request.json() as { name: string };
          return await clientHandlers.updateClient(tokenInfo.userId, pathSegments[1], body.name);
        } else if (pathSegments[1] && method === "DELETE") {
          // DELETE /client/{id} - Support Basic Auth per Gotify spec
          let tokenInfo: any = null;
          let basicAuthUser: any = null;

          // Try Basic Auth first
          basicAuthUser = await authenticator.authenticateBasic(request, env);
          if (basicAuthUser) {
            tokenInfo = { userId: basicAuthUser.id, isAdmin: basicAuthUser.admin };
          } else {
            // Fall back to token authentication
            tokenInfo = await authenticator.authenticate(request);
          }

          if (!basicAuthUser && (!tokenInfo || tokenInfo.tokenType !== "client")) {
            return ApiResponse.error("Unauthorized", 401, "Client token or Basic auth required");
          }
          return await clientHandlers.deleteClient(tokenInfo.userId, pathSegments[1]);
        }
      }

      // Message endpoints (/message, /message/{id})
      if (pathSegments[0] === "message") {
        if (!pathSegments[1]) {
          if (method === "GET") {
            // GET /message
            const basicAuthUser = await authenticator.authenticateBasic(request, env);
            const tokenInfo = basicAuthUser ? null : await authenticator.authenticate(request);
            if (!basicAuthUser && (!tokenInfo || tokenInfo.tokenType !== "client")) {
              return ApiResponse.error("Unauthorized", 401, "Client token or Basic auth required");
            }

            const limitParam2 = url.searchParams.get("limit");
            const sinceParam2 = url.searchParams.get("since");
            const limit2 = limitParam2 ? Math.min(Math.max(parseInt(limitParam2), 1), 200) : undefined;
            const since2 = sinceParam2 ? Math.max(parseInt(sinceParam2), 0) : undefined;
            const effectiveUserId = basicAuthUser ? basicAuthUser.id : tokenInfo!.userId;
            return await messageHandlers.getAllMessages(effectiveUserId, limit2, since2, url.origin);
          } else if (method === "POST") {
            // POST /message
            const contentType = request.headers.get("content-type") || "";
            if (!contentType.includes("application/json")) {
              return ApiResponse.error("Bad Request", 400, "Content-Type must be application/json");
            }
            const body = await request.json() as { message: string; title?: string; priority?: number; extras?: any };

            // Validate required fields per spec
            if (!body.message) {
              return ApiResponse.error("Bad Request", 400, "Missing required field: message is required");
            }
            if (body.extras !== undefined && typeof body.extras !== "object") {
              return ApiResponse.error("Bad Request", 400, "extras must be an object");
            }

            const appTokenInfo = await authenticator.authenticate(request);
            if (!appTokenInfo || appTokenInfo.tokenType !== "app") {
              return ApiResponse.error("Unauthorized", 401, "Application token required");
            }
            return await messageHandlers.createMessage(appTokenInfo.resourceId!, body.message, body.title, body.priority, body.extras);
          } else if (method === "DELETE") {
            // DELETE /message
            const basicAuthUser = await authenticator.authenticateBasic(request, env);
            const tokenInfo = basicAuthUser ? null : await authenticator.authenticate(request);
            if (!basicAuthUser && (!tokenInfo || tokenInfo.tokenType !== "client")) {
              return ApiResponse.error("Unauthorized", 401, "Client token or Basic auth required");
            }
            const effectiveUserId = basicAuthUser ? basicAuthUser.id : tokenInfo!.userId;
            return await messageHandlers.deleteAllMessages(effectiveUserId);
          }
        } else if (pathSegments[1] && method === "DELETE") {
          // DELETE /message/{id}
          const basicAuthUser = await authenticator.authenticateBasic(request, env);
          const tokenInfo = basicAuthUser ? null : await authenticator.authenticate(request);
          if (!basicAuthUser && (!tokenInfo || tokenInfo.tokenType !== "client")) {
            return ApiResponse.error("Unauthorized", 401, "Client token or Basic auth required");
          }
          const effectiveUserId = basicAuthUser ? basicAuthUser.id : tokenInfo!.userId;
          return await messageHandlers.deleteMessage(effectiveUserId, pathSegments[1]);
        }
      }

      // Plugin endpoints (/plugin, /plugin/{id}/config, etc.)
      if (pathSegments[0] === "plugin") {
        const basicAuthUser = await authenticator.authenticateBasic(request, env);
        const tokenInfo = basicAuthUser ? null : await authenticator.authenticate(request);
        if (!basicAuthUser && (!tokenInfo || tokenInfo.tokenType !== "client")) {
          return ApiResponse.error("Unauthorized", 401, "Client token or Basic auth required");
        }

        // Check for /plugin/{id}/xxx routes first
        if (pathSegments[1] && pathSegments[2]) {
          const pluginId = pathSegments[1];
          const action = pathSegments[2];

          if (action === "config" && method === "GET") {
            // GET /plugin/{id}/config - Returns YAML with application/x-yaml content type
            const userId = basicAuthUser ? basicAuthUser.id : tokenInfo!.userId;
            return await pluginHandlers.getPluginConfig(userId, pluginId);
          } else if (action === "config" && method === "POST") {
            // POST /plugin/{id}/config - Accepts YAML in request body
            const userId = basicAuthUser ? basicAuthUser.id : tokenInfo!.userId;
            return await pluginHandlers.updatePluginConfig(userId, pluginId, request);
          } else if (action === "enable" && method === "POST") {
            // POST /plugin/{id}/enable
            const userId = basicAuthUser ? basicAuthUser.id : tokenInfo!.userId;
            return await pluginHandlers.enablePlugin(userId, pluginId);
          } else if (action === "disable" && method === "POST") {
            // POST /plugin/{id}/disable
            const userId = basicAuthUser ? basicAuthUser.id : tokenInfo!.userId;
            return await pluginHandlers.disablePlugin(userId, pluginId);
          } else if (action === "display" && method === "GET") {
            // GET /plugin/{id}/display - Returns a string
            const userId = basicAuthUser ? basicAuthUser.id : tokenInfo!.userId;
            return await pluginHandlers.getPluginDisplay(userId, pluginId);
          } else if (action === "logs" && method === "GET") {
            const userId = basicAuthUser ? basicAuthUser.id : tokenInfo!.userId;
            const limitParam = url.searchParams.get("limit")
            const limit = limitParam ? Math.min(Math.max(parseInt(limitParam), 1), 200) : 50
            return await pluginHandlers.getPluginLogs(userId, pluginId, limit);
          }
        }
        // Check for /plugin (GET only)
        else if (!pathSegments[1] && method === "GET") {
          // GET /plugin
          const userId = basicAuthUser ? basicAuthUser.id : tokenInfo!.userId;
          return await pluginHandlers.getAllPlugins(userId);
        }
      }

      if (path === "/init/status" && method === "GET") {
        const { InitializationService } = await import("./services/initializationService.ts");
        const initService = new InitializationService(env.DB);
        const status = await initService.getInitStatus();
        return ApiResponse.json(status);
      }

      if (path === "/init/admin" && method === "POST") {
        const { InitializationService } = await import("./services/initializationService.ts");
        const initService = new InitializationService(env.DB);

        const isDefaultAuth = await authenticator.isDefaultInitAuth(request, env);
        const initialized = await initService.isSystemInitialized();
        const hasAdmin = await initService.hasAdminUser();

        if (!isDefaultAuth || initialized && hasAdmin) {
          return ApiResponse.error("Forbidden", 403, "Initialization not allowed or default credentials invalid");
        }

        const needsMigrations = await initService.checkIfMigrationsNeeded();
        if (needsMigrations) {
          const mig = await initService.applyAllMigrations();
          if (!mig.success) {
            return ApiResponse.error("Database error", 500, mig.error || "Migration failed");
          }
        }

        const dbReady = await initService.validateDatabase();
        if (!dbReady) {
          return ApiResponse.error("Service Unavailable", 503, "Database validation failed");
        }

        const body = await request.json() as { name: string; pass: string };
        if (!body?.name || !body?.pass) {
          return ApiResponse.error("Bad Request", 400, "Missing required fields: name and pass");
        }

        const hashed = await (await import("./middleware/auth.ts")).hashPassword(body.pass);
        const adminId = await initService.createAdminUser(body.name, hashed);
        if (!adminId) {
          return ApiResponse.error("User creation failed", 400, "Could not create admin user");
        }

        await initService.markAsInitialized();
        return ApiResponse.json({ ok: true });
      }

      return ApiResponse.error("Not Found", 404, "Endpoint not found");

    } catch (error) {
      return ApiResponse.error("Internal Server Error", 500, error instanceof Error ? error.message : "Unknown error");
    }
  },
};
