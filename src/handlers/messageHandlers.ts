import { Message, PagedMessages, Paging } from "../types/index.ts";
import { ApiResponse, safeJsonParse, formatDate } from "../utils/response.ts";

// Message Management API handlers for Woe - Gotify compatible core feature
export class MessageHandlers {
  private clients: Set<WebSocket> = new Set();

  constructor(private db: D1Database) {}

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
      let query = `
        SELECT m.id, m.userid as userId, m.appid as appId, m.message, m.title, m.priority,
                m.date, m.expires, m.extras, a.name as applicationName
        FROM messages m
        LEFT JOIN applications a ON m.appid = a.id
        WHERE m.userid = ?
      `;
      const params = [userId];

      if (since > 0) {
        query += ` AND m.id < ?`;
        params.push(since);
      }

      query += ` ORDER BY m.id DESC`;

      // Limit is required by spec (default 100, max 200)
      const effectiveLimit = Math.min(Math.max(limit, 1), 200);
      query += ` LIMIT ?`;
      params.push(effectiveLimit);

      const result = await this.db.prepare(query).bind(...params).all();
      const messages = result.results.map(row => this.mapToMessage(row));

      // Get last message for pagination (defined before use)
      const lastMessage = messages.length > 0 ? messages[messages.length - 1] : null;

      // Construct paging object
      const paging: Paging = {
        size: messages.length,
        limit: effectiveLimit,
        since: lastMessage ? lastMessage.id : since
      };

      if (lastMessage) {
        const nextPath = `/message?limit=${effectiveLimit}&since=${lastMessage.id}`;
        paging.next = origin ? `${origin}${nextPath}` : nextPath;
      }

      const response: PagedMessages = {
        paging,
        messages
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
      const appResult = await this.db.prepare(`
        SELECT user_id FROM applications WHERE id = ?
      `).bind(appId).first();

      if (!appResult) {
        return ApiResponse.error("Not Found", 404, "Application not found");
      }

      const userId = (appResult as any).user_id;

      // Handle extras parsing if it's a string, or leave as is if it's already a string suitable for DB
      // Typically extras is passed as JSON object in body, but here we receive it as argument.
      // Assuming the handler caller parses body. If extras is object, we should stringify it for DB storage.
      // But based on typical usage, let's ensure it's stored as string.
      const extrasStr = typeof extras === 'object' ? JSON.stringify(extras) : (typeof extras === 'string' ? extras : null);

      const result = await this.db.prepare(`
        INSERT INTO messages (userid, appid, message, title, priority, extras)
        VALUES (?, ?, ?, ?, ?, ?)
        RETURNING id, userid as userId, appid as appId, message, title, priority, date, expires, extras
      `).bind(userId, appId, message, title || "", priority || 0, extrasStr).first();

      if (!result) {
        return ApiResponse.error("Bad Request", 400, "Message creation failed");
      }

      const newMessage = this.mapToMessage(result);
      this.broadcastMessage(newMessage);

      try {
        const userIdNum = (appResult as any).user_id as number
        const { PluginManager } = await import('../plugins/manager.ts')
        const pm = new PluginManager(this.db)
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
        })
      } catch {}

      return ApiResponse.json(newMessage);
    } catch (error) {
      return ApiResponse.error("Database error", 500, "Failed to create message");
    }
  }

  // GET /application/{id}/message - Return all messages from a specific application
  async getApplicationMessages(userId: number, appId: string, limit: number = 100, since: number = 0, origin?: string): Promise<Response> {
    try {
      let query = `
        SELECT id, userid as userId, appid as appId, message, title, priority,
               date, expires, extras
        FROM messages
        WHERE appid = ? AND userid = ?
      `;
      const params = [parseInt(appId), userId];

      if (since > 0) {
        query += ` AND id < ?`;
        params.push(since);
      }

      query += ` ORDER BY id DESC`;

      const effectiveLimit = Math.min(Math.max(limit, 1), 200);
      query += ` LIMIT ?`;
      params.push(effectiveLimit);

      const result = await this.db.prepare(query).bind(...params).all();
      const messages = result.results.map(row => this.mapToMessage(row));

      // Get last message for pagination (defined before use)
      const lastMessage = messages.length > 0 ? messages[messages.length - 1] : null;

      const paging: Paging = {
        size: messages.length,
        limit: effectiveLimit,
        since: lastMessage ? lastMessage.id : since
      };

      if (lastMessage) {
        const nextPath = `/application/${appId}/message?limit=${effectiveLimit}&since=${lastMessage.id}`;
        paging.next = origin ? `${origin}${nextPath}` : nextPath;
      }

      const response: PagedMessages = {
        paging,
        messages
      };

      return ApiResponse.json(response);
    } catch (error) {
      return ApiResponse.error("Database error", 500, "Failed to retrieve application messages");
    }
  }

  // DELETE /message/{id} - Delete a specific message
  async deleteMessage(userId: number, id: string): Promise<Response> {
    try {
      const result = await this.db.prepare(`
        DELETE FROM messages
        WHERE id = ? AND userid = ?
      `).bind(parseInt(id), userId).run();

      if (result.meta.changes === 0) {
        return ApiResponse.error("Not Found", 404, "Message not found");
      }

      try {
        const userIdNum = userId
        const { PluginManager } = await import('../plugins/manager.ts')
        const pm = new PluginManager(this.db)
        await pm.emit(userIdNum, 'message.delete', {
          userId: userIdNum,
          now: new Date().toISOString(),
          message: { id: parseInt(id), appId: 0, content: '' }
        })
      } catch {}

      return ApiResponse.json({});
    } catch (error) {
      return ApiResponse.error("Database error", 500, "Failed to delete message");
    }
  }

  // DELETE /message - Delete all messages
  async deleteAllMessages(userId: number): Promise<Response> {
    try {
      await this.db.prepare(`
        DELETE FROM messages
        WHERE userid = ?
      `).bind(userId).run();

      return ApiResponse.json({});
    } catch (error) {
      return ApiResponse.error("Database error", 500, "Failed to delete messages");
    }
  }

  // DELETE /application/{id}/message - Delete all messages from a specific application
  async deleteApplicationMessages(userId: number, appId: string): Promise<Response> {
    try {
      await this.db.prepare(`
        DELETE FROM messages
        WHERE appid = ? AND userid = ?
      `).bind(parseInt(appId), userId).run();

      try {
        const { PluginManager } = await import('../plugins/manager.ts')
        const pm = new PluginManager(this.db)
        await pm.emit(userId, 'message.delete', {
          userId,
          now: new Date().toISOString()
        })
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
