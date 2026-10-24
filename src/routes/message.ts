









import { Hono } from "hono";
import { HonoEnv } from "../types/hono.ts";
import { createDrizzle } from "../drizzle/index.ts";
import { Authenticator } from "../middleware/auth.ts";
import { MessageHandlers, MessageCreateTarget, authenticateMessageCreate, resolveMessageCreateTarget } from "../handlers/messageHandlers.ts";
import { ApiResponse } from "../utils/response.ts";
import { DurableObjectMessageStreamHub } from "../services/messageStreamHub.ts";
import { PushOutboxService } from "../services/push/outboxService.ts";
import { publishOutboxJobs } from "../services/push/queuePublisher.ts";
import { isEnqueueWritePaused } from "../services/writeGateService.ts";
import { validatePositiveIntegerId } from "../utils/routeParams.ts";
import { parseMessagePaging } from "../utils/messagePaging.ts";
import { validateMessageCreateFields } from "../utils/messageCreateValidation.ts";
import { MessageCreateBody, parseMessageCreateRequest } from "../utils/messageRequestBinding.ts";

const message = new Hono<HonoEnv>();


async function getClientAuth(c: any) {
  const drizzle = createDrizzle(c.env.DB);
  const authenticator = new Authenticator(drizzle);
  const streamHub = c.env.MESSAGE_STREAM_HUB
    ? new DurableObjectMessageStreamHub(c.env.MESSAGE_STREAM_HUB)
    : undefined;
  const messageHandlers = new MessageHandlers(drizzle, streamHub);

  const basicAuthUser = await authenticator.authenticateBasic(c.req.raw, c.env);
  if (basicAuthUser) {
    return { userId: basicAuthUser.id, messageHandlers, tokenType: "client" as const };
  }
  const tokenInfo = await authenticator.authenticate(c.req.raw);
  if (!tokenInfo || tokenInfo.tokenType !== "client") {
    return null;
  }
  return { ...tokenInfo, messageHandlers };
}


message.get("/", async (c) => {
  const auth = await getClientAuth(c);
  if (!auth) {
    return ApiResponse.error("Unauthorized", 401, "Client token or Basic auth required");
  }

  const parsed = parseMessagePaging(new URL(c.req.url).searchParams);
  if (!parsed.ok) {
    return parsed.response;
  }
  return await auth.messageHandlers.getAllMessages(auth.userId, parsed.value.limit, parsed.value.since);
});


message.get("/count", async (c) => {
  const auth = await getClientAuth(c);
  if (!auth) {
    return ApiResponse.error("Unauthorized", 401, "Client token or Basic auth required");
  }
  return await auth.messageHandlers.getMessageCount(auth.userId);
});


message.get("/:id", async (c) => {
  const id = c.req.param("id");
  const invalidIdResponse = validatePositiveIntegerId(id);
  if (invalidIdResponse) {
    return invalidIdResponse;
  }

  const auth = await getClientAuth(c);
  if (!auth) {
    return ApiResponse.error("Unauthorized", 401, "Client token or Basic auth required");
  }
  return await auth.messageHandlers.getMessageById(auth.userId, id);
});


message.post("/", async (c) => {
  const drizzle = createDrizzle(c.env.DB);


  if (await isEnqueueWritePaused(drizzle)) {
    return ApiResponse.error("Service Unavailable", 503, "Message creation is paused for deployment maintenance (enqueue write gate)");
  }




  const authenticator = new Authenticator(drizzle);
  let auth;
  try {
    auth = await authenticateMessageCreate(authenticator, c.req.raw, c.env);
  } catch (error) {
    console.error("Failed to authenticate message create:", error);
    return ApiResponse.error("Internal Server Error", 500, "Internal server error");
  }
  if (auth instanceof Response) return auth;



  const bound = await parseMessageCreateRequest(c.req.raw);
  if (!bound.ok) return bound.response;
  const body: MessageCreateBody = bound.data;


  const validated = validateMessageCreateFields(body);
  if (!validated.ok) {
    return validated.response;
  }
  const fields = validated.value;

  const streamHub = c.env.MESSAGE_STREAM_HUB
    ? new DurableObjectMessageStreamHub(c.env.MESSAGE_STREAM_HUB)
    : undefined;
  const messageHandlers = new MessageHandlers(drizzle, streamHub);

  let target: MessageCreateTarget | Response;
  try {

    target = await resolveMessageCreateTarget(auth, drizzle, body);
  } catch (error) {
    console.error("Failed to resolve message create target:", error);
    return ApiResponse.error("Internal Server Error", 500, "Internal server error");
  }
  if (target instanceof Response) {
    return target;
  }
  const { appId, userId } = target;

  const response = await messageHandlers.createMessage(
    appId,
    fields.message,
    fields.title,
    fields.priority,
    fields.extras
  );


  const pushQueue = c.env.PUSH_QUEUE;
  if (response.ok && pushQueue) {
    c.executionCtx.waitUntil((async () => {
      try {
        const created = await response.clone().json() as { id?: number };
        if (typeof created.id !== "number") {
          return;
        }

        const outbox = new PushOutboxService(drizzle);
        const outboxIds = await outbox.getPendingJobIdsByMessage(userId, created.id);
        if (!outboxIds.length) {
          return;
        }

        const traceId = typeof crypto?.randomUUID === "function"
          ? crypto.randomUUID()
          : `${Date.now()}-${Math.random().toString(36).slice(2)}`;

        await publishOutboxJobs(pushQueue, outboxIds, { traceId });
      } catch (error) {
        console.error("Failed to publish outbox jobs to push queue", error);
      }
    })());
  }

  return response;
});


message.delete("/", async (c) => {
  const auth = await getClientAuth(c);
  if (!auth) {
    return ApiResponse.error("Unauthorized", 401, "Client token or Basic auth required");
  }
  return await auth.messageHandlers.deleteAllMessages(auth.userId);
});


message.delete("/:id", async (c) => {
  const id = c.req.param("id");
  const invalidIdResponse = validatePositiveIntegerId(id);
  if (invalidIdResponse) {
    return invalidIdResponse;
  }

  const auth = await getClientAuth(c);
  if (!auth) {
    return ApiResponse.error("Unauthorized", 401, "Client token or Basic auth required");
  }
  return await auth.messageHandlers.deleteMessage(auth.userId, id);
});

export { message };
