import { generateToken } from "../middleware/auth.ts";
import { Client } from "../types/index.ts";
import { ApiResponse, formatDate } from "../utils/response.ts";
import { DrizzleDB } from "../drizzle/index.ts";
import { clients } from "../models/index.ts";
import { eq, sql } from "drizzle-orm";

export class ClientHandlers {
  constructor(private drizzle: DrizzleDB) {}

  // Helper to map DB result to Client type
  private mapToClient(row: any): Client {
    return {
      id: row.id,
      token: row.token,
      name: row.name,
      lastUsed: formatDate(row.lastUsed) || null
    };
  }

  // 更新客户端的最后使用时间（带频率限制）
  async updateLastUsed(clientId: number): Promise<void> {
    try {
      // 频率限制：仅当超过1分钟未更新或从未更新时才更新
      await this.drizzle
        .update(clients)
        .set({ lastUsed: sql`CURRENT_TIMESTAMP` })
        .where(sql`${clients.id} = ${clientId} AND (${clients.lastUsed} IS NULL OR ${clients.lastUsed} < datetime('now', '-1 minute'))`);
    } catch (error) {
      console.error("Failed to update client last_used:", error);
      // 静默失败
    }
  }

  // GET /client - Return all clients for the current user
  async getAllClients(userId: number): Promise<Response> {
    try {
      const clientsList = await this.drizzle
        .select({
          id: clients.id,
          userId: clients.userId,
          token: clients.token,
          name: clients.name,
          lastUsed: clients.lastUsed
        })
        .from(clients)
        .where(eq(clients.userId, userId))
        .orderBy(clients.id);

      const mappedClients = clientsList.map(row => ({
        id: row.id,
        token: row.token,
        name: row.name,
        lastUsed: formatDate(row.lastUsed) || null
      }));

      return ApiResponse.json(mappedClients);
    } catch (error) {
      return ApiResponse.error("Database error", 500, "Failed to retrieve clients");
    }
  }

  // POST /client - Create a client
  async createClient(userId: number, name: string): Promise<Response> {
    try {
      const token = generateToken("client");

      const result = await this.drizzle
        .insert(clients)
        .values({
          userId,
          token,
          name
        })
        .returning({
          id: clients.id,
          userId: clients.userId,
          token: clients.token,
          name: clients.name,
          lastUsed: clients.lastUsed
        });

      if (!result || result.length === 0) {
        return ApiResponse.error("Client creation failed", 400, "Could not create client");
      }

      const row = result[0];
      const client: Client = {
        id: row.id,
        token: row.token,
        name: row.name,
        lastUsed: formatDate(row.lastUsed) || null
      };

      try {
        const { PluginManager } = await import('../plugins/manager.ts')
        const pm = new PluginManager(this.drizzle)
        await pm.emit(userId, 'client.create', {
          userId,
          now: new Date().toISOString(),
          client: { id: client.id, name: client.name }
        })
      } catch {}
      return ApiResponse.json(client);
    } catch (error) {
      return ApiResponse.error("Database error", 500, "Failed to create client");
    }
  }

  // GET /client/{id} - Get a client by ID
  async getClient(userId: number, id: string): Promise<Response> {
    try {
      const clientId = parseInt(id);
      
      const result = await this.drizzle
        .select({
          id: clients.id,
          userId: clients.userId,
          token: clients.token,
          name: clients.name,
          lastUsed: clients.lastUsed
        })
        .from(clients)
        .where(sql`${clients.id} = ${clientId} AND ${clients.userId} = ${userId}`)
        .get();

      if (!result) {
        return ApiResponse.error("Not Found", 404, "Client not found");
      }

      const client: Client = {
        id: result.id,
        token: result.token,
        name: result.name,
        lastUsed: formatDate(result.lastUsed) || null
      };

      return ApiResponse.json(client);
    } catch (error) {
      return ApiResponse.error("Database error", 500, "Failed to retrieve client");
    }
  }

  // PUT /client/{id} - Update a client
  async updateClient(userId: number, id: string, name: string): Promise<Response> {
    try {
      const clientId = parseInt(id);
      
      const result = await this.drizzle
        .update(clients)
        .set({ name })
        .where(sql`${clients.id} = ${clientId} AND ${clients.userId} = ${userId}`)
        .returning({
          id: clients.id,
          userId: clients.userId,
          token: clients.token,
          name: clients.name,
          lastUsed: clients.lastUsed
        });

      if (!result || result.length === 0) {
        return ApiResponse.error("Not Found", 404, "Client not found or update failed");
      }

      const row = result[0];
      const client: Client = {
        id: row.id,
        token: row.token,
        name: row.name,
        lastUsed: formatDate(row.lastUsed) || null
      };

      return ApiResponse.json(client);
    } catch (error) {
      return ApiResponse.error("Database error", 500, "Failed to update client");
    }
  }

  // DELETE /client/{id} - Delete a client
  async deleteClient(userId: number, id: string): Promise<Response> {
    try {
      const clientId = parseInt(id);
      
      const result = await this.drizzle
        .delete(clients)
        .where(sql`${clients.id} = ${clientId} AND ${clients.userId} = ${userId}`);

      if (result.meta.changes === 0) {
        return ApiResponse.error("Not Found", 404, "Client not found");
      }

      return ApiResponse.json({});
    } catch (error) {
      return ApiResponse.error("Database error", 500, "Failed to delete client");
    }
  }
}
