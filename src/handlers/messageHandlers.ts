





import { Message, PagedMessages, Paging, Env } from "../types/index.ts";
import { ApiResponse, formatDate } from "../utils/response.ts";
import { parseMessageExtras } from "../utils/messageExtras.ts";
import { isValidMessagePaging, invalidMessagePagingResponse } from "../utils/messagePaging.ts";
import { validateMessageCreateFields } from "../utils/messageCreateValidation.ts";
import { DrizzleDB } from "../drizzle/index.ts";
import { messages, applications } from "../models/index.ts";
import { eq, sql, desc, count } from "drizzle-orm";
import { MessageStreamHub } from "../services/messageStreamHub.ts";
import type { Authenticator } from "../middleware/auth.ts";




export interface MessageCreateTarget {
  appId: number;
  userId: number;
}


export type MessageCreateAuth =
  | { kind: "app"; appId: number; userId: number }
  | { kind: "client"; userId: number };






export async function authenticateMessageCreate(
  authenticator: Pick<Authenticator, "requireApp" | "requireClient">,
  request: Request,
  env: Env
): Promise<MessageCreateAuth | Response> {
  const appAuth = await authenticator.requireApp(request);
  if (appAuth && appAuth.resourceId) {
    return { kind: "app", appId: appAuth.resourceId, userId: appAuth.userId };
  }

  const clientAuth = await authenticator.requireClient(request, env);
  if (!clientAuth) {
    return ApiResponse.error("Unauthorized", 401, "Application token, client token or Basic auth required");
  }
  return { kind: "client", userId: clientAuth.userId };
}







export async function resolveMessageCreateTarget(
  auth: MessageCreateAuth,
  drizzle: DrizzleDB,
  body: { appid?: number }
): Promise<MessageCreateTarget | Response> {
  if (auth.kind === "app") {
    return { appId: auth.appId, userId: auth.userId };
  }

  const appid = body.appid;
  if (typeof appid !== "number" || !Number.isSafeInteger(appid) || appid <= 0) {
    return ApiResponse.error("Bad Request", 400, "appid is required when not authenticating with an application token");
  }

  const appRow = await drizzle
    .select({ id: applications.id, userId: applications.userId })
    .from(applications)
    .where(eq(applications.id, appid))
    .get();

  if (!appRow || appRow.userId !== auth.userId) {
    return ApiResponse.error("Bad Request", 400, "appid not found");
  }

  return { appId: appRow.id, userId: auth.userId };
}


export class MessageHandlers {
  constructor(
    private drizzle: DrizzleDB,
    private streamHub?: MessageStreamHub
  ) {}



  private mapToMessage(row: any): Message {
    return {
      id: row.id,
      appid: row.appId,
      message: row.message,
      title: row.title || "",
      priority: row.priority ?? 0,
      date: formatDate(row.date) || "",
      extras: parseMessageExtras(row.extras)
    };
  }



  async getAllMessages(userId: number, limit: number = 100, since: number = 0): Promise<Response> {


    if (!isValidMessagePaging(limit, since)) {
      return invalidMessagePagingResponse(limit, since);
    }
    try {

      const effectiveLimit = Math.min(Math.max(limit, 1), 200);

      const query = this.drizzle
        .select({
          id: messages.id,
          userId: messages.userid,
          appId: messages.appid,
          message: messages.message,
          title: messages.title,
          priority: messages.priority,
          date: messages.date,
          expires: messages.expires,
          extras: messages.extras
        })
        .from(messages)
        .where(since > 0 ? sql`${messages.userid} = ${userId} AND ${messages.id} < ${since}` : eq(messages.userid, userId))
        .orderBy(desc(messages.id))
        .limit(effectiveLimit + 1);

      const results = await query.execute();
      const hasNextPage = results.length > effectiveLimit;
      const pageResults = hasNextPage ? results.slice(0, effectiveLimit) : results;

      const mappedMessages = pageResults.map(row => ({
        id: row.id,
        appid: row.appId,
        message: row.message,
        title: row.title || "",
        priority: row.priority ?? 0,
        date: formatDate(row.date) || "",
        extras: parseMessageExtras(row.extras)
      }));


      const lastMessage = mappedMessages.length > 0 ? mappedMessages[mappedMessages.length - 1] : null;




      const paging: Paging = {
        size: mappedMessages.length,
        limit: effectiveLimit,
        since: hasNextPage && lastMessage ? lastMessage.id : 0
      };

      if (hasNextPage && lastMessage) {
        const nextPath = `/message?limit=${effectiveLimit}&since=${lastMessage.id}`;
        paging.next = nextPath;
      }

      const response: PagedMessages = {
        paging,
        messages: mappedMessages
      };

      return ApiResponse.json(response);
    } catch (error) {
      return ApiResponse.error("Database error", 500, "Failed to retrieve messages");
    }
  }


