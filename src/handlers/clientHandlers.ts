import { generateToken } from "../middleware/auth.ts";
import { Client } from "../types/index.ts";
import { ApiResponse, formatDate } from "../utils/response.ts";

export class ClientHandlers {
  constructor(private db: D1Database) {}

  // Helper to map DB result to Client type
  private mapToClient(row: any): Client {
    return {
      id: row.id,
      token: row.token,
      name: row.name,
      lastUsed: formatDate(row.lastUsed) || null
    };
  }

  // GET /client - Return all clients for the current user
  async getAllClients(userId: number): Promise<Response> {
    try {
      const result = await this.db.prepare(`
        SELECT id, user_id as userId, token, name, last_used as lastUsed
        FROM clients
        WHERE user_id = ?
        ORDER BY id
      `).bind(userId).all();

      const clients = result.results.map(row => this.mapToClient(row));
      return ApiResponse.json(clients);
    } catch (error) {
      return ApiResponse.error("Database error", 500, "Failed to retrieve clients");
    }
  }

  // POST /client - Create a client
  async createClient(userId: number, name: string): Promise<Response> {
    try {
      const token = generateToken("client");

      const result = await this.db.prepare(`
        INSERT INTO clients (user_id, token, name)
        VALUES (?, ?, ?)
        RETURNING id, user_id as userId, token, name, last_used as lastUsed
      `).bind(userId, token, name).first();

      if (!result) {
        return ApiResponse.error("Client creation failed", 400, "Could not create client");
      }

      const client = this.mapToClient(result)
      try {
        const { PluginManager } = await import('../plugins/manager.ts')
        const pm = new PluginManager(this.db)
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
      const result = await this.db.prepare(`
        SELECT id, user_id as userId, token, name, last_used as lastUsed
        FROM clients
        WHERE id = ? AND user_id = ?
      `).bind(parseInt(id), userId).first();

      if (!result) {
        return ApiResponse.error("Not Found", 404, "Client not found");
      }

      return ApiResponse.json(this.mapToClient(result));
    } catch (error) {
      return ApiResponse.error("Database error", 500, "Failed to retrieve client");
    }
  }

  // PUT /client/{id} - Update a client
  async updateClient(userId: number, id: string, name: string): Promise<Response> {
    try {
      const result = await this.db.prepare(`
        UPDATE clients
        SET name = ?
        WHERE id = ? AND user_id = ?
        RETURNING id, user_id as userId, token, name, last_used as lastUsed
      `).bind(name, parseInt(id), userId).first();

      if (!result) {
        return ApiResponse.error("Not Found", 404, "Client not found or update failed");
      }

      return ApiResponse.json(this.mapToClient(result));
    } catch (error) {
      return ApiResponse.error("Database error", 500, "Failed to update client");
    }
  }

  // DELETE /client/{id} - Delete a client
  async deleteClient(userId: number, id: string): Promise<Response> {
    try {
      const result = await this.db.prepare(`
        DELETE FROM clients
        WHERE id = ? AND user_id = ?
      `).bind(parseInt(id), userId).run();

      if (result.meta.changes === 0) {
        return ApiResponse.error("Not Found", 404, "Client not found");
      }

      return ApiResponse.json({});
    } catch (error) {
      return ApiResponse.error("Database error", 500, "Failed to delete client");
    }
  }
}
