import { User, UserWithPass, Application, Client, PluginConf } from "../types/index.ts";
import { ApiResponse, toBoolean, formatDate } from "../utils/response.ts";
import { validateImageFile } from "../utils/fileValidation.ts";
import { DrizzleDB } from "../drizzle/index.ts";
import { users, applications, clients, pluginConfigs, userPluginPermissions, messages } from "../models/index.ts";
import { eq, sql, count, and, inArray } from "drizzle-orm";

// User Management API handlers for Woe - Gotify compatible
export class UserHandlers {
  constructor(private drizzle: DrizzleDB) {}

  // Helper to map DB result to User type
  private mapToUser(row: any): User {
    return {
      id: row.id,
      name: row.name,
      nickname: row.nickname || row.name,
      email: row.email,
      avatar: row.avatar,
      description: row.description,
      admin: toBoolean(row.admin),
      disabled: toBoolean(row.disabled)
    };
  }

  private async countActiveAdmins(): Promise<number> {
    try {
      const result = await this.drizzle
        .select({ count: count() })
        .from(users)
        .where(sql`${users.admin} = 1 AND ${users.disabled} = 0`)
        .get();
      return result?.count || 0;
    } catch (error) {
      console.error("Failed to count active admins:", error);
      return 0;
    }
  }

  private async isUserAdmin(userId: number): Promise<boolean> {
    try {
      const result = await this.drizzle
        .select({ admin: users.admin })
        .from(users)
        .where(eq(users.id, userId))
        .get();
      return result ? toBoolean(result.admin) : false;
    } catch (error) {
      return false;
    }
  }

  // GET /user - Return all users
  async getAllUsers(): Promise<Response> {
    try {
      const usersList = await this.drizzle
        .select({
          id: users.id,
          name: users.name,
          nickname: users.nickname,
          email: users.email,
          avatar: users.avatar,
          description: users.description,
          admin: users.admin,
          disabled: users.disabled
        })
        .from(users)
        .where(eq(users.disabled, false))
        .orderBy(users.id);

      const usersArray = usersList.map((row: any) => this.mapToUser(row));

      return ApiResponse.json(usersArray);
    } catch (error) {
      return ApiResponse.error("Database error", 500, "Failed to retrieve users");
    }
  }

  // POST /user - Create a user
  async createUser(
    name: string, 
    pass: string, 
    admin: boolean = false,
    nickname: string,
    email: string,
    description?: string
  ): Promise<Response> {
    try {
      const { hashPassword } = await import("../middleware/auth.ts");
      const hashed = await hashPassword(pass);

      // 验证 email 格式
      const finalEmail = email?.trim() || 'needupdate@crownkin.space';
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (email && !emailRegex.test(finalEmail)) {
        return ApiResponse.error("Bad Request", 400, "Invalid email format");
      }

      const result = await this.drizzle
        .insert(users)
        .values({
          name,
          nickname: nickname?.trim() || name,
          email: finalEmail,
          description: description || null,
          pass: hashed,
          admin
        })
        .returning({
          id: users.id,
          name: users.name,
          nickname: users.nickname,
          email: users.email,
          avatar: users.avatar,
          description: users.description,
          admin: users.admin,
          disabled: users.disabled
        });

      if (!result || result.length === 0) {
        return ApiResponse.error("User creation failed", 400, "Could not create user");
      }

      return ApiResponse.json(this.mapToUser(result[0]));
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
          nickname: users.nickname,
          email: users.email,
          avatar: users.avatar,
          description: users.description,
          admin: users.admin,
          disabled: users.disabled
        })
        .from(users)
        .where(sql`${users.id} = ${userId} AND ${users.disabled} = 0`)
        .get();

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
      const userId = parseInt(id);

