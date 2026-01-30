import { generateToken } from "../middleware/auth.ts";
import { Application } from "../types/index.ts";
import { ApiResponse, formatDate } from "../utils/response.ts";
import { validateImageFile } from "../utils/fileValidation.ts";
import { DrizzleDB } from "../drizzle/index.ts";
import { applications, users } from "../models/index.ts";
import { eq, sql, and } from "drizzle-orm";

export class ApplicationHandlers {
  constructor(private drizzle: DrizzleDB) {}

  // Helper to map DB result to Application type
  private mapToApplication(row: any): Application {
    return {
      id: row.id,
      token: row.token,
      name: row.name,
      description: row.description || "",
      internal: Boolean(row.internal),
      image: row.image || "",
      lastUsed: formatDate(row.lastUsed) || null,
      defaultPriority: row.defaultPriority || 0
    };
  }

  // 更新应用的最后使用时间（带频率限制）
  async updateLastUsed(applicationId: number): Promise<void> {
    try {
      await this.drizzle
        .update(applications)
        .set({ lastUsed: sql`CURRENT_TIMESTAMP` })
        .where(sql`${applications.id} = ${applicationId} AND (${applications.lastUsed} IS NULL OR ${applications.lastUsed} < datetime('now', '-1 minute'))`);
    } catch (error) {
      console.error("Failed to update application last_used:", error);
    }
  }

