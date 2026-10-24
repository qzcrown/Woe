





import { User, UserWithPass, Application, Client, PluginConf } from "../types/index.ts";
import { ApiResponse, toBoolean, formatDate } from "../utils/response.ts";
import { IMAGE_MAX_FILE_SIZE, validateImageFile, validateRawImageRequest } from "../utils/fileValidation.ts";
import { DrizzleDB } from "../drizzle/index.ts";
import { users, applications, clients, pluginConfigs, userPluginPermissions, messages } from "../models/index.ts";
import { eq, sql, count, and, inArray } from "drizzle-orm";
import { ImageCompressionError, ImageCompressionService } from "../services/imageCompressionService.ts";
import { MessageStreamHub } from "../services/messageStreamHub.ts";
import { isUsernameUniqueViolation } from "../utils/userConflict.ts";
import { normalizeMediaPath, DEFAULT_APP_IMAGE } from "../utils/mediaPath.ts";



export class UserHandlers {
  constructor(private drizzle: DrizzleDB, private streamHub?: MessageStreamHub) {}





  private mapToUser(row: any): User {
    return {
      id: row.id,
      name: row.name,
      nickname: row.nickname || row.name,
      email: row.email,
      avatar: row.avatar ? normalizeMediaPath(row.avatar) : row.avatar,
      description: row.description,
      admin: toBoolean(row.admin),
      disabled: toBoolean(row.disabled),
      createdAt: formatDate(row.createdAt) ?? null
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
          disabled: users.disabled,
          createdAt: users.createdAt
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



  async createUser(
    name: string,
    pass: string,
    admin: boolean = false,
    nickname?: string,
    email?: string,
    description?: string
  ): Promise<Response> {
    try {
      const { hashPassword } = await import("../middleware/auth.ts");
      const hashed = await hashPassword(pass);


      const finalEmail = email?.trim() || 'needupdate@example.com';
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (email && !emailRegex.test(finalEmail)) {
        return ApiResponse.error("Bad Request", 400, "Invalid email format");
      }



      const existing = await this.drizzle
        .select({ id: users.id })
        .from(users)
        .where(eq(users.name, name))
        .get();

      if (existing) {
        return ApiResponse.error("Bad Request", 400, "username already exists");
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
          disabled: users.disabled,
          createdAt: users.createdAt
        });

      if (!result || result.length === 0) {
        return ApiResponse.error("User creation failed", 400, "Could not create user");
      }

      return ApiResponse.json(this.mapToUser(result[0]));
    } catch (error) {


      if (isUsernameUniqueViolation(error)) {
        return ApiResponse.error("Bad Request", 400, "username already exists");
      }
      return ApiResponse.error("Database error", 500, "Failed to create user");
    }
  }



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
          disabled: users.disabled,
          createdAt: users.createdAt
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
          disabled: users.disabled,
          createdAt: users.createdAt
        });

      if (!result || result.length === 0) {
        return ApiResponse.error("Not Found", 404, "User not found or update failed");
      }

      return ApiResponse.json(this.mapToUser(result[0]));
    } catch (error) {
      return ApiResponse.error("Database error", 500, "Failed to update user");
    }
  }



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

      let clientIds: number[] = [];
      if (this.streamHub) {
        try {
          const clientRows = await this.drizzle
            .select({ id: clients.id })
            .from(clients)
            .where(eq(clients.userId, userId))
            .all();
          clientIds = clientRows.map((row) => row.id);
        } catch (error) {
          console.error("Failed to list user clients before deletion:", error);
        }
      }


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

      if (this.streamHub) {
        for (const clientId of clientIds) {
          try {
            await this.streamHub.disconnectClient(userId, clientId);
          } catch (error) {
            console.error(`Failed to disconnect deleted user client ${clientId}:`, error);
          }
        }
      }

      return ApiResponse.json({});
    } catch (error) {
      return ApiResponse.error("Database error", 500, "Failed to delete user");
    }
  }





  async getCurrentUser(
    userId: number,
    clientAuth?: { clientId?: number; elevatedUntil?: string | null }
  ): Promise<Response> {
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
          disabled: users.disabled,
          createdAt: users.createdAt
        })
        .from(users)
        .where(sql`${users.id} = ${userId} AND ${users.disabled} = 0`)
        .get();

      if (!result) {
        return ApiResponse.error("Not Found", 404, "User not found");
      }

      const user = this.mapToUser(result);
      if (clientAuth?.clientId !== undefined) {
        user.clientId = clientAuth.clientId;


        if (clientAuth.elevatedUntil) {
          const until = new Date(clientAuth.elevatedUntil).getTime();
          if (until > Date.now()) {
            user.elevatedUntil = formatDate(clientAuth.elevatedUntil) ?? clientAuth.elevatedUntil;
          }
        }
      }

      return ApiResponse.json(user);
    } catch (error) {
      return ApiResponse.error("Database error", 500, "Failed to retrieve current user");
    }
  }



  async updateCurrentUserPassword(userId: number, pass: string): Promise<Response> {
    try {
      const userResult = await this.drizzle
        .select({ pass: users.pass })
        .from(users)
        .where(eq(users.id, userId))
        .get();

      if (!userResult) {
        return ApiResponse.error("Not Found", 404, "User not found");
      }

      const { hashPassword } = await import("../middleware/auth.ts");
      const hashed = await hashPassword(pass);

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

      return new Response(null, { status: 200 });
    } catch (error) {
      return ApiResponse.error("Database error", 500, "Failed to update password");
    }
  }



  async setUserDisabled(id: string, disabled: boolean): Promise<Response> {
    try {
      const userId = parseInt(id);

      if (isNaN(userId)) {
        return ApiResponse.error("Bad Request", 400, "Invalid user ID");
      }


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
          disabled: users.disabled,
          createdAt: users.createdAt
        });

      if (!result || result.length === 0) {
        return ApiResponse.error("Not Found", 404, "User not found");
      }

      return ApiResponse.json(this.mapToUser(result[0]));
    } catch (error) {
      return ApiResponse.error("Database error", 500, "Failed to update user disabled status");
    }
  }



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
          lastUsed: applications.lastUsed,
          createdAt: applications.createdAt
        })
        .from(applications)
        .where(eq(applications.userId, userId))
        .orderBy(applications.id);

      const mappedApps = apps.map(row => ({
        id: row.id,


        name: row.name,
        description: row.description || "",
        internal: Boolean(row.internal),

        image: normalizeMediaPath(row.image, DEFAULT_APP_IMAGE),
        lastUsed: formatDate(row.lastUsed) || null,
        defaultPriority: row.defaultPriority || 0,
        createdAt: formatDate(row.createdAt) ?? null
      }));

      return ApiResponse.json(mappedApps);
    } catch (error) {
      return ApiResponse.error("Database error", 500, "Failed to retrieve user applications");
    }
  }



  async getUserClients(userId: number): Promise<Response> {
    try {
      const clientsList = await this.drizzle
        .select({
          id: clients.id,
          token: clients.token,
          name: clients.name,
          lastUsed: clients.lastUsed,
          createdAt: clients.createdAt
        })
        .from(clients)
        .where(eq(clients.userId, userId))
        .orderBy(clients.id);

      const mappedClients = clientsList.map(row => ({
        id: row.id,

        token: "",
        name: row.name,
        lastUsed: formatDate(row.lastUsed) || null,
        createdAt: formatDate(row.createdAt) ?? null
      }));

      return ApiResponse.json(mappedClients);
    } catch (error) {
      return ApiResponse.error("Database error", 500, "Failed to retrieve user clients");
    }
  }



  async getUserPlugins(userId: number): Promise<Response> {
    try {
      const pluginsList = await this.drizzle
        .select({
          id: pluginConfigs.id,
          name: pluginConfigs.name,
          token: pluginConfigs.token,
          modulePath: pluginConfigs.modulePath,
          enabled: pluginConfigs.enabled,
          icon: pluginConfigs.icon,
          createdAt: pluginConfigs.createdAt
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

        icon: row.icon ? normalizeMediaPath(row.icon) : row.icon,
        capabilities: [],
        createdAt: formatDate(row.createdAt) ?? null
      }));

      return ApiResponse.json(mappedPlugins);
    } catch (error) {
      return ApiResponse.error("Database error", 500, "Failed to retrieve user plugins");
    }
  }



  async updateUserProfile(
    currentUserId: number,
    targetUserId: number,
    isAdmin: boolean,
    data: { nickname?: string; email?: string; description?: string }
  ): Promise<Response> {
    try {

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
          disabled: users.disabled,
          createdAt: users.createdAt
        });

      if (!result || result.length === 0) {
        return ApiResponse.error("Not Found", 404, "User not found");
      }

      return ApiResponse.json(this.mapToUser(result[0]));
    } catch (error) {
      return ApiResponse.error("Database error", 500, "Failed to update profile");
    }
  }



  async uploadUserAvatar(
    currentUserId: number,
    targetUserId: number,
    isAdmin: boolean,
    request: Request,
    env: any
  ): Promise<Response> {
    try {

      if (!isAdmin && currentUserId !== targetUserId) {
        return ApiResponse.error("Forbidden", 403, "You can only update your own avatar");
      }


      const userResult = await this.drizzle
        .select({ id: users.id })
        .from(users)
        .where(eq(users.id, targetUserId))
        .get();

      if (!userResult) {
        return ApiResponse.error("Not Found", 404, "User not found");
      }


      if (!env.R2) {
        return ApiResponse.error("Service Unavailable", 503, "R2 storage not configured");
      }


      const contentType = request.headers.get("content-type") || "";
      let sourceBuffer: ArrayBuffer;

      let fileBody: ArrayBuffer;
      let fileContentType: string;

      if (contentType.includes("multipart/form-data")) {
        const formData = await request.formData();
        const file = formData.get("file");

        if (!file || typeof file === "string") {
          return ApiResponse.error("Bad Request", 400, "No file provided");
        }

        const fileBlob = file as Blob;


        const validation = await validateImageFile(fileBlob);
        if (!validation.valid) {
          return ApiResponse.error("Bad Request", 400, validation.error || "Invalid image file");
        }

        sourceBuffer = await fileBlob.arrayBuffer();
        fileContentType = fileBlob.type;
      } else if (contentType.toLowerCase().startsWith("image/")) {
        const validation = await validateRawImageRequest(request, IMAGE_MAX_FILE_SIZE);
        if (!validation.valid || !validation.buffer || !validation.mime) {
          return ApiResponse.error("Bad Request", 400, validation.error || "Invalid image file");
        }
        sourceBuffer = validation.buffer;
        fileContentType = validation.mime;
      } else {
        return ApiResponse.error("Bad Request", 400, "Invalid content type");
      }

      const compressor = new ImageCompressionService(this.drizzle, env);
      try {
        const compressed = await compressor.processImage(sourceBuffer, fileContentType);
        fileBody = compressed.body;
        fileContentType = compressed.contentType;
      } catch (error) {
        if (error instanceof ImageCompressionError) {
          if (error.status === 503) {
            return ApiResponse.error("Service Unavailable", 503, error.publicMessage);
          }
          return ApiResponse.error("Internal Server Error", 500, error.publicMessage);
        }
        throw error;
      }


      const timestamp = Date.now();
      const filename = `user-avatars/${targetUserId}-${timestamp}`;


      const object = await env.R2.put(filename, fileBody, {
        httpMetadata: { contentType: fileContentType },
      });

      if (!object) {
        return ApiResponse.error("Internal Server Error", 500, "Upload failed");
      }


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
          disabled: users.disabled,
          createdAt: users.createdAt
        });

      if (!result || result.length === 0) {
        return ApiResponse.error("Internal Server Error", 500, "Failed to update user");
      }

      return ApiResponse.json(this.mapToUser(result[0]));
    } catch (error) {
      console.error("Error uploading user avatar:", error);
      return ApiResponse.error("Upload failed", 500, "Avatar upload failed");
    }
  }



  async deleteUserAvatar(
    currentUserId: number,
    targetUserId: number,
    isAdmin: boolean,
    env: any
  ): Promise<Response> {
    try {

      if (!isAdmin && currentUserId !== targetUserId) {
        return ApiResponse.error("Forbidden", 403, "You can only delete your own avatar");
      }


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


      const filename = currentAvatar.replace("/api/v1/image/", "");
      if (env.R2 && filename) {
        await env.R2.delete(filename);
      }


      await this.drizzle
        .update(users)
        .set({ avatar: null })
        .where(eq(users.id, targetUserId));

      return ApiResponse.json({});
    } catch (error) {
      console.error("Error deleting user avatar:", error);
      return ApiResponse.error("Delete failed", 500, "Avatar deletion failed");
    }
  }



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



  async updateUserPluginPermissions(userId: number, modulePaths: string[]): Promise<Response> {
    try {

      const userResult = await this.drizzle
        .select({ id: users.id })
        .from(users)
        .where(eq(users.id, userId))
        .get();

      if (!userResult) {
        return ApiResponse.error("Not Found", 404, "User not found");
      }


      await this.drizzle
        .delete(userPluginPermissions)
        .where(eq(userPluginPermissions.userId, userId));


      if (modulePaths.length > 0) {
        const permissionsToInsert = modulePaths.map(modulePath => ({
          userId,
          modulePath
        }));

        await this.drizzle
          .insert(userPluginPermissions)
          .values(permissionsToInsert);
      }


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
