import { generateToken } from "../middleware/auth.ts";
import { Application } from "../types/index.ts";
import { ApiResponse, toBoolean, formatDate } from "../utils/response.ts";

export class ApplicationHandlers {
  constructor(private db: D1Database) {}

  // Helper to map DB result to Application type
  private mapToApplication(row: any): Application {
    return {
      id: row.id,
      token: row.token,
      name: row.name,
      description: row.description || "",
      internal: toBoolean(row.internal),
      image: row.image || "",
      lastUsed: formatDate(row.lastUsed) || null,
      defaultPriority: row.defaultPriority || 0
    };
  }

  // 更新应用的最后使用时间（带频率限制）
  async updateLastUsed(applicationId: number): Promise<void> {
    try {
      await this.db.prepare(`
        UPDATE applications
        SET last_used = CURRENT_TIMESTAMP
        WHERE id = ? AND (last_used IS NULL OR last_used < datetime('now', '-1 minute'))
      `).bind(applicationId).run();
    } catch (error) {
      console.error("Failed to update application last_used:", error);
    }
  }

  // GET /application - Return all applications for the current user
  async getAllApplications(userId: number): Promise<Response> {
    try {
      const result = await this.db.prepare(`
        SELECT id, user_id as userId, token, name, description, default_priority as defaultPriority,
               image, internal, last_used as lastUsed
        FROM applications
        WHERE user_id = ?
        ORDER BY id
      `).bind(userId).all();

      const applications = result.results.map(row => this.mapToApplication(row));
      return ApiResponse.json(applications);
    } catch (error) {
      return ApiResponse.error("Database error", 500, "Failed to retrieve applications");
    }
  }

  // POST /application - Create an application
  async createApplication(userId: number, name: string, description?: string, defaultPriority?: number): Promise<Response> {
    try {
      const token = generateToken("app");
      const internal = false; // Default for created apps

      const result = await this.db.prepare(`
        INSERT INTO applications (user_id, token, name, description, default_priority, internal)
        VALUES (?, ?, ?, ?, ?, ?)
        RETURNING id, user_id as userId, token, name, description, default_priority as defaultPriority,
                  image, internal, last_used as lastUsed
      `).bind(userId, token, name, description || "", defaultPriority || 0, internal ? 1 : 0).first();

      if (!result) {
        return ApiResponse.error("Application creation failed", 400, "Could not create application");
      }

      const app = this.mapToApplication(result)
      try {
        const { PluginManager } = await import('../plugins/manager.ts')
        const pm = new PluginManager(this.db)
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
      const result = await this.db.prepare(`
        SELECT id, user_id as userId, token, name, description, default_priority as defaultPriority,
               image, internal, last_used as lastUsed
        FROM applications
        WHERE id = ? AND user_id = ?
      `).bind(parseInt(id), userId).first();

      if (!result) {
        return ApiResponse.error("Not Found", 404, "Application not found");
      }

      return ApiResponse.json(this.mapToApplication(result));
    } catch (error) {
      return ApiResponse.error("Database error", 500, "Failed to retrieve application");
    }
  }

  // PUT /application/{id} - Update an application
  async updateApplication(userId: number, id: string, data: {name?: string; description?: string; defaultPriority?: number}): Promise<Response> {
    try {
      const updateFields = [];
      const values = [];

      if (data.name) {
        updateFields.push("name = ?");
        values.push(data.name);
      }
      if (data.description !== undefined) {
        updateFields.push("description = ?");
        values.push(data.description);
      }
      if (data.defaultPriority !== undefined) {
        updateFields.push("default_priority = ?");
        values.push(data.defaultPriority);
      }

      if (updateFields.length === 0) {
        return this.getApplication(userId, id); // Nothing to update, return current state
      }

      updateFields.push("updated_at = CURRENT_TIMESTAMP");
      values.push(userId, parseInt(id));

      const result = await this.db.prepare(`
        UPDATE applications
        SET ${updateFields.join(", ")}
        WHERE id = ? AND user_id = ?
        RETURNING id, user_id as userId, token, name, description, default_priority as defaultPriority,
                  image, internal, last_used as lastUsed, created_at as createdAt, updated_at as updatedAt
      `).bind(...values).first();

      if (!result) {
        return ApiResponse.error("Not Found", 404, "Application not found or update failed");
      }

      return ApiResponse.json(this.mapToApplication(result));
    } catch (error) {
      return ApiResponse.error("Database error", 500, "Failed to update application");
    }
  }

  // DELETE /application/{id} - Delete an application
  async deleteApplication(userId: number, id: string): Promise<Response> {
    try {
      // Check if application exists, is internal, and belongs to the user
      const appCheck = await this.db.prepare(`
        SELECT internal FROM applications
        WHERE id = ? AND user_id = ?
      `).bind(parseInt(id), userId).first();

      if (!appCheck) {
        return ApiResponse.error("Not Found", 404, "Application not found");
      }

      // Prevent deletion of internal applications
      if (toBoolean((appCheck as any).internal)) {
        return ApiResponse.error("Forbidden", 403, "Internal applications cannot be deleted");
      }

      const result = await this.db.prepare(`
        DELETE FROM applications
        WHERE id = ? AND user_id = ?
      `).bind(parseInt(id), userId).run();

      if (result.meta.changes === 0) {
        return ApiResponse.error("Not Found", 404, "Application not found");
      }

      return ApiResponse.json({});
    } catch (error) {
      return ApiResponse.error("Database error", 500, "Failed to delete application");
    }
  }

  // POST /application/{id}/image - Upload an image for an application
  async uploadApplicationImage(userId: number, id: string, request: Request, env: any): Promise<Response> {
    try {
      // Check if application exists and belongs to the user
      const appResult = await this.db.prepare(`
        SELECT id FROM applications WHERE id = ? AND user_id = ?
      `).bind(parseInt(id), userId).first();

      if (!appResult) {
        return ApiResponse.error("Not Found", 404, "Application not found");
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
        if (!fileBlob.type.startsWith("image/")) {
          return ApiResponse.error("Bad Request", 400, "Only image files are allowed");
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
      const result = await this.db.prepare(`
        UPDATE applications
        SET image = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND user_id = ?
        RETURNING id, user_id as userId, token, name, description, default_priority as defaultPriority,
                  image, internal, last_used as lastUsed, created_at as createdAt, updated_at as updatedAt
      `).bind(imageUrl, parseInt(id), userId).first();

      if (!result) {
        return ApiResponse.error("Internal Server Error", 500, "Failed to update application with image");
      }

      return ApiResponse.json(this.mapToApplication(result));

    } catch (error) {
      return ApiResponse.error("Upload failed", 500, error instanceof Error ? error.message : "Unknown error");
    }
  }

  // DELETE /application/{id}/image - Delete an image of an application
  async deleteApplicationImage(userId: number, id: string, env: any): Promise<Response> {
    try {
      // Get current image URL
      const appResult = await this.db.prepare(`
        SELECT image FROM applications WHERE id = ? AND user_id = ?
      `).bind(parseInt(id), userId).first();

      if (!appResult) {
        return ApiResponse.error("Not Found", 404, "Application not found");
      }

      const currentImage = (appResult as any).image;
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
      await this.db.prepare(`
        UPDATE applications
        SET image = NULL, updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND user_id = ?
      `).bind(parseInt(id), userId).run();

      return ApiResponse.json({});

    } catch (error) {
      return ApiResponse.error("Delete failed", 500, error instanceof Error ? error.message : "Unknown error");
    }
  }
}