  // GET /application - Return all applications for the current user
  async getAllApplications(userId: number): Promise<Response> {
    try {
      const apps = await this.drizzle
        .select({
          id: applications.id,
          userId: applications.userId,
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
      return ApiResponse.error("Database error", 500, "Failed to retrieve applications");
    }
  }

  // POST /application - Create an application
  async createApplication(userId: number, name: string, description?: string, defaultPriority?: number): Promise<Response> {
    try {
      const token = generateToken("app");
      const internal = false; // Default for created apps

      const result = await this.drizzle
        .insert(applications)
        .values({
          userId,
          token,
          name,
          description: description || "",
          defaultPriority: defaultPriority || 0,
          internal
        })
        .returning({
          id: applications.id,
          userId: applications.userId,
          token: applications.token,
          name: applications.name,
          description: applications.description,
          defaultPriority: applications.defaultPriority,
          image: applications.image,
          internal: applications.internal,
          lastUsed: applications.lastUsed
        });

      if (!result || result.length === 0) {
        return ApiResponse.error("Application creation failed", 400, "Could not create application");
      }

      const row = result[0];
      const app: Application = {
        id: row.id,
        token: row.token,
        name: row.name,
        description: row.description || "",
        internal: Boolean(row.internal),
        image: row.image || "",
        lastUsed: formatDate(row.lastUsed) || null,
        defaultPriority: row.defaultPriority || 0
      };

      try {
        const { PluginManager } = await import('../plugins/manager.ts')
        const pm = new PluginManager(this.drizzle)
        await pm.emit(userId, 'application.create', {
          userId,
          now: new Date().toISOString(),
          application: { id: app.id, name: app.name }
        })
      } catch {}
      return ApiResponse.json(app);
    } catch (error) {
      return ApiResponse.error("Database error", 500, "Failed to create application");
    }
  }

  // GET /application/{id} - Get an application by ID
  async getApplication(userId: number, id: string): Promise<Response> {
    try {
      const appId = parseInt(id);
      
      const result = await this.drizzle
        .select({
          id: applications.id,
          userId: applications.userId,
          token: applications.token,
          name: applications.name,
          description: applications.description,
          defaultPriority: applications.defaultPriority,
          image: applications.image,
          internal: applications.internal,
          lastUsed: applications.lastUsed
        })
        .from(applications)
        .where(sql`${applications.id} = ${appId} AND ${applications.userId} = ${userId}`)
        .get();

      if (!result) {
        return ApiResponse.error("Not Found", 404, "Application not found");
      }

      const app: Application = {
        id: result.id,
        token: result.token,
        name: result.name,
        description: result.description || "",
        internal: Boolean(result.internal),
        image: result.image || "",
        lastUsed: formatDate(result.lastUsed) || null,
        defaultPriority: result.defaultPriority || 0
      };

      return ApiResponse.json(app);
    } catch (error) {
      return ApiResponse.error("Database error", 500, "Failed to retrieve application");
    }
  }

  // PUT /application/{id} - Update an application
  async updateApplication(userId: number, id: string, data: {name?: string; description?: string; defaultPriority?: number}): Promise<Response> {
    try {
      const appId = parseInt(id);
      const updateData: any = {
        updatedAt: sql`CURRENT_TIMESTAMP`
      };

      if (data.name) {
        updateData.name = data.name;
      }
      if (data.description !== undefined) {
        updateData.description = data.description;
      }
      if (data.defaultPriority !== undefined) {
        updateData.defaultPriority = data.defaultPriority;
      }

      if (Object.keys(updateData).length === 1) {
        // Only updated_at was set, nothing to update
        return this.getApplication(userId, id);
      }

      const result = await this.drizzle
        .update(applications)
        .set(updateData)
        .where(sql`${applications.id} = ${appId} AND ${applications.userId} = ${userId}`)
        .returning({
          id: applications.id,
          userId: applications.userId,
          token: applications.token,
          name: applications.name,
          description: applications.description,
          defaultPriority: applications.defaultPriority,
          image: applications.image,
          internal: applications.internal,
          lastUsed: applications.lastUsed
        });

      if (!result || result.length === 0) {
        return ApiResponse.error("Not Found", 404, "Application not found or update failed");
      }

      const row = result[0];
      const app: Application = {
        id: row.id,
        token: row.token,
        name: row.name,
        description: row.description || "",
        internal: Boolean(row.internal),
        image: row.image || "",
        lastUsed: formatDate(row.lastUsed) || null,
        defaultPriority: row.defaultPriority || 0
      };

      return ApiResponse.json(app);
    } catch (error) {
      return ApiResponse.error("Database error", 500, "Failed to update application");
    }
  }

  // DELETE /application/{id} - Delete an application
  async deleteApplication(userId: number, id: string): Promise<Response> {
    try {
      const appId = parseInt(id);
      
      // Check if application exists, is internal, and belongs to the user
      const appCheck = await this.drizzle
        .select({ internal: applications.internal })
        .from(applications)
        .where(sql`${applications.id} = ${appId} AND ${applications.userId} = ${userId}`)
        .get();

      if (!appCheck) {
        return ApiResponse.error("Not Found", 404, "Application not found");
      }

      // Prevent deletion of internal applications
      if (Boolean(appCheck.internal)) {
        return ApiResponse.error("Forbidden", 403, "Internal applications cannot be deleted");
      }

      const result = await this.drizzle
        .delete(applications)
        .where(sql`${applications.id} = ${appId} AND ${applications.userId} = ${userId}`);

      if (result.meta.changes === 0) {
        return ApiResponse.error("Not Found", 404, "Application not found");
      }

      return ApiResponse.json({});
    } catch (error) {
      return ApiResponse.error("Database error", 500, "Failed to delete application");
    }
  }

  // POST /application/{id}/image - Upload an image for an application
  async uploadApplicationImage(userId: number, id: string, isAdmin: boolean, request: Request, env: any): Promise<Response> {
    try {
      const appId = parseInt(id);

      // Admin can access all applications, non-admin can only access their own
      const appResult = isAdmin
        ? await this.drizzle
            .select({ id: applications.id, userId: applications.userId })
            .from(applications)
            .where(eq(applications.id, appId))
            .get()
        : await this.drizzle
            .select({ id: applications.id, userId: applications.userId })
            .from(applications)
            .where(and(eq(applications.id, appId), eq(applications.userId, userId)))
            .get();

      if (!appResult) {
        return ApiResponse.error("Not Found", 404,
          isAdmin ? "Application not found" : "Application not found or you don't have permission");
      }

      // Check if R2 bucket is available
      if (!env.R2) {
        return ApiResponse.error("Service Unavailable", 503, "R2 storage not configured");
      }

      // Get content type
      const contentType = request.headers.get("content-type") || "";

      let fileBody: ReadableStream | ArrayBuffer;
      let fileContentType: string;

      // Handle multipart/form-data (Gotify spec format)
      if (contentType.includes("multipart/form-data")) {
        const formData = await request.formData();
        const file = formData.get("file");

        if (!file || typeof file === "string") {
          return ApiResponse.error("Bad Request", 400, "No file provided in form data. Use field name 'file'.");
        }

        // file is now a File/Blob object
        const fileBlob = file as Blob;

        // Validate using file-type (checks magic numbers)
        const validation = await validateImageFile(fileBlob);
        if (!validation.valid) {
          return ApiResponse.error("Bad Request", 400, validation.error || "Invalid image file");
        }

        fileBody = await fileBlob.arrayBuffer();
        fileContentType = fileBlob.type;
      }
      // Handle raw image body (alternative format)
      else if (contentType.startsWith("image/")) {
        fileBody = request.body!;
        fileContentType = contentType;
      }
      else {
        return ApiResponse.error("Bad Request", 400, "Content-Type must be multipart/form-data or image/*");
      }

      // Generate unique filename
      const timestamp = Date.now();
      const filename = `app-images/${id}-${timestamp}`;

      // Upload to R2
      const object = await env.R2.put(filename, fileBody, {
        httpMetadata: {
          contentType: fileContentType,
        },
      });

      if (!object) {
        return ApiResponse.error("Internal Server Error", 500, "Upload failed");
      }

      // Update application with image URL
      const imageUrl = `/api/v1/image/${filename}`;
      const result = await this.drizzle
        .update(applications)
        .set({
          image: imageUrl,
          updatedAt: sql`CURRENT_TIMESTAMP`
        })
        .where(eq(applications.id, appId))
        .returning({
          id: applications.id,
          userId: applications.userId,
          token: applications.token,
          name: applications.name,
          description: applications.description,
          defaultPriority: applications.defaultPriority,
          image: applications.image,
          internal: applications.internal,
          lastUsed: applications.lastUsed
        });

      if (!result || result.length === 0) {
        return ApiResponse.error("Internal Server Error", 500, "Failed to update application with image");
      }

      const row = result[0];
      const app: Application = {
        id: row.id,
        token: row.token,
        name: row.name,
        description: row.description || "",
        internal: Boolean(row.internal),
        image: row.image || "",
        lastUsed: formatDate(row.lastUsed) || null,
        defaultPriority: row.defaultPriority || 0
      };

      return ApiResponse.json(app);

    } catch (error) {
      return ApiResponse.error("Upload failed", 500, error instanceof Error ? error.message : "Unknown error");
    }
  }

  // DELETE /application/{id}/image - Delete an image of an application
  async deleteApplicationImage(userId: number, id: string, isAdmin: boolean, env: any): Promise<Response> {
    try {
      const appId = parseInt(id);

      // Admin can access all applications, non-admin can only access their own
      const appResult = isAdmin
        ? await this.drizzle
            .select({ image: applications.image, userId: applications.userId })
            .from(applications)
            .where(eq(applications.id, appId))
            .get()
        : await this.drizzle
            .select({ image: applications.image, userId: applications.userId })
            .from(applications)
            .where(and(eq(applications.id, appId), eq(applications.userId, userId)))
            .get();

      if (!appResult) {
        return ApiResponse.error("Not Found", 404,
          isAdmin ? "Application not found" : "Application not found or you don't have permission");
      }

      const currentImage = appResult.image;
      if (!currentImage) {
        return ApiResponse.error("Not Found", 404, "No image to delete");
      }

      // Extract filename from URL
      const filename = currentImage.replace("/api/v1/image/", "");

      // Delete from R2 if available
      if (env.R2 && filename) {
        await env.R2.delete(filename);
      }

      // Update application to remove image reference
      await this.drizzle
        .update(applications)
        .set({
          image: null,
          updatedAt: sql`CURRENT_TIMESTAMP`
        })
        .where(eq(applications.id, appId));

      return ApiResponse.json({});

    } catch (error) {
      return ApiResponse.error("Delete failed", 500, error instanceof Error ? error.message : "Unknown error");
    }
  }
}