  async getMessageById(userId: number, id: string): Promise<Response> {
    try {
      const messageId = parseInt(id);
      if (Number.isNaN(messageId)) {
        return ApiResponse.error("Bad Request", 400, "Invalid message ID");
      }

      const row = await this.drizzle
        .select({
          id: messages.id,
          appId: messages.appid,
          message: messages.message,
          title: messages.title,
          priority: messages.priority,
          date: messages.date,
          extras: messages.extras
        })
        .from(messages)
        .where(sql`${messages.id} = ${messageId} AND ${messages.userid} = ${userId}`)
        .get();

      if (!row) {
        return ApiResponse.error("Not Found", 404, "Message not found");
      }

      return ApiResponse.json(this.mapToMessage(row));
    } catch (error) {
      return ApiResponse.error("Database error", 500, "Failed to retrieve message");
    }
  }



  async getMessageCount(userId: number): Promise<Response> {
    try {
      const result = await this.drizzle
        .select({ count: count() })
        .from(messages)
        .where(eq(messages.userid, userId))
        .get();

      return ApiResponse.json({ count: result?.count || 0 });
    } catch (error) {
      return ApiResponse.error("Database error", 500, "Failed to retrieve message count");
    }
  }



  async createMessage(appId: number, message: string, title?: string, priority?: number, extras?: any): Promise<Response> {


    const validated = validateMessageCreateFields({ message, title, priority, extras });
    if (!validated.ok) {
      return validated.response;
    }
    const fields = validated.value;

    try {
      const appResult = await this.drizzle
        .select({
          userId: applications.userId,
          defaultPriority: applications.defaultPriority,
          name: applications.name
        })
        .from(applications)
        .where(eq(applications.id, appId))
        .get();

      if (!appResult) {
        return ApiResponse.error("Not Found", 404, "Application not found");
      }

      const userId = appResult.userId;

      const effectivePriority = fields.priority ?? appResult.defaultPriority ?? 0;


      const extrasStr = typeof fields.extras === "object" ? JSON.stringify(fields.extras) : null;

      const result = await this.drizzle
        .insert(messages)
        .values({
          userid: userId,
          appid: appId,
          message: fields.message,

          title: fields.title && fields.title.trim() ? fields.title : appResult.name,
          priority: effectivePriority,
          extras: extrasStr
        })
        .returning({
          id: messages.id,
          appId: messages.appid,
          message: messages.message,
          title: messages.title,
          priority: messages.priority,
          date: messages.date,
          extras: messages.extras
        });

      if (!result || result.length === 0) {
        return ApiResponse.error("Bad Request", 400, "Message creation failed");
      }

      const row = result[0];
      const newMessage: Message = {
        id: row.id,
        appid: row.appId,
        message: row.message,
        title: row.title || "",
        priority: row.priority ?? 0,
        date: formatDate(row.date) || "",
        extras: parseMessageExtras(row.extras)
      };


      try {
        await this.drizzle
          .update(applications)
          .set({ lastUsed: sql`CURRENT_TIMESTAMP` })
          .where(sql`${applications.id} = ${appId} AND (${applications.lastUsed} IS NULL OR ${applications.lastUsed} < datetime('now', '-1 minute'))`);
      } catch (error) {
        console.error("Failed to update application last_used:", error);

      }

      if (this.streamHub) {
        try {
          await this.streamHub.broadcast(userId as number, newMessage);
        } catch (error) {
          console.error("Failed to broadcast message to websocket subscribers:", error);
        }
      }

      try {
        const userIdNum = userId as number;
        const { PluginManager } = await import('../plugins/manager.ts');
        const pm = new PluginManager(this.drizzle);
        await pm.emit(userIdNum, 'message.create', {
          userId: userIdNum,
          now: new Date().toISOString(),
          message: {
            id: newMessage.id,
            appId: newMessage.appid,
            date: newMessage.date,
            title: newMessage.title,
            priority: newMessage.priority,
            content: newMessage.message,
            extras: newMessage.extras || undefined
          }
        });
      } catch {}

      return ApiResponse.json(newMessage);
    } catch (error) {
      return ApiResponse.error("Database error", 500, "Failed to create message");
    }
  }



