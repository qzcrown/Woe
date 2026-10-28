












import { Hono } from "hono";
import { and, eq, inArray } from "drizzle-orm";
import { HonoEnv } from "../types/hono.ts";
import { createDrizzle } from "../drizzle/index.ts";
import { Authenticator } from "../middleware/auth.ts";
import { pluginConfigs } from "../models/index.ts";
import { ApiResponse, parseJsonBody } from "../utils/response.ts";
import { parsePositiveIntegerId, validatePositiveIntegerId } from "../utils/routeParams.ts";
import { QuotaService, type QuotaSource } from "../services/quota/quotaService.ts";
import { getQuotaNamespaceModulePaths, getQuotaNamespaces } from "../plugins/jobs/registry.ts";

const adminQuotas = new Hono<HonoEnv>();


const MAX_QUOTA_ROWS = 200;

const UNSUPPORTED_NAMESPACE = "Unsupported quota namespace";
const QUOTA_DATA_UNAVAILABLE = "Quota data is temporarily unavailable";
const QUOTA_STORAGE_UNAVAILABLE = "Quota storage is temporarily unavailable";
const INVALID_LIMIT = "Invalid limit: must be a non-negative integer or null";


interface QuotaUserView {
  userId: number;
  pluginId: number;
  defaultLimit: number;
  overrideLimit: number | null;
  effectiveLimit: number;
  usageDay: string | null;
  usageCount: number;
  usageToday: number;
  source: QuotaSource;
}


function declaredModulePaths(raw: string): readonly string[] | null {
  const modulePaths = getQuotaNamespaceModulePaths(raw);
  return modulePaths.length === 0 ? null : modulePaths;
}


async function getAdminAuth(c: any) {
  const drizzle = createDrizzle(c.env.DB);
  const authenticator = new Authenticator(drizzle);
  const auth = await authenticator.requireClient(c.req.raw, c.env);
  if (!auth) {
    return {
      error: ApiResponse.error("Unauthorized", 401, "Client token or Basic auth required"),
    };
  }
  if (!auth.isAdmin) {
    return { error: ApiResponse.error("Forbidden", 403, "Admin access required") };
  }
  return { drizzle, userId: auth.userId };
}


adminQuotas.get("/:namespace/users", async (c) => {
  const auth = await getAdminAuth(c);
  if ("error" in auth) return auth.error;


  const namespace = c.req.param("namespace");
  const modulePaths = declaredModulePaths(namespace);
  if (!modulePaths) {
    return ApiResponse.error("Bad Request", 400, UNSUPPORTED_NAMESPACE);
  }


  const instances = await auth.drizzle
    .select({
      id: pluginConfigs.id,
      userId: pluginConfigs.userId,
      usageDay: pluginConfigs.usageDay,
      usageCount: pluginConfigs.usageCount,
    })
    .from(pluginConfigs)
    .where(and(inArray(pluginConfigs.modulePath, modulePaths), eq(pluginConfigs.enabled, 1)))
    .orderBy(pluginConfigs.userId, pluginConfigs.id)
    .limit(MAX_QUOTA_ROWS)
    .all();

  const quota = new QuotaService(auth.drizzle, c.env, getQuotaNamespaces());
  const described = await quota.describeNamespaceQuotas(
    namespace,
    instances.map((instance) => ({
      userId: instance.userId,
      pluginId: instance.id,
      usageDay: instance.usageDay,
      usageCount: instance.usageCount,
    }))
  );


  if (!described.ok) {
    return ApiResponse.error("Service Unavailable", 503, QUOTA_DATA_UNAVAILABLE);
  }


  const users: QuotaUserView[] = described.rows.map((row, index) => ({
    userId: instances[index].userId,
    pluginId: instances[index].id,
    defaultLimit: row.defaultLimit,
    overrideLimit: row.overrideLimit,
    effectiveLimit: row.effectiveLimit,
    usageDay: row.usageDay,
    usageCount: row.usageCount,
    usageToday: row.usageToday,
    source: row.source,
  }));

  return ApiResponse.json({ users });
});


adminQuotas.put("/:namespace/:userId", async (c) => {
  const auth = await getAdminAuth(c);
  if ("error" in auth) return auth.error;

  const namespace = c.req.param("namespace");
  if (!declaredModulePaths(namespace)) {
    return ApiResponse.error("Bad Request", 400, UNSUPPORTED_NAMESPACE);
  }

  const rawUserId = c.req.param("userId");
  const invalidIdResponse = validatePositiveIntegerId(rawUserId);
  if (invalidIdResponse) return invalidIdResponse;
  const userId = parsePositiveIntegerId(rawUserId)!;

  const parsed = await parseJsonBody<unknown>(c.req.raw);
  if (!parsed.ok) return parsed.response;
  if (typeof parsed.data !== "object" || parsed.data === null || Array.isArray(parsed.data)) {
    return ApiResponse.error("Bad Request", 400, "Invalid JSON body");
  }

  const body = parsed.data as Record<string, unknown>;



  const quota = new QuotaService(auth.drizzle, c.env, getQuotaNamespaces());
  const result = await quota.setUserOverride(namespace, userId, body.limit as number | null);

  if (result.status === "invalid") {
    return ApiResponse.error("Bad Request", 400, INVALID_LIMIT);
  }
  if (result.status === "write-failed") {
    return ApiResponse.error("Service Unavailable", 503, QUOTA_STORAGE_UNAVAILABLE);
  }

  return ApiResponse.json({});
});

export { adminQuotas };