      if (data.admin === false) {
        const adminCount = await this.countActiveAdmins();
        const isCurrentUserAdmin = await this.isUserAdmin(userId);

        if (isCurrentUserAdmin && adminCount <= 1) {
          return ApiResponse.error(
            "Forbidden",
            403,
            "Cannot remove admin privileges from the last administrator. Create another admin user first."
          );
        }
      }

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
          nickname: users.nickname,
          email: users.email,
          avatar: users.avatar,
          description: users.description,
          admin: users.admin,
          disabled: users.disabled
        });

      if (!result || result.length === 0) {
        return ApiResponse.error("Not Found", 404, "User not found or update failed");
      }

      return ApiResponse.json(this.mapToUser(result[0]));
    } catch (error) {
      return ApiResponse.error("Database error", 500, "Failed to update user");
    }
  }

  // DELETE /user/{id} - Delete a user
  async deleteUser(id: string): Promise<Response> {
    try {
      const userId = parseInt(id);
      
      if (isNaN(userId)) {
        return ApiResponse.error("Bad Request", 400, "Invalid user ID");
      }
      
      const adminCount = await this.countActiveAdmins();
      const isTargetAdmin = await this.isUserAdmin(userId);
      
      if (isTargetAdmin && adminCount <= 1) {
        return ApiResponse.error(
          "Forbidden", 
          403, 
          "Cannot delete the last administrator. Create another admin user first."
        );
      }
      
      // 删除关联数据（按依赖顺序）
      await this.drizzle.delete(messages).where(eq(messages.userid, userId));
      await this.drizzle.delete(userPluginPermissions).where(eq(userPluginPermissions.userId, userId));
      await this.drizzle.delete(pluginConfigs).where(eq(pluginConfigs.userId, userId));
      await this.drizzle.delete(clients).where(eq(clients.userId, userId));
      await this.drizzle.delete(applications).where(eq(applications.userId, userId));
      
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
          nickname: users.nickname,
          email: users.email,
          avatar: users.avatar,
          description: users.description,
          admin: users.admin,
          disabled: users.disabled
        })
        .from(users)
        .where(sql`${users.id} = ${userId} AND ${users.disabled} = 0`)
        .get();

      if (!result) {
        return ApiResponse.error("Not Found", 404, "User not found");
      }

      return ApiResponse.json(this.mapToUser(result));
    } catch (error) {
      return ApiResponse.error("Database error", 500, "Failed to retrieve current user");
    }
  }

  // POST /current/user/password - Update the password of the current user with old password verification
  async updateCurrentUserPassword(userId: number, oldPassword: string, newPassword: string): Promise<Response> {
    try {
      // 首先获取用户当前密码
      const userResult = await this.drizzle
        .select({ pass: users.pass })
        .from(users)
        .where(eq(users.id, userId))
        .get();

      if (!userResult) {
        return ApiResponse.error("Not Found", 404, "User not found");
      }

      // 验证旧密码
      const { verifyPassword } = await import("../middleware/auth.ts");
      const isOldPasswordValid = await verifyPassword(userResult.pass, oldPassword);

      if (!isOldPasswordValid) {
        return ApiResponse.error("Unauthorized", 401, "Current password is incorrect");
      }

      // 哈希新密码
      const { hashPassword } = await import("../middleware/auth.ts");
      const hashed = await hashPassword(newPassword);

      // 更新密码
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
      
      if (isNaN(userId)) {
        return ApiResponse.error("Bad Request", 400, "Invalid user ID");
      }

      // 保护最后一个管理员
      if (disabled) {
        const adminCount = await this.countActiveAdmins();
        const isTargetAdmin = await this.isUserAdmin(userId);
        
        if (isTargetAdmin && adminCount <= 1) {
          return ApiResponse.error(
            "Forbidden",
            403,
            "Cannot disable the last administrator. Create another admin user first."
          );
        }
      }
      
      const result = await this.drizzle
        .update(users)
        .set({ disabled })
        .where(eq(users.id, userId))
        .returning({
          id: users.id,
          name: users.name,
          nickname: users.nickname,
          email: users.email,
          avatar: users.avatar,
          description: users.description,
          admin: users.admin,
          disabled: users.disabled
        });

      if (!result || result.length === 0) {
        return ApiResponse.error("Not Found", 404, "User not found");
      }

      return ApiResponse.json(this.mapToUser(result[0]));
    } catch (error) {
      return ApiResponse.error("Database error", 500, "Failed to update user disabled status");
    }
  }

  // GET /user/{id}/applications - Get applications for a specific user (admin only)
  async getUserApplications(userId: number): Promise<Response> {
    try {
      const apps = await this.drizzle
        .select({
          id: applications.id,
          token: applications.token,
          name: applications.name,
          description: applications.description,
          defaultPriority: applications.defaultPriority,
          image: applications.image,
          internal: applications.internal,
          lastUsed: applications.lastUsed
        })
        .from(applications)
        .where(eq(applications.userId, userId))
        .orderBy(applications.id);

      const mappedApps = apps.map(row => ({
        id: row.id,
        token: row.token,
        name: row.name,
        description: row.description || "",
        internal: Boolean(row.internal),
        image: row.image || "",
        lastUsed: formatDate(row.lastUsed) || null,
        defaultPriority: row.defaultPriority || 0
      }));

      return ApiResponse.json(mappedApps);
    } catch (error) {
      return ApiResponse.error("Database error", 500, "Failed to retrieve user applications");
    }
  }

  // GET /user/{id}/clients - Get clients for a specific user (admin only)
  async getUserClients(userId: number): Promise<Response> {
    try {
      const clientsList = await this.drizzle
        .select({
          id: clients.id,
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
      return ApiResponse.error("Database error", 500, "Failed to retrieve user clients");
    }
  }

  // GET /user/{id}/plugins - Get plugins for a specific user (admin only)
  async getUserPlugins(userId: number): Promise<Response> {
    try {
      const pluginsList = await this.drizzle
        .select({
          id: pluginConfigs.id,
          name: pluginConfigs.name,
          token: pluginConfigs.token,
          modulePath: pluginConfigs.modulePath,
          enabled: pluginConfigs.enabled,
          icon: pluginConfigs.icon
        })
        .from(pluginConfigs)
        .where(eq(pluginConfigs.userId, userId))
        .orderBy(pluginConfigs.id);

      const mappedPlugins = pluginsList.map(row => ({
        id: row.id,
        name: row.name,
        token: row.token,
        modulePath: row.modulePath,
        enabled: Boolean(row.enabled),
        icon: row.icon,
        capabilities: []
      }));

      return ApiResponse.json(mappedPlugins);
    } catch (error) {
      return ApiResponse.error("Database error", 500, "Failed to retrieve user plugins");
    }
  }

  // PUT /user/{id}/profile - Update user profile (nickname, email, description)
  async updateUserProfile(
    currentUserId: number,
    targetUserId: number,
    isAdmin: boolean,
    data: { nickname?: string; email?: string; description?: string }
  ): Promise<Response> {
    try {
      // Non-admin can only update their own profile
      if (!isAdmin && currentUserId !== targetUserId) {
        return ApiResponse.error("Forbidden", 403, "You can only update your own profile");
      }

      const updateData: any = {};

      if (data.nickname !== undefined) {
        const trimmed = data.nickname.trim();
        if (!trimmed) {
          return ApiResponse.error("Bad Request", 400, "Nickname cannot be empty");
        }
        updateData.nickname = trimmed;
      }

      if (data.email !== undefined) {
        const trimmed = data.email.trim();
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(trimmed)) {
          return ApiResponse.error("Bad Request", 400, "Invalid email format");
        }
        updateData.email = trimmed;
      }

      if (data.description !== undefined) {
        updateData.description = data.description;
      }

      if (Object.keys(updateData).length === 0) {
        return ApiResponse.error("Bad Request", 400, "No fields to update");
      }

      const result = await this.drizzle
        .update(users)
        .set(updateData)
        .where(eq(users.id, targetUserId))
        .returning({
          id: users.id,
          name: users.name,
          nickname: users.nickname,
          email: users.email,
          avatar: users.avatar,
          description: users.description,
          admin: users.admin,
          disabled: users.disabled
        });

      if (!result || result.length === 0) {
        return ApiResponse.error("Not Found", 404, "User not found");
      }

      return ApiResponse.json(this.mapToUser(result[0]));
    } catch (error) {
      return ApiResponse.error("Database error", 500, "Failed to update profile");
    }
  }

  // POST /user/{id}/avatar - Upload user avatar
  async uploadUserAvatar(
    currentUserId: number,
    targetUserId: number,
    isAdmin: boolean,
    request: Request,
    env: any
  ): Promise<Response> {
    try {
      // Non-admin can only upload their own avatar
      if (!isAdmin && currentUserId !== targetUserId) {
        return ApiResponse.error("Forbidden", 403, "You can only update your own avatar");
      }

      // Check if user exists
      const userResult = await this.drizzle
        .select({ id: users.id })
        .from(users)
        .where(eq(users.id, targetUserId))
        .get();

      if (!userResult) {
        return ApiResponse.error("Not Found", 404, "User not found");
      }

      // Check if R2 bucket is available
      if (!env.R2) {
        return ApiResponse.error("Service Unavailable", 503, "R2 storage not configured");
      }

      // Parse file from request
      const contentType = request.headers.get("content-type") || "";
      let fileBody: ReadableStream | ArrayBuffer;
      let fileContentType: string;

      if (contentType.includes("multipart/form-data")) {
        const formData = await request.formData();
        const file = formData.get("file");

        if (!file || typeof file === "string") {
          return ApiResponse.error("Bad Request", 400, "No file provided");
        }

        const fileBlob = file as Blob;

        // Validate file type and size using file-type (checks magic numbers)
        const validation = await validateImageFile(fileBlob);
        if (!validation.valid) {
          return ApiResponse.error("Bad Request", 400, validation.error || "Invalid image file");
        }

        fileBody = await fileBlob.arrayBuffer();
        fileContentType = fileBlob.type;
      } else if (contentType.startsWith("image/")) {
        fileBody = request.body!;
        fileContentType = contentType;
      } else {
        return ApiResponse.error("Bad Request", 400, "Invalid content type");
      }

      // Generate unique filename
      const timestamp = Date.now();
      const filename = `user-avatars/${targetUserId}-${timestamp}`;

      // Upload to R2
      const object = await env.R2.put(filename, fileBody, {
        httpMetadata: { contentType: fileContentType },
      });

      if (!object) {
        return ApiResponse.error("Internal Server Error", 500, "Upload failed");
      }

      // Update user with new avatar URL
      const imageUrl = `/api/v1/image/${filename}`;
      const result = await this.drizzle
        .update(users)
        .set({ avatar: imageUrl })
        .where(eq(users.id, targetUserId))
        .returning({
          id: users.id,
          name: users.name,
          nickname: users.nickname,
          email: users.email,
          avatar: users.avatar,
          description: users.description,
          admin: users.admin,
          disabled: users.disabled
        });

      if (!result || result.length === 0) {
        return ApiResponse.error("Internal Server Error", 500, "Failed to update user");
      }

      return ApiResponse.json(this.mapToUser(result[0]));
    } catch (error) {
      return ApiResponse.error("Upload failed", 500, error instanceof Error ? error.message : "Unknown error");
    }
  }

  // DELETE /user/{id}/avatar - Delete user avatar
  async deleteUserAvatar(
    currentUserId: number,
    targetUserId: number,
    isAdmin: boolean,
    env: any
  ): Promise<Response> {
    try {
      // Non-admin can only delete their own avatar
      if (!isAdmin && currentUserId !== targetUserId) {
        return ApiResponse.error("Forbidden", 403, "You can only delete your own avatar");
      }

      // Get current avatar
      const userResult = await this.drizzle
        .select({ avatar: users.avatar })
        .from(users)
        .where(eq(users.id, targetUserId))
        .get();

      if (!userResult) {
        return ApiResponse.error("Not Found", 404, "User not found");
      }

      const currentAvatar = userResult.avatar;
      if (!currentAvatar) {
        return ApiResponse.error("Not Found", 404, "No avatar to delete");
      }

      // Delete from R2
      const filename = currentAvatar.replace("/api/v1/image/", "");
      if (env.R2 && filename) {
        await env.R2.delete(filename);
      }

      // Update user to remove avatar
      await this.drizzle
        .update(users)
        .set({ avatar: null })
        .where(eq(users.id, targetUserId));

      return ApiResponse.json({});
    } catch (error) {
      return ApiResponse.error("Delete failed", 500, error instanceof Error ? error.message : "Unknown error");
    }
  }

  // GET /user/{id}/plugin-permissions - Get plugin permissions for a user (admin only)
  async getUserPluginPermissions(userId: number): Promise<Response> {
    try {
      const permissions = await this.drizzle
        .select({
          modulePath: userPluginPermissions.modulePath
        })
        .from(userPluginPermissions)
        .where(eq(userPluginPermissions.userId, userId));

      const modulePaths = permissions.map(p => p.modulePath);
      return ApiResponse.json(modulePaths);
    } catch (error) {
      return ApiResponse.error("Database error", 500, "Failed to retrieve plugin permissions");
    }
  }

  // PUT /user/{id}/plugin-permissions - Update plugin permissions for a user (admin only)
  async updateUserPluginPermissions(userId: number, modulePaths: string[]): Promise<Response> {
    try {
      // Check if user exists
      const userResult = await this.drizzle
        .select({ id: users.id })
        .from(users)
        .where(eq(users.id, userId))
        .get();

      if (!userResult) {
        return ApiResponse.error("Not Found", 404, "User not found");
      }

      // Delete existing permissions for this user
      await this.drizzle
        .delete(userPluginPermissions)
        .where(eq(userPluginPermissions.userId, userId));

      // Insert new permissions
      if (modulePaths.length > 0) {
        const permissionsToInsert = modulePaths.map(modulePath => ({
          userId,
          modulePath
        }));

        await this.drizzle
          .insert(userPluginPermissions)
          .values(permissionsToInsert);
      }

      // Invalidate plugin cache for this user
      try {
        const { PluginManager } = await import('../plugins/manager.ts');
        const pm = new PluginManager(this.drizzle);
        pm.invalidate(userId);
      } catch {}

      return ApiResponse.json(modulePaths);
    } catch (error) {
      return ApiResponse.error("Database error", 500, "Failed to update plugin permissions");
    }
  }
}
