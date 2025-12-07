import { User, UserWithPass } from "../types/index.ts";
import { ApiResponse, toBoolean } from "../utils/response.ts";
import { DrizzleDB } from "../drizzle/index.ts";
import { users } from "../models/index.ts";
import { eq, sql } from "drizzle-orm";

// User Management API handlers for Woe - Gotify compatible
export class UserHandlers {
  constructor(private drizzle: DrizzleDB) {}

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
      const usersList = await this.drizzle
        .select({
          id: users.id,
          name: users.name,
          admin: users.admin
        })
        .from(users)
        .where(eq(users.disabled, false))
        .orderBy(users.id);

      const usersArray = usersList.map((row: any) => ({
        id: row.id,
        name: row.name,
        admin: toBoolean(row.admin)
      }));

      return ApiResponse.json(usersArray);
    } catch (error) {
      return ApiResponse.error("Database error", 500, "Failed to retrieve users");
    }
  }

  // POST /user - Create a user
  async createUser(name: string, pass: string, admin: boolean = false): Promise<Response> {
    try {
      const { hashPassword } = await import("../middleware/auth.ts");
      const hashed = await hashPassword(pass);
      
      const result = await this.drizzle
        .insert(users)
        .values({
          name,
          pass: hashed,
          admin
        })
        .returning({
          id: users.id,
          name: users.name,
          admin: users.admin
        });

      if (!result || result.length === 0) {
        return ApiResponse.error("User creation failed", 400, "Could not create user");
      }

      const newUser = {
        id: result[0].id,
        name: result[0].name,
        admin: toBoolean(result[0].admin)
      };

      return ApiResponse.json(newUser);
    } catch (error) {
      return ApiResponse.error("Database error", 500, "Failed to create user");
    }
  }

  // GET /user/{id} - Get a user by ID
  async getUser(id: string): Promise<Response> {
    try {
      const userId = parseInt(id);
      
      const result = await this.drizzle
        .select({
          id: users.id,
          name: users.name,
          admin: users.admin
        })
        .from(users)
        .where(sql`${users.id} = ${userId} AND ${users.disabled} = 0`)
        .get();

      if (!result) {
        return ApiResponse.error("Not Found", 404, "User not found");
      }

      const user = {
        id: result.id,
        name: result.name,
        admin: toBoolean(result.admin)
      };

      return ApiResponse.json(user);
    } catch (error) {
      return ApiResponse.error("Database error", 500, "Failed to retrieve user");
    }
  }

  // PUT /user/{id} - Update a user
  async updateUser(id: string, data: {name?: string; pass?: string; admin?: boolean}): Promise<Response> {
    try {
      const userId = parseInt(id);
      const updateData: any = {};

      if (data.name) {
        updateData.name = data.name;
      }
      if (data.pass) {
        const { hashPassword } = await import("../middleware/auth.ts");
        const hashed = await hashPassword(data.pass);
        updateData.pass = hashed;
      }
      if (data.admin !== undefined) {
        updateData.admin = data.admin;
      }

      if (Object.keys(updateData).length === 0) {
        return ApiResponse.error("Bad Request", 400, "No fields to update");
      }

      const result = await this.drizzle
        .update(users)
        .set(updateData)
        .where(eq(users.id, userId))
        .returning({
          id: users.id,
          name: users.name,
          admin: users.admin
        });

      if (!result || result.length === 0) {
        return ApiResponse.error("Not Found", 404, "User not found or update failed");
      }

      const updatedUser = {
        id: result[0].id,
        name: result[0].name,
        admin: toBoolean(result[0].admin)
      };

      return ApiResponse.json(updatedUser);
    } catch (error) {
      return ApiResponse.error("Database error", 500, "Failed to update user");
    }
  }

  // DELETE /user/{id} - Delete a user
  async deleteUser(id: string): Promise<Response> {
    try {
      const userId = parseInt(id);
      
      const result = await this.drizzle
        .delete(users)
        .where(eq(users.id, userId));

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
      const result = await this.drizzle
        .select({
          id: users.id,
          name: users.name,
          admin: users.admin
        })
        .from(users)
        .where(sql`${users.id} = ${userId} AND ${users.disabled} = 0`)
        .get();

      if (!result) {
        return ApiResponse.error("Not Found", 404, "User not found");
      }

      const user = {
        id: result.id,
        name: result.name,
        admin: toBoolean(result.admin)
      };

      return ApiResponse.json(user);
    } catch (error) {
      return ApiResponse.error("Database error", 500, "Failed to retrieve current user");
    }
  }

  // POST /current/user/password - Update the password of the current user
  async updateCurrentUserPassword(userId: number, newPassword: string): Promise<Response> {
    try {
      const { hashPassword } = await import("../middleware/auth.ts");
      const hashed = await hashPassword(newPassword);
      
      const result = await this.drizzle
        .update(users)
        .set({ pass: hashed })
        .where(eq(users.id, userId))
        .returning({
          id: users.id,
          name: users.name,
          admin: users.admin
        });

      if (!result || result.length === 0) {
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
      const userId = parseInt(id);
      
      const result = await this.drizzle
        .update(users)
        .set({ disabled })
        .where(eq(users.id, userId))
        .returning({
          id: users.id,
          name: users.name,
          admin: users.admin
        });

      if (!result || result.length === 0) {
        return ApiResponse.error("Not Found", 404, "User not found");
      }

      const updatedUser = {
        id: result[0].id,
        name: result[0].name,
        admin: toBoolean(result[0].admin)
      };

      return ApiResponse.json(updatedUser);
    } catch (error) {
      return ApiResponse.error("Database error", 500, "Failed to update user disabled status");
    }
  }
}