  async getApplicationMessages(userId: number, appId: string, limit: number = 100, since: number = 0): Promise<Response> {

    if (!isValidMessagePaging(limit, since)) {
      return invalidMessagePagingResponse(limit, since);
    }
    try {
      const numericAppId = parseInt(appId);
      const effectiveLimit = Math.min(Math.max(limit, 1), 200);

      let query = this.drizzle
        .select({
          id: messages.id,
          userId: messages.userid,
          appId: messages.appid,
          message: messages.message,
          title: messages.title,
          priority: messages.priority,
          date: messages.date,
          expires: messages.expires,
          extras: messages.extras
        })
        .from(messages)
        .where(since > 0
          ? sql`${messages.appid} = ${numericAppId} AND ${messages.userid} = ${userId} AND ${messages.id} < ${since}`
          : sql`${messages.appid} = ${numericAppId} AND ${messages.userid} = ${userId}`)
        .orderBy(desc(messages.id))
        .limit(effectiveLimit + 1);

      const results = await query.execute();
      const hasNextPage = results.length > effectiveLimit;
      const pageResults = hasNextPage ? results.slice(0, effectiveLimit) : results;

      const mappedMessages = pageResults.map(row => ({
        id: row.id,
        appid: row.appId,
        message: row.message,
        title: row.title || "",
        priority: row.priority || 0,
        date: formatDate(row.date) || "",
        extras: parseMessageExtras(row.extras)
      }));


      const lastMessage = mappedMessages.length > 0 ? mappedMessages[mappedMessages.length - 1] : null;



      const paging: Paging = {
        size: mappedMessages.length,
        limit: effectiveLimit,
        since: hasNextPage && lastMessage ? lastMessage.id : 0
      };

      if (hasNextPage && lastMessage) {
        const nextPath = `/application/${appId}/message?limit=${effectiveLimit}&since=${lastMessage.id}`;
        paging.next = nextPath;
      }

      const response: PagedMessages = {
        paging,
        messages: mappedMessages
      };

      return ApiResponse.json(response);
    } catch (error) {
      return ApiResponse.error("Database error", 500, "Failed to retrieve application messages");
    }
  }



  async deleteMessage(userId: number, id: string): Promise<Response> {
    try {
      const messageId = parseInt(id);

      const result = await this.drizzle
        .delete(messages)
        .where(sql`${messages.id} = ${messageId} AND ${messages.userid} = ${userId}`);

      if (result.meta.changes === 0) {
        return ApiResponse.error("Not Found", 404, "Message not found");
      }

      try {
        const userIdNum = userId;
        const { PluginManager } = await import('../plugins/manager.ts');
        const pm = new PluginManager(this.drizzle);
        await pm.emit(userIdNum, 'message.delete', {
          userId: userIdNum,
          now: new Date().toISOString(),
          message: { id: messageId, appId: 0, content: '' }
        });
      } catch {}

      return ApiResponse.json({});
    } catch (error) {
      return ApiResponse.error("Database error", 500, "Failed to delete message");
    }
  }



  async deleteAllMessages(userId: number): Promise<Response> {
    try {
      await this.drizzle
        .delete(messages)
        .where(eq(messages.userid, userId));

      return ApiResponse.json({});
    } catch (error) {
      return ApiResponse.error("Database error", 500, "Failed to delete messages");
    }
  }



  async deleteApplicationMessages(userId: number, appId: string): Promise<Response> {
    try {
      const numericAppId = parseInt(appId);

      await this.drizzle
        .delete(messages)
        .where(sql`${messages.appid} = ${numericAppId} AND ${messages.userid} = ${userId}`);

      try {
        const { PluginManager } = await import('../plugins/manager.ts');
        const pm = new PluginManager(this.drizzle);
        await pm.emit(userId, 'message.delete', {
          userId,
          now: new Date().toISOString()
        });
      } catch {}

      return ApiResponse.json({});
    } catch (error) {
      return ApiResponse.error("Database error", 500, "Failed to delete messages");
    }
  }

}
