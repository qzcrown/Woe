




import { generateEnhancedToken } from "../utils/enhancedToken.ts";
import { Application } from "../types/index.ts";
import { ApiResponse, formatDate } from "../utils/response.ts";
import { IMAGE_MAX_FILE_SIZE, validateImageFile, validateRawImageRequest } from "../utils/fileValidation.ts";
import { DrizzleDB } from "../drizzle/index.ts";
import { applications, users } from "../models/index.ts";
import { eq, sql, and } from "drizzle-orm";
import { ImageCompressionError, ImageCompressionService } from "../services/imageCompressionService.ts";
import { normalizeMediaPath, DEFAULT_APP_IMAGE } from "../utils/mediaPath.ts";
import type { D1Database } from "@cloudflare/workers-types";


export class ApplicationHandlers {
  constructor(private drizzle: DrizzleDB, private rawDb?: D1Database) {}

  private generateSortKey(): string {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  }



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



  async getAllApplications(userId: number): Promise<Response> {
    try {
      const apps = await this.drizzle
        .select({
          id: applications.id,
          userId: applications.userId,
          token: applications.token,
          name: applications.name,
          sortKey: applications.sortKey,
          description: applications.description,
          defaultPriority: applications.defaultPriority,
          image: applications.image,
          internal: applications.internal,
          lastUsed: applications.lastUsed,
          createdAt: applications.createdAt
        })
        .from(applications)
        .where(eq(applications.userId, userId))
        .orderBy(applications.sortKey, applications.id);

      const mappedApps = apps.map(row => ({
        id: row.id,


        name: row.name,
        sortKey: row.sortKey || "",
        description: row.description || "",
        internal: Boolean(row.internal),

        image: normalizeMediaPath(row.image, DEFAULT_APP_IMAGE),
        lastUsed: formatDate(row.lastUsed) || null,
        createdAt: formatDate(row.createdAt) ?? null,
        defaultPriority: row.defaultPriority || 0
      }));

      return ApiResponse.json(mappedApps);
    } catch (error) {
      return ApiResponse.error("Database error", 500, "Failed to retrieve applications");
    }
  }



