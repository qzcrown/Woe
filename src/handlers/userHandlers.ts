import { User, UserWithPass } from "../types/index.ts";
import { ApiResponse, toBoolean } from "../utils/response.ts";

// User Management API handlers for Woe - Gotify compatible
export class UserHandlers {
  constructor(private db: D1Database) {}

  // Helper to map DB result to User type
  private mapToUser(row: any): User {
    return {
      id: row.id,
      name: row.name,
      admin: toBoolean(row.admin)
    };
  }

  // GET /user - Return all users
  async getAllUsers(): Promise<Response> {
    try {
      const result = await this.db.prepare(`
        SELECT id, name, admin
        FROM users
        WHERE disabled = 0
        ORDER BY id
      `).all();

      const users = result.results.map(row => this.mapToUser(row));
      return ApiResponse.json(users);
    } catch (error) {
      return ApiResponse.error("Database error", 500, "Failed to retrieve users");
    }
  }

  // POST /user - Create a user
  async createUser(name: string, pass: string, admin: boolean = false): Promise<Response> {
    try {
      const { hashPassword } = await import("../middleware/auth.ts");
      const hashed = await hashPassword(pass);
      const result = await this.db.prepare(`
        INSERT INTO users (name, pass, admin)
        VALUES (?, ?, ?)
        RETURNING id, name, admin
      `).bind(name, hashed, admin ? 1 : 0).first();

      if (!result) {
        return ApiResponse.error("User creation failed", 400, "Could not create user");
      }

      return ApiResponse.json(this.mapToUser(result));
    } catch (error) {
      return ApiResponse.error("Database error", 500, "Failed to create user");
    }
  }

  // GET /user/{id} - Get a user by ID
  async getUser(id: string): Promise<Response> {
    try {
      const result = await this.db.prepare(`
        SELECT id, name, admin
        FROM users
        WHERE id = ? AND disabled = 0
      `).bind(parseInt(id)).first();

      if (!result) {
        return ApiResponse.error("Not Found", 404, "User not found");
      }

      return ApiResponse.json(this.mapToUser(result));
    } catch (error) {
      return ApiResponse.error("Database error", 500, "Failed to retrieve user");
    }
  }

  // PUT /user/{id} - Update a user
  async updateUser(id: string, data: {name?: string; pass?: string; admin?: boolean}): Promise<Response> {
    try {
      const updateFields = [];
      const values = [];

      if (data.name) {
        updateFields.push("name = ?");
        values.push(data.name);
      }
      if (data.pass) {
        const { hashPassword } = await import("../middleware/auth.ts");
        const hashed = await hashPassword(data.pass);
        updateFields.push("pass = ?");
        values.push(hashed);
      }
      if (data.admin !== undefined) {
        updateFields.push("admin = ?");
        values.push(data.admin ? 1 : 0);
      }

      if (updateFields.length === 0) {
        return ApiResponse.error("Bad Request", 400, "No fields to update");
      }

      values.push(parseInt(id));

      const result = await this.db.prepare(`
        UPDATE users
        SET ${updateFields.join(", ")}
        WHERE id = ?
        RETURNING id, name, admin
      `).bind(...values).first();

      if (!result) {
        return ApiResponse.error("Not Found", 404, "User not found or update failed");
      }

      return ApiResponse.json(this.mapToUser(result));
    } catch (error) {
      return ApiResponse.error("Database error", 500, "Failed to update user");
    }
  }

  // DELETE /user/{id} - Delete a user
  async deleteUser(id: string): Promise<Response> {
    try {
      const result = await this.db.prepare(`
        DELETE FROM users
        WHERE id = ?
      `).bind(parseInt(id)).run();

      if (result.meta.changes === 0) {
        return ApiResponse.error("Not Found", 404, "User not found");
      }

      return ApiResponse.json({});
    } catch (error) {
      return ApiResponse.error("Database error", 500, "Failed to delete user");
    }
  }

  // GET /current/user - Return the current user
  async getCurrentUser(userId: number): Promise<Response> {
    try {
      const result = await this.db.prepare(`
        SELECT id, name, admin
        FROM users
        WHERE id = ? AND disabled = 0
      `).bind(userId).first();

      if (!result) {
        return ApiResponse.error("Not Found", 404, "User not found");
      }

      return ApiResponse.json(this.mapToUser(result));
    } catch (error) {
      return ApiResponse.error("Database error", 500, "Failed to retrieve current user");
    }
  }

  // POST /current/user/password - Update the password of the current user
  async updateCurrentUserPassword(userId: number, newPassword: string): Promise<Response> {
    try {
      const { hashPassword } = await import("../middleware/auth.ts");
      const hashed = await hashPassword(newPassword);
      const result = await this.db.prepare(`
        UPDATE users
        SET pass = ?
        WHERE id = ?
        RETURNING id, name, admin
      `).bind(hashed, userId).first();

      if (!result) {
        return ApiResponse.error("Not Found", 404, "User not found");
      }

      // The spec says this endpoint returns "Ok" - return empty 200 response per Gotify spec
      return new Response(null, { status: 200 });
    } catch (error) {
      return ApiResponse.error("Database error", 500, "Failed to update password");
    }
  }

  // Optional: Add method to enable/disable users (admin only)
  async setUserDisabled(id: string, disabled: boolean): Promise<Response> {
    try {
      const result = await this.db.prepare(`
        UPDATE users
        SET disabled = ?
        WHERE id = ?
        RETURNING id, name, admin
      `).bind(disabled ? 1 : 0, parseInt(id)).first();

      if (!result) {
        return ApiResponse.error("Not Found", 404, "User not found");
      }

      return ApiResponse.json(this.mapToUser(result));
    } catch (error) {
      return ApiResponse.error("Database error", 500, "Failed to update user disabled status");
    }
  }
}
