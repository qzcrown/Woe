import { Message, PagedMessages, Paging } from "../types/index.ts";
import { ApiResponse, safeJsonParse, formatDate } from "../utils/response.ts";
import { DrizzleDB } from "../drizzle/index.ts";
import { messages, applications } from "../models/index.ts";
import { eq, sql, desc } from "drizzle-orm";

// Message Management API handlers for Woe - Gotify compatible core feature
export class MessageHandlers {
  private clients: Set<WebSocket> = new Set();

  constructor(private drizzle: DrizzleDB) {}

  // Helper to map DB result to Message type
  private mapToMessage(row: any): Message {
    return {
      id: row.id,
      appid: row.appId,
      message: row.message,
      title: row.title,
      priority: row.priority,
      date: formatDate(row.date) || "", // date should not be null in messages
      extras: safeJsonParse(row.extras)
    };
  }

  // Broadcast message to all connected clients
  private broadcastMessage(message: Message) {
    const payload = JSON.stringify(message);
    for (const client of this.clients) {
      try {
        client.send(payload);
      } catch (error) {
        console.error("Failed to send message to client:", error);
        this.clients.delete(client);
      }
    }
  }

  // GET /message - Return all messages for the current user
  async getAllMessages(userId: number, limit: number = 100, since: number = 0, origin?: string): Promise<Response> {
    try {
      // Limit is required by spec (default 100, max 200)
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
        .limit(effectiveLimit);

      const results = await query.execute();
      
      const mappedMessages = results.map(row => ({
        id: row.id,
        appid: row.appId,
        message: row.message,
        title: row.title || "",
        priority: row.priority || 0,
        date: formatDate(row.date) || "",
        extras: safeJsonParse(row.extras)
      }));

      // Get last message for pagination
      const lastMessage = mappedMessages.length > 0 ? mappedMessages[mappedMessages.length - 1] : null;

      // Construct paging object
      const paging: Paging = {
        size: mappedMessages.length,
        limit: effectiveLimit,
        since: lastMessage ? lastMessage.id : since
      };

      if (lastMessage) {
        const nextPath = `/message?limit=${effectiveLimit}&since=${lastMessage.id}`;
        paging.next = origin ? `${origin}${nextPath}` : nextPath;
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

  // POST /message - Create a message (核心功能)
  async createMessage(appId: number, message: string, title?: string, priority?: number, extras?: any): Promise<Response> {
    // Validate priority range (0-10 for safety)
    if (priority !== undefined && (priority < 0 || priority > 10)) {
      return ApiResponse.error("Bad Request", 400, "Priority must be between 0 and 10");
    }

    try {
      // Get application info to determine user
      const appResult = await this.drizzle
        .select({ userId: applications.userId })
        .from(applications)
        .where(eq(applications.id, appId))
        .get();

      if (!appResult) {
        return ApiResponse.error("Not Found", 404, "Application not found");
      }

      const userId = appResult.userId;

      // Handle extras parsing if it's a string, or leave as is if it's already a string suitable for DB
      const extrasStr = typeof extras === 'object' ? JSON.stringify(extras) : (typeof extras === 'string' ? extras : null);

      const result = await this.drizzle
        .insert(messages)
        .values({
          userid: userId,
          appid: appId,
          message,
          title: title || "",
          priority: priority || 0,
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
        priority: row.priority || 0,
        date: formatDate(row.date) || "",
        extras: safeJsonParse(row.extras)
      };

      // 更新应用的最后使用时间（心跳），带有频率限制
      try {
        await this.drizzle
          .update(applications)
          .set({ lastUsed: sql`CURRENT_TIMESTAMP` })
          .where(sql`${applications.id} = ${appId} AND (${applications.lastUsed} IS NULL OR ${applications.lastUsed} < datetime('now', '-1 minute'))`);
      } catch (error) {
        console.error("Failed to update application last_used:", error);
        // 静默失败，不影响消息创建流程
      }

      this.broadcastMessage(newMessage);

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

  // GET /application/{id}/message - Return all messages from a specific application
  async getApplicationMessages(userId: number, appId: string, limit: number = 100, since: number = 0, origin?: string): Promise<Response> {
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
        .limit(effectiveLimit);

      const results = await query.execute();
      
      const mappedMessages = results.map(row => ({
        id: row.id,
        appid: row.appId,
        message: row.message,
        title: row.title || "",
        priority: row.priority || 0,
        date: formatDate(row.date) || "",
        extras: safeJsonParse(row.extras)
      }));

      // Get last message for pagination
      const lastMessage = mappedMessages.length > 0 ? mappedMessages[mappedMessages.length - 1] : null;

      const paging: Paging = {
        size: mappedMessages.length,
        limit: effectiveLimit,
        since: lastMessage ? lastMessage.id : since
      };

      if (lastMessage) {
        const nextPath = `/application/${appId}/message?limit=${effectiveLimit}&since=${lastMessage.id}`;
        paging.next = origin ? `${origin}${nextPath}` : nextPath;
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

  // DELETE /message/{id} - Delete a specific message
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

  // DELETE /message - Delete all messages
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

  // DELETE /application/{id}/message - Delete all messages from a specific application
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

  // GET /stream - WebSocket endpoint for real-time message streaming
  async handleWebSocket(websocket: WebSocket): Promise<void> {
    try {
      // Accept WebSocket connection
      websocket.accept();

      this.clients.add(websocket);
      console.log("WebSocket connection established");

      websocket.addEventListener("message", (event) => {
        // Handle incoming WebSocket messages if needed
        // Typically clients don't send messages in Gotify, but we can keep alive or handle pings
        try {
           // Optional: Handle ping/pong or simple commands
        } catch (error) {
          console.error("Invalid WebSocket message format:", error);
        }
      });

      websocket.addEventListener("close", () => {
        console.log("WebSocket connection closed");
        this.clients.delete(websocket);
      });

      websocket.addEventListener("error", (error) => {
        console.error("WebSocket error:", error);
        this.clients.delete(websocket);
      });

    } catch (error) {
      console.error("WebSocket setup error:", error);
      websocket.close(1011, "Internal server error");
    }
  }
}