  async createApplication(
    userId: number,
    name: string,
    description?: string,
    defaultPriority?: number,
    sortKey?: string
  ): Promise<Response> {
    try {

      const { publicForm, privateForm } = generateEnhancedToken("app");
      const internal = false;
      const finalSortKey = sortKey?.trim() || this.generateSortKey();

      const result = await this.drizzle
        .insert(applications)
        .values({
          userId,
          token: publicForm,
          name,
          sortKey: finalSortKey,
          description: description || "",
          defaultPriority: defaultPriority || 0,
          internal
        })
        .returning({
          id: applications.id,
          userId: applications.userId,
          token: applications.token,
          name: applications.name,
          sortKey: applications.sortKey,
          description: applications.description,
          defaultPriority: applications.defaultPriority,
          image: applications.image,
          internal: applications.internal,
          lastUsed: applications.lastUsed,
          createdAt: applications.createdAt
        });

      if (!result || result.length === 0) {
        return ApiResponse.error("Application creation failed", 400, "Could not create application");
      }

      const row = result[0];
      const app: Application = {
        id: row.id,

        token: privateForm,
        name: row.name,
        sortKey: row.sortKey || "",
        description: row.description || "",
        internal: Boolean(row.internal),

        image: normalizeMediaPath(row.image, DEFAULT_APP_IMAGE),
        lastUsed: formatDate(row.lastUsed) || null,
        createdAt: formatDate(row.createdAt) ?? null,
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



  async getApplication(userId: number, id: string): Promise<Response> {
    try {
      const appId = parseInt(id);

      const result = await this.drizzle
        .select({
          id: applications.id,
          userId: applications.userId,
          token: applications.token,
          name: applications.name,
          sortKey: applications.sortKey,
          description: applications.description,
          defaultPriority: applications.defaultPriority,
          image: applications.image,
          internal: applications.internal,
          lastUsed: applications.lastUsed,
          createdAt: applications.createdAt
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
        sortKey: result.sortKey || "",
        description: result.description || "",
        internal: Boolean(result.internal),

        image: normalizeMediaPath(result.image, DEFAULT_APP_IMAGE),
        lastUsed: formatDate(result.lastUsed) || null,
        createdAt: formatDate(result.createdAt) ?? null,
        defaultPriority: result.defaultPriority || 0
      };


      return ApiResponse.json(app, 200, { 'Cache-Control': 'private, no-store' });
    } catch (error) {
      return ApiResponse.error("Database error", 500, "Failed to retrieve application");
    }
  }



  async updateApplication(
    userId: number,
    id: string,
    data: {name?: string; description?: string; defaultPriority?: number; sortKey?: string}
  ): Promise<Response> {
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
      if (data.sortKey !== undefined) {
        updateData.sortKey = data.sortKey;
      }

      if (Object.keys(updateData).length === 1) {

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
          sortKey: applications.sortKey,
          description: applications.description,
          defaultPriority: applications.defaultPriority,
          image: applications.image,
          internal: applications.internal,
          lastUsed: applications.lastUsed,
          createdAt: applications.createdAt
        });

      if (!result || result.length === 0) {
        return ApiResponse.error("Not Found", 404, "Application not found or update failed");
      }

      const row = result[0];
      const app: Application = {
        id: row.id,
        token: row.token,
        name: row.name,
        sortKey: row.sortKey || "",
        description: row.description || "",
        internal: Boolean(row.internal),

        image: normalizeMediaPath(row.image, DEFAULT_APP_IMAGE),
        lastUsed: formatDate(row.lastUsed) || null,
        createdAt: formatDate(row.createdAt) ?? null,
        defaultPriority: row.defaultPriority || 0
      };

      return ApiResponse.json(app);
    } catch (error) {
      return ApiResponse.error("Database error", 500, "Failed to update application");
    }
  }














  async deleteApplication(userId: number, id: string): Promise<Response> {
    try {
      const appId = parseInt(id);


      const appCheck = await this.drizzle
        .select({ internal: applications.internal })
        .from(applications)
        .where(sql`${applications.id} = ${appId} AND ${applications.userId} = ${userId}`)
        .get();

      if (!appCheck) {
        return ApiResponse.error("Not Found", 404, "Application not found");
      }


      if (Boolean(appCheck.internal)) {
        return ApiResponse.error("Forbidden", 403, "Internal applications cannot be deleted");
      }


      if (!this.rawDb) {
        return ApiResponse.error("Database error", 500, "Failed to delete application");
      }

      const results: unknown = await this.rawDb.batch([


        this.rawDb.prepare(`
          DELETE FROM messages
          WHERE appid = ?
            AND EXISTS (
              SELECT 1 FROM applications
              WHERE id = ? AND user_id = ? AND internal = 0
            )
        `).bind(appId, appId, userId),

        this.rawDb.prepare(`
          DELETE FROM applications
          WHERE id = ? AND user_id = ? AND internal = 0
          RETURNING id
        `).bind(appId, userId)
      ]);


      if (!Array.isArray(results) || results.length < 2) {
        return ApiResponse.error("Database error", 500, "Failed to delete application");
      }
      const isD1Result = (value: unknown): value is { success: true; results: unknown[] } =>
        typeof value === "object" &&
        value !== null &&
        (value as { success?: unknown }).success === true &&
        Array.isArray((value as { results?: unknown }).results);
      const [messagesResult, deleteResult] = results;
      if (!isD1Result(messagesResult) || !isD1Result(deleteResult)) {
        return ApiResponse.error("Database error", 500, "Failed to delete application");
      }

      const deleted = deleteResult.results.some(
        (row) =>
          typeof row === "object" &&
          row !== null &&
          Number((row as { id?: unknown }).id) === appId
      );
      if (!deleted) {
        return ApiResponse.error("Not Found", 404, "Application not found");
      }

      return ApiResponse.json({});
    } catch (error) {

      console.error(
        "deleteApplication: D1 batch failed:",
        error instanceof Error ? error.message : "non-error failure"
      );
      return ApiResponse.error("Database error", 500, "Failed to delete application");
    }
  }








  async updateApplicationSecurity(userId: number, id: string, regenerateToken: boolean): Promise<Response> {
    try {
      const appId = parseInt(id);
      if (isNaN(appId)) {
        return ApiResponse.error("Bad Request", 400, "Invalid application ID");
      }


      const app = await this.drizzle
        .select({ id: applications.id })
        .from(applications)
        .where(sql`${applications.id} = ${appId} AND ${applications.userId} = ${userId}`)
        .get();

      if (!app) {
        return ApiResponse.error("Not Found", 404, "Application not found or no permission");
      }


      if (!regenerateToken) {
        return ApiResponse.json({});
      }


      const { publicForm, privateForm } = generateEnhancedToken("app");
      const result = await this.drizzle
        .update(applications)
        .set({
          token: publicForm,
          updatedAt: sql`CURRENT_TIMESTAMP`
        })
        .where(sql`${applications.id} = ${appId} AND ${applications.userId} = ${userId}`);

      if (!result || result.meta.changes === 0) {
        return ApiResponse.error("Not Found", 404, "Application not found or no permission");
      }

      return ApiResponse.json({ regenerateToken: { token: privateForm } });
    } catch (error) {
      console.error("Error regenerating application token:", error);
      return ApiResponse.error("Database error", 500, "Failed to regenerate application token");
    }
  }



  async regenerateApplicationToken(userId: number, id: string): Promise<Response> {
    return this.updateApplicationSecurity(userId, id, true);
  }



  async uploadApplicationImage(userId: number, id: string, isAdmin: boolean, request: Request, env: any): Promise<Response> {
    try {
      const appId = parseInt(id);


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
          return ApiResponse.error("Bad Request", 400, "No file provided in form data. Use field name 'file'.");
        }


        const fileBlob = file as Blob;


        const validation = await validateImageFile(fileBlob);
        if (!validation.valid) {
          return ApiResponse.error("Bad Request", 400, validation.error || "Invalid image file");
        }

        sourceBuffer = await fileBlob.arrayBuffer();
        fileContentType = fileBlob.type;
      }

      else if (contentType.toLowerCase().startsWith("image/")) {
        const validation = await validateRawImageRequest(request, IMAGE_MAX_FILE_SIZE);
        if (!validation.valid || !validation.buffer || !validation.mime) {
          return ApiResponse.error("Bad Request", 400, validation.error || "Invalid image file");
        }
        sourceBuffer = validation.buffer;
        fileContentType = validation.mime;
      }
      else {
        return ApiResponse.error("Bad Request", 400, "Content-Type must be multipart/form-data or image/*");
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
      const filename = `app-images/${id}-${timestamp}`;


      const object = await env.R2.put(filename, fileBody, {
        httpMetadata: {
          contentType: fileContentType,
        },
      });

      if (!object) {
        return ApiResponse.error("Internal Server Error", 500, "Upload failed");
      }


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
          sortKey: applications.sortKey,
          description: applications.description,
          defaultPriority: applications.defaultPriority,
          image: applications.image,
          internal: applications.internal,
          lastUsed: applications.lastUsed,
          createdAt: applications.createdAt
        });

      if (!result || result.length === 0) {
        return ApiResponse.error("Internal Server Error", 500, "Failed to update application with image");
      }

      const row = result[0];
      const app: Application = {
        id: row.id,
        token: row.token,
        name: row.name,
        sortKey: row.sortKey || "",
        description: row.description || "",
        internal: Boolean(row.internal),

        image: normalizeMediaPath(row.image, DEFAULT_APP_IMAGE),
        lastUsed: formatDate(row.lastUsed) || null,
        createdAt: formatDate(row.createdAt) ?? null,
        defaultPriority: row.defaultPriority || 0
      };

      return ApiResponse.json(app);

    } catch (error) {
      console.error("Error uploading application image:", error);
      return ApiResponse.error("Upload failed", 500, "Image upload failed");
    }
  }



  async deleteApplicationImage(userId: number, id: string, isAdmin: boolean, env: any): Promise<Response> {
    try {
      const appId = parseInt(id);


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


      const filename = currentImage.replace("/api/v1/image/", "");


      if (env.R2 && filename) {
        await env.R2.delete(filename);
      }



      const result = await this.drizzle
        .update(applications)
        .set({
          image: null,
          updatedAt: sql`CURRENT_TIMESTAMP`
        })
        .where(eq(applications.id, appId))
        .returning({
          id: applications.id,
          userId: applications.userId,
          token: applications.token,
          name: applications.name,
          sortKey: applications.sortKey,
          description: applications.description,
          defaultPriority: applications.defaultPriority,
          image: applications.image,
          internal: applications.internal,
          lastUsed: applications.lastUsed,
          createdAt: applications.createdAt
        });

      if (!result || result.length === 0) {
        return ApiResponse.error("Not Found", 404, "Application not found");
      }



      const row = result[0];
      const app: Application = {
        id: row.id,
        token: "",
        name: row.name,
        sortKey: row.sortKey || "",
        description: row.description || "",
        internal: Boolean(row.internal),
        image: normalizeMediaPath(row.image, DEFAULT_APP_IMAGE),
        lastUsed: formatDate(row.lastUsed) || null,
        createdAt: formatDate(row.createdAt) ?? null,
        defaultPriority: row.defaultPriority || 0
      };

      return ApiResponse.json(app);

    } catch (error) {
      console.error("Error deleting application image:", error);
      return ApiResponse.error("Delete failed", 500, "Image deletion failed");
    }
  }
}
