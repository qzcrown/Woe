









import { Hono } from "hono";
import { HonoEnv } from "../types/hono.ts";
import { createDrizzle } from "../drizzle/index.ts";
import { Authenticator } from "../middleware/auth.ts";
import { ApiResponse, formatDate, parseJsonBody } from "../utils/response.ts";
import { parsePositiveIntegerId, validatePositiveIntegerId } from "../utils/routeParams.ts";
import {
  createPluginJobRuntime,
  SUBJECT_JOBS_DEFAULT_LIMIT,
  type EnqueueHttpStatus,
  type PluginJobEnqueueResult,
  type PluginJobSummary,
} from "../services/pluginJobs/pluginJobService.ts";
import { jobErrorMessage } from "../services/pluginJobs/pluginJobLog.ts";

const messageJobs = new Hono<HonoEnv>();

const SUBJECT_TYPE = "message";



export interface MessageJobView {
  jobId: number;
  pluginId: number;
  status: string;
  result: unknown;
  error: { code: string; message: string } | null;
  createdAt: string | null;
  completedAt: string | null;
}


async function getClientAuth(c: any) {
  const drizzle = createDrizzle(c.env.DB);
  const authenticator = new Authenticator(drizzle);
  const auth = await authenticator.requireClient(c.req.raw, c.env);
  if (!auth) return null;
  return { ...auth, drizzle };
}







const STATUS_TITLES = {
  404: "Not Found",
  409: "Conflict",
  429: "Too Many Requests",
  503: "Service Unavailable",
} as const satisfies Record<EnqueueHttpStatus, string>;

function statusTitle(status: EnqueueHttpStatus): string {
  return STATUS_TITLES[status];
}


type EnqueueErrorCode =
  | Extract<PluginJobEnqueueResult, { status: "skipped" }>["code"]
  | Extract<PluginJobEnqueueResult, { status: "error" }>["code"];


const ENQUEUE_ERROR_DESCRIPTIONS = {
  "not-found": "Message or plugin not found",
  "plugin-unavailable": "Plugin is not available for message jobs",
  config: "Plugin configuration is invalid",
  "secret-config": "Plugin configuration is invalid",
  "secret-decrypt-failed": "Plugin configuration is invalid",
  "secret-reentry-required": "Plugin configuration is invalid",
  "outbound-blocked": "Plugin outbound target is not allowed",
  "quota-exceeded": "Daily quota exceeded",
  "quota-read-failed": "Quota is temporarily unavailable",
  "enqueue-send-failed": "Plugin job queue is temporarily unavailable",
} satisfies Record<EnqueueErrorCode, string>;

function enqueueErrorDescription(code: EnqueueErrorCode): string {
  return ENQUEUE_ERROR_DESCRIPTIONS[code];
}

function enqueueFailure(result: Exclude<PluginJobEnqueueResult, { status: "ok" }>): Response {
  const code: EnqueueErrorCode =
    result.status === "skipped" ? result.code : "enqueue-send-failed";
  return ApiResponse.error(
    statusTitle(result.httpStatus),
    result.httpStatus,
    enqueueErrorDescription(code)
  );
}


function parseJobResult(raw: string | null): unknown {
  if (raw === null) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}






function serializeJob(job: PluginJobSummary): MessageJobView {
  const terminalFailure = job.status === "failed" || job.status === "dead";
  const errorCode = job.lastErrorCode ?? "internal";

  return {
    jobId: job.id,
    pluginId: job.pluginId,
    status: job.status,
    result: parseJobResult(job.result),
    error: terminalFailure
      ? { code: errorCode, message: jobErrorMessage(errorCode) }
      : null,
    createdAt: formatDate(job.createdAt),
    completedAt: formatDate(job.completedAt),
  } satisfies MessageJobView;
}


messageJobs.post("/:id/jobs", async (c) => {
  const rawId = c.req.param("id");
  const invalidIdResponse = validatePositiveIntegerId(rawId);
  if (invalidIdResponse) return invalidIdResponse;
  const messageId = parsePositiveIntegerId(rawId)!;

  const auth = await getClientAuth(c);
  if (!auth) {
    return ApiResponse.error("Unauthorized", 401, "Client token or Basic auth required");
  }

  const parsed = await parseJsonBody<unknown>(c.req.raw);
  if (!parsed.ok) return parsed.response;
  if (typeof parsed.data !== "object" || parsed.data === null || Array.isArray(parsed.data)) {
    return ApiResponse.error("Bad Request", 400, "Invalid JSON body");
  }

  const pluginId = (parsed.data as Record<string, unknown>).pluginId;
  if (typeof pluginId !== "number" || !Number.isSafeInteger(pluginId) || pluginId <= 0) {
    return ApiResponse.error(
      "Bad Request",
      400,
      "Invalid pluginId: must be a positive integer"
    );
  }

  const runtime = createPluginJobRuntime({ drizzle: auth.drizzle, env: c.env });


  const result = await runtime.service.enqueue({
    userId: auth.userId,
    pluginId,
    subjectType: SUBJECT_TYPE,
    subjectId: messageId,
    source: "manual",
  });

  if (result.status !== "ok") return enqueueFailure(result);

  return ApiResponse.json({ jobId: result.job.id, status: result.job.status }, 202);
});


messageJobs.get("/:id/jobs", async (c) => {
  const rawId = c.req.param("id");
  const invalidIdResponse = validatePositiveIntegerId(rawId);
  if (invalidIdResponse) return invalidIdResponse;
  const messageId = parsePositiveIntegerId(rawId)!;

  const auth = await getClientAuth(c);
  if (!auth) {
    return ApiResponse.error("Unauthorized", 401, "Client token or Basic auth required");
  }

  const pluginIdParam = new URL(c.req.url).searchParams.get("pluginId");
  let pluginId: number | undefined;
  if (pluginIdParam !== null) {
    const parsedPluginId = parsePositiveIntegerId(pluginIdParam);
    if (parsedPluginId === null) {
      return ApiResponse.error(
        "Bad Request",
        400,
        "Invalid pluginId parameter: must be a positive integer"
      );
    }
    pluginId = parsedPluginId;
  }

  const runtime = createPluginJobRuntime({ drizzle: auth.drizzle, env: c.env });

  const history = await runtime.service.getSubjectJobHistory({
    userId: auth.userId,
    subjectType: SUBJECT_TYPE,
    subjectId: messageId,
    pluginId,
    limit: SUBJECT_JOBS_DEFAULT_LIMIT,
  });

  if (!history.found) {
    return ApiResponse.error("Not Found", 404, "Message not found");
  }

  return ApiResponse.json({
    messageDeleted: history.messageDeleted,
    jobs: history.jobs.map(serializeJob),
  });
});

export { messageJobs };
