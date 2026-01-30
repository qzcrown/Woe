import { PluginConf } from "../types/index.ts";
import { ApiResponse, safeJsonParse } from "../utils/response.ts";
import { validateImageFile } from "../utils/fileValidation.ts";
import { DrizzleDB } from "../drizzle/index.ts";
import { pluginConfigs, pluginLogs, userPluginPermissions } from "../models/index.ts";
import { eq, sql, desc, and, inArray } from "drizzle-orm";

export class PluginHandlers {
  constructor(private drizzle: DrizzleDB) {}

  // Helper to get user's permitted plugin module paths
  private async getUserPermittedPlugins(userId: number): Promise<Set<string>> {
    const permissions = await this.drizzle
      .select({ modulePath: userPluginPermissions.modulePath })
      .from(userPluginPermissions)
      .where(eq(userPluginPermissions.userId, userId));
    return new Set(permissions.map(p => p.modulePath));
  }

  // Helper to check if user has permission for a specific plugin
  private async hasPluginPermission(userId: number, modulePath: string): Promise<boolean> {
    const permission = await this.drizzle
      .select({ id: userPluginPermissions.id })
      .from(userPluginPermissions)
      .where(and(
        eq(userPluginPermissions.userId, userId),
        eq(userPluginPermissions.modulePath, modulePath)
      ))
      .get();
    return !!permission;
  }

  // Helper to map DB result to PluginConf type
  private mapToPluginConf(row: any): PluginConf {
    return {
      id: row.id,
      name: row.name,
      token: row.token,
      modulePath: row.module_path,
      enabled: Boolean(row.enabled),
      icon: row.icon,
      capabilities: safeJsonParse(row.capabilities) || [],
      author: row.author,
      license: row.license,
      website: row.website
    };
  }

  private generatePluginToken(): string {
    const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    let randomPart = "";
    for (let i = 0; i < 10; i++) {
      randomPart += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return "P" + randomPart;
  }

  private async getConfigExample(modulePath: string): Promise<string> {
    try {
      const { resolve } = await import('../plugins/registry.ts');
      const tempPlugin = resolve(modulePath, 0, '');
      return tempPlugin?.configExample || '';
    } catch (error) {
      console.warn(`Failed to get config example for ${modulePath}:`, error);
      return '';
    }
  }

  private async ensureDefaultPlugins(userId: number): Promise<void> {
    const existingRes = await this.drizzle
      .select({ modulePath: pluginConfigs.modulePath })
      .from(pluginConfigs)
      .where(eq(pluginConfigs.userId, userId));

    const existing = new Set(existingRes.map(r => r.modulePath));

    const builtins = [
      { modulePath: 'builtin/webhooker', name: 'Webhooker', capabilities: ['webhooker', 'messenger'] },
      { modulePath: 'builtin/displayer', name: 'Displayer', capabilities: ['displayer'] }
    ];

    for (const b of builtins) {
      if (!existing.has(b.modulePath)) {
        const token = this.generatePluginToken();
        await this.drizzle
          .insert(pluginConfigs)
          .values({
            userId,
            name: b.name,
            token,
            modulePath: b.modulePath,
            enabled: 0,
            configYaml: ''
          });
      }
    }
  }

  // GET /plugin - Return all plugins for the authenticated user
  async getAllPlugins(userId: number, isAdmin: boolean = false): Promise<Response> {
    try {
      await this.ensureDefaultPlugins(userId);
      
      // Get user's permitted plugins (only applies to non-admin)
      const permittedPlugins = isAdmin ? null : await this.getUserPermittedPlugins(userId);
      
      const results = await this.drizzle
        .select({
          id: pluginConfigs.id,
          userId: pluginConfigs.userId,
          name: pluginConfigs.name,
          token: pluginConfigs.token,
          modulePath: pluginConfigs.modulePath,
          enabled: pluginConfigs.enabled,
          icon: pluginConfigs.icon,
          configYaml: pluginConfigs.configYaml
        })
        .from(pluginConfigs)
        .where(eq(pluginConfigs.userId, userId))
        .orderBy(pluginConfigs.id);

      // Filter by permissions for non-admin users
      const filteredResults = isAdmin 
        ? results 
        : results.filter(r => permittedPlugins!.has(r.modulePath));

      const plugins = await Promise.all(
        filteredResults.map(async (row) => {
          const configExample = await this.getConfigExample(row.modulePath);
          return {
            id: row.id,
            name: row.name,
            token: row.token,
            modulePath: row.modulePath,
            enabled: Boolean(row.enabled),
            icon: row.icon,
            capabilities: [],
            author: '',
            license: '',
            website: '',
            configExample: configExample
          };
        })
      );

      return ApiResponse.json(plugins);
    } catch (error) {
      console.error("Error retrieving plugins:", error);
      return ApiResponse.error("Database error", 500, "Failed to retrieve plugins");
    }
  }

  // GET /plugin/{id}/config - Get YAML configuration for Configurer plugin
  async getPluginConfig(userId: number, id: string, isAdmin: boolean = false): Promise<Response> {
    try {
      const pluginId = parseInt(id);
      if (isNaN(pluginId)) {
        return ApiResponse.error("Bad Request", 400, "Invalid plugin ID");
      }

      const result = await this.drizzle
        .select({ 
          configYaml: pluginConfigs.configYaml,
          modulePath: pluginConfigs.modulePath 
        })
        .from(pluginConfigs)
        .where(sql`${pluginConfigs.id} = ${pluginId} AND ${pluginConfigs.userId} = ${userId}`)
        .get();

      if (!result) {
        return ApiResponse.error("Not Found", 404, "Plugin not found");
      }

      // Check permission for non-admin users
      if (!isAdmin) {
        const hasPermission = await this.hasPluginPermission(userId, result.modulePath);
        if (!hasPermission) {
          return ApiResponse.error("Forbidden", 403, "You don't have permission to access this plugin");
        }
      }

      // Return YAML config as plain text if it exists, otherwise return empty string
      const configYaml = result.configYaml || "";

      // If no config exists, return empty YAML document with correct content type
      if (!configYaml) {
        return new Response("", {
          status: 200,
          headers: {
            "Content-Type": "application/x-yaml"
          }
        });
      }

      // Return as plain text with YAML content type
      return new Response(configYaml, {
        status: 200,
        headers: {
          "Content-Type": "application/x-yaml"
        }
      });
    } catch (error) {
      console.error("Error retrieving plugin config:", error);
      return ApiResponse.error("Database error", 500, "Failed to retrieve plugin config");
    }
  }

  // GET /plugin/{id}/logs - Return recent execution logs for a plugin
  async getPluginLogs(userId: number, id: string, limit: number = 50): Promise<Response> {
    try {
      const pluginId = parseInt(id)
      if (isNaN(pluginId)) {
        return ApiResponse.error("Bad Request", 400, "Invalid plugin ID")
      }

      const result = await this.drizzle
        .select({
          id: pluginLogs.id,
          event: pluginLogs.event,
          status: pluginLogs.status,
          durationMs: pluginLogs.durationMs,
          error: pluginLogs.error,
          createdAt: pluginLogs.createdAt
        })
        .from(pluginLogs)
        .where(sql`${pluginLogs.pluginId} = ${pluginId} AND ${pluginLogs.userId} = ${userId}`)
        .orderBy(desc(pluginLogs.id))
        .limit(Math.min(Math.max(limit, 1), 200))
        .execute()

      return ApiResponse.json(result)
    } catch (error) {
      return ApiResponse.error("Database error", 500, "Failed to retrieve plugin logs")
    }
  }

  // POST /plugin/{id}/config - Update YAML configuration for Configurer plugin
  async updatePluginConfig(userId: number, id: string, request: Request, isAdmin: boolean = false): Promise<Response> {
    try {
      const pluginId = parseInt(id);
      if (isNaN(pluginId)) {
        return ApiResponse.error("Bad Request", 400, "Invalid plugin ID");
      }

      // Verify plugin exists and belongs to user
      const plugin = await this.drizzle
        .select({ id: pluginConfigs.id, modulePath: pluginConfigs.modulePath })
        .from(pluginConfigs)
        .where(sql`${pluginConfigs.id} = ${pluginId} AND ${pluginConfigs.userId} = ${userId}`)
        .get();

      if (!plugin) {
        return ApiResponse.error("Not Found", 404, "Plugin not found");
      }

      // Check permission for non-admin users
      if (!isAdmin) {
        const hasPermission = await this.hasPluginPermission(userId, plugin.modulePath);
        if (!hasPermission) {
          return ApiResponse.error("Forbidden", 403, "You don't have permission to configure this plugin");
        }
      }

      // Validate Content-Type is application/x-yaml
      const contentType = request.headers.get("content-type");
      if (!contentType || !contentType.includes("application/x-yaml")) {
        return ApiResponse.error("Bad Request", 400, "Content-Type must be application/x-yaml");
      }

      // Read the request body as text (YAML content)
      const configYaml = await request.text();

      // Update the config
      await this.drizzle
        .update(pluginConfigs)
        .set({
          configYaml,
          updatedAt: sql`CURRENT_TIMESTAMP`
        })
        .where(sql`${pluginConfigs.id} = ${pluginId} AND ${pluginConfigs.userId} = ${userId}`);

      try {
        const { PluginManager } = await import('../plugins/manager.ts');
        const pm = new PluginManager(this.drizzle);
        pm.invalidate(userId);
      } catch {}
      return ApiResponse.json({});
    } catch (error) {
      console.error("Error updating plugin config:", error);
      return ApiResponse.error("Database error", 500, "Failed to update plugin config");
    }
  }

  // POST /plugin/{id}/enable - Enable a plugin
  async enablePlugin(userId: number, id: string, isAdmin: boolean = false): Promise<Response> {
    try {
      const pluginId = parseInt(id);
      if (isNaN(pluginId)) {
        return ApiResponse.error("Bad Request", 400, "Invalid plugin ID");
      }

      // Get plugin info first to check permission
      const plugin = await this.drizzle
        .select({ id: pluginConfigs.id, modulePath: pluginConfigs.modulePath })
        .from(pluginConfigs)
        .where(sql`${pluginConfigs.id} = ${pluginId} AND ${pluginConfigs.userId} = ${userId}`)
        .get();

      if (!plugin) {
        return ApiResponse.error("Not Found", 404, "Plugin not found or no permission");
      }

      // Check permission for non-admin users
      if (!isAdmin) {
        const hasPermission = await this.hasPluginPermission(userId, plugin.modulePath);
        if (!hasPermission) {
          return ApiResponse.error("Forbidden", 403, "You don't have permission to enable this plugin");
        }
      }

      // Enable the plugin
      await this.drizzle
        .update(pluginConfigs)
        .set({
          enabled: 1,
          updatedAt: sql`CURRENT_TIMESTAMP`
        })
        .where(sql`${pluginConfigs.id} = ${pluginId} AND ${pluginConfigs.userId} = ${userId}`);

      try {
        const { PluginManager } = await import('../plugins/manager.ts');
        const pm = new PluginManager(this.drizzle);
        pm.invalidate(userId);
      } catch {}
      return ApiResponse.json({});
    } catch (error) {
      console.error("Error enabling plugin:", error);
      return ApiResponse.error("Database error", 500, "Failed to enable plugin");
    }
  }

  // POST /plugin/{id}/disable - Disable a plugin
  async disablePlugin(userId: number, id: string, isAdmin: boolean = false): Promise<Response> {
    try {
      const pluginId = parseInt(id);
      if (isNaN(pluginId)) {
        return ApiResponse.error("Bad Request", 400, "Invalid plugin ID");
      }

      // Get plugin info first to check permission
      const plugin = await this.drizzle
        .select({ id: pluginConfigs.id, modulePath: pluginConfigs.modulePath })
        .from(pluginConfigs)
        .where(sql`${pluginConfigs.id} = ${pluginId} AND ${pluginConfigs.userId} = ${userId}`)
        .get();

      if (!plugin) {
        return ApiResponse.error("Not Found", 404, "Plugin not found or no permission");
      }

      // Check permission for non-admin users
      if (!isAdmin) {
        const hasPermission = await this.hasPluginPermission(userId, plugin.modulePath);
        if (!hasPermission) {
          return ApiResponse.error("Forbidden", 403, "You don't have permission to disable this plugin");
        }
      }

      // Disable the plugin
      await this.drizzle
        .update(pluginConfigs)
        .set({
          enabled: 0,
          updatedAt: sql`CURRENT_TIMESTAMP`
        })
        .where(sql`${pluginConfigs.id} = ${pluginId} AND ${pluginConfigs.userId} = ${userId}`);

      try {
        const { PluginManager } = await import('../plugins/manager.ts');
        const pm = new PluginManager(this.drizzle);
        pm.invalidate(userId);
      } catch {}
      return ApiResponse.json({});
    } catch (error) {
      console.error("Error disabling plugin:", error);
      return ApiResponse.error("Database error", 500, "Failed to disable plugin");
    }
  }

  // GET /plugin/{id}/display - Get display info for Displayer plugin
  async getPluginDisplay(userId: number, id: string): Promise<Response> {
    try {
      const pluginId = parseInt(id);
      if (isNaN(pluginId)) {
        return ApiResponse.error("Bad Request", 400, "Invalid plugin ID");
      }

      const pluginConfig = await this.drizzle
        .select({
          id: pluginConfigs.id,
          name: pluginConfigs.name,
          modulePath: pluginConfigs.modulePath,
          enabled: pluginConfigs.enabled,
          configYaml: pluginConfigs.configYaml
        })
        .from(pluginConfigs)
        .where(sql`${pluginConfigs.id} = ${pluginId} AND ${pluginConfigs.userId} = ${userId}`)
        .get();

      if (!pluginConfig) {
        return ApiResponse.error("Not Found", 404, "Plugin not found");
      }

      if (!Boolean(pluginConfig.enabled)) {
        return ApiResponse.json({})
      }

      try {
        const { parse } = await import('yaml')
        const config = pluginConfig.configYaml ? parse(pluginConfig.configYaml) as Record<string, any> : undefined
        const { resolve } = await import('../plugins/registry.ts')
        const plugin = resolve(pluginConfig.modulePath, pluginConfig.id, pluginConfig.name)
        if (!plugin || !plugin.renderDisplay) {
          return ApiResponse.json({})
        }
        await plugin.init({ config })
        const content = await plugin.renderDisplay({ userId, now: new Date().toISOString() })
        return ApiResponse.json(content)
      } catch (e) {
        return ApiResponse.error('Plugin display error', 500, 'Failed to render display')
      }
    } catch (error) {
      console.error("Error retrieving plugin display info:", error);
      return ApiResponse.error("Database error", 500, "Failed to retrieve plugin display info");
    }
  }

  // POST /plugin - Create a new plugin instance (admin only)
  async createPlugin(adminUserId: number, request: Request): Promise<Response> {
    try {
      const body = await request.json() as {
        modulePath?: string;
        name?: string;
        targetUserId?: number;
      };
      const { modulePath, name, targetUserId } = body;

      if (!modulePath || !name) {
        return ApiResponse.error("Bad Request", 400, "modulePath and name are required");
      }

      // Use targetUserId or admin's own ID
      const userId = targetUserId || adminUserId;

      // Check if plugin type exists in registry
      try {
        const { resolve } = await import('../plugins/registry.ts');
        const plugin = resolve(modulePath, 0, '');
        if (!plugin) {
          return ApiResponse.error("Bad Request", 400, "Invalid modulePath");
        }
      } catch {
        return ApiResponse.error("Bad Request", 400, "Invalid modulePath");
      }

      // Check for duplicate name
      const existing = await this.drizzle
        .select({ id: pluginConfigs.id })
        .from(pluginConfigs)
        .where(and(
          eq(pluginConfigs.userId, userId),
          eq(pluginConfigs.name, name)
        ))
        .get();

      if (existing) {
        return ApiResponse.error("Conflict", 409, "Plugin with this name already exists");
      }

      // Create new plugin instance
      const token = this.generatePluginToken();
      const result = await this.drizzle
        .insert(pluginConfigs)
        .values({
          userId,
          name,
          token,
          modulePath,
          enabled: 0,
          configYaml: ''
        })
        .returning({ id: pluginConfigs.id });

      // Invalidate cache for the target user
      try {
        const { PluginManager } = await import('../plugins/manager.ts');
        const pm = new PluginManager(this.drizzle);
        pm.invalidate(userId);
      } catch {}

      return ApiResponse.json({ id: result[0].id, name, token, modulePath, enabled: false });
    } catch (error) {
      console.error("Error creating plugin:", error);
      return ApiResponse.error("Database error", 500, "Failed to create plugin");
    }
  }

  // DELETE /plugin/:id - Delete a plugin instance (admin only)
  async deletePlugin(userId: number, id: string): Promise<Response> {
    try {
      const pluginId = parseInt(id);
      if (isNaN(pluginId)) {
        return ApiResponse.error("Bad Request", 400, "Invalid plugin ID");
      }

      // Get plugin info first
      const plugin = await this.drizzle
        .select({ id: pluginConfigs.id, modulePath: pluginConfigs.modulePath })
        .from(pluginConfigs)
        .where(sql`${pluginConfigs.id} = ${pluginId} AND ${pluginConfigs.userId} = ${userId}`)
        .get();

      if (!plugin) {
        return ApiResponse.error("Not Found", 404, "Plugin not found");
      }

      // Delete the plugin
      await this.drizzle
        .delete(pluginConfigs)
        .where(sql`${pluginConfigs.id} = ${pluginId} AND ${pluginConfigs.userId} = ${userId}`);

      // Invalidate cache
      try {
        const { PluginManager } = await import('../plugins/manager.ts');
        const pm = new PluginManager(this.drizzle);
        pm.invalidate(userId);
      } catch {}

      return ApiResponse.json({});
    } catch (error) {
      console.error("Error deleting plugin:", error);
      return ApiResponse.error("Database error", 500, "Failed to delete plugin");
    }
  }

  // PUT /plugin/{id}/name - Update plugin name
  async updatePluginName(userId: number, id: string, request: Request, isAdmin: boolean = false): Promise<Response> {
    try {
      const pluginId = parseInt(id);
      if (isNaN(pluginId)) {
        return ApiResponse.error("Bad Request", 400, "Invalid plugin ID");
      }

      const body = await request.json() as { name?: string };
      const { name } = body;

      if (!name || name.trim() === '') {
        return ApiResponse.error("Bad Request", 400, "Name is required");
      }

      const trimmedName = name.trim();

      // Verify plugin exists and belongs to user
      const plugin = await this.drizzle
        .select({ id: pluginConfigs.id, modulePath: pluginConfigs.modulePath })
        .from(pluginConfigs)
        .where(sql`${pluginConfigs.id} = ${pluginId} AND ${pluginConfigs.userId} = ${userId}`)
        .get();

      if (!plugin) {
        return ApiResponse.error("Not Found", 404, "Plugin not found");
      }

      // Check permission for non-admin users
      if (!isAdmin) {
        const hasPermission = await this.hasPluginPermission(userId, plugin.modulePath);
        if (!hasPermission) {
          return ApiResponse.error("Forbidden", 403, "You don't have permission to modify this plugin");
        }
      }

      // Check for duplicate name (excluding current plugin)
      const existing = await this.drizzle
        .select({ id: pluginConfigs.id })
        .from(pluginConfigs)
        .where(and(
          eq(pluginConfigs.userId, userId),
          eq(pluginConfigs.name, trimmedName),
          sql`${pluginConfigs.id} != ${pluginId}`
        ))
        .get();

      if (existing) {
        return ApiResponse.error("Conflict", 409, "A plugin with this name already exists");
      }

      // Update the plugin name
      await this.drizzle
        .update(pluginConfigs)
        .set({
          name: trimmedName,
          updatedAt: sql`CURRENT_TIMESTAMP`
        })
        .where(sql`${pluginConfigs.id} = ${pluginId} AND ${pluginConfigs.userId} = ${userId}`);

      // Invalidate cache
      try {
        const { PluginManager } = await import('../plugins/manager.ts');
        const pm = new PluginManager(this.drizzle);
        pm.invalidate(userId);
      } catch {}

      return ApiResponse.json({ name: trimmedName });
    } catch (error) {
      console.error("Error updating plugin name:", error);
      return ApiResponse.error("Database error", 500, "Failed to update plugin name");
    }
  }

  // POST /plugin/{id}/image - Upload plugin icon
  async uploadPluginIcon(userId: number, id: string, request: Request, env: any, isAdmin: boolean = false): Promise<Response> {
    try {
      const pluginId = parseInt(id);
      if (isNaN(pluginId)) {
        return ApiResponse.error("Bad Request", 400, "Invalid plugin ID");
      }

      // Verify plugin exists and belongs to user
      const plugin = await this.drizzle
        .select({ id: pluginConfigs.id, modulePath: pluginConfigs.modulePath, icon: pluginConfigs.icon })
        .from(pluginConfigs)
        .where(sql`${pluginConfigs.id} = ${pluginId} AND ${pluginConfigs.userId} = ${userId}`)
        .get();

      if (!plugin) {
        return ApiResponse.error("Not Found", 404, "Plugin not found");
      }

      // Check permission for non-admin users
      if (!isAdmin) {
        const hasPermission = await this.hasPluginPermission(userId, plugin.modulePath);
        if (!hasPermission) {
          return ApiResponse.error("Forbidden", 403, "You don't have permission to modify this plugin");
        }
      }

      let fileBody: ArrayBuffer | ReadableStream | undefined;
      let fileContentType: string | undefined;

      const contentType = request.headers.get("content-type");

      // Handle multipart form data
      if (contentType && contentType.includes("multipart/form-data")) {
        const formData = await request.formData();
        const file = formData.get("file");

        if (!file || typeof file === "string") {
          return ApiResponse.error("Bad Request", 400, "No file provided in form data. Use field name 'file'.");
        }

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
      else if (contentType && contentType.startsWith("image/")) {
        fileBody = request.body!;
        fileContentType = contentType;
      }
      else {
        return ApiResponse.error("Bad Request", 400, "Content-Type must be multipart/form-data or image/*");
      }

      // Delete old icon from R2 if exists
      if (plugin.icon && env.R2) {
        const oldFilename = plugin.icon.replace("/api/v1/image/", "");
        if (oldFilename) {
          try {
            await env.R2.delete(oldFilename);
          } catch (e) {
            console.warn("Failed to delete old icon:", e);
          }
        }
      }

      // Generate unique filename
      const timestamp = Date.now();
      const filename = `plugin-images/${pluginId}-${timestamp}`;

      // Upload to R2
      const object = await env.R2.put(filename, fileBody, {
        httpMetadata: {
          contentType: fileContentType,
        },
      });

      if (!object) {
        return ApiResponse.error("Internal Server Error", 500, "Upload failed");
      }

      // Update plugin with icon URL
      const iconUrl = `/api/v1/image/${filename}`;
      await this.drizzle
        .update(pluginConfigs)
        .set({
          icon: iconUrl,
          updatedAt: sql`CURRENT_TIMESTAMP`
        })
        .where(sql`${pluginConfigs.id} = ${pluginId} AND ${pluginConfigs.userId} = ${userId}`);

      // Invalidate cache
      try {
        const { PluginManager } = await import('../plugins/manager.ts');
        const pm = new PluginManager(this.drizzle);
        pm.invalidate(userId);
      } catch {}

      return ApiResponse.json({ icon: iconUrl });

    } catch (error) {
      console.error("Error uploading plugin icon:", error);
      return ApiResponse.error("Upload failed", 500, error instanceof Error ? error.message : "Unknown error");
    }
  }

  // DELETE /plugin/{id}/image - Delete plugin icon
  async deletePluginIcon(userId: number, id: string, env: any, isAdmin: boolean = false): Promise<Response> {
    try {
      const pluginId = parseInt(id);
      if (isNaN(pluginId)) {
        return ApiResponse.error("Bad Request", 400, "Invalid plugin ID");
      }

      // Get current icon URL
      const plugin = await this.drizzle
        .select({ icon: pluginConfigs.icon, modulePath: pluginConfigs.modulePath })
        .from(pluginConfigs)
        .where(sql`${pluginConfigs.id} = ${pluginId} AND ${pluginConfigs.userId} = ${userId}`)
        .get();

      if (!plugin) {
        return ApiResponse.error("Not Found", 404, "Plugin not found");
      }

      // Check permission for non-admin users
      if (!isAdmin) {
        const hasPermission = await this.hasPluginPermission(userId, plugin.modulePath);
        if (!hasPermission) {
          return ApiResponse.error("Forbidden", 403, "You don't have permission to modify this plugin");
        }
      }

      const currentIcon = plugin.icon;
      if (!currentIcon) {
        return ApiResponse.error("Not Found", 404, "No icon to delete");
      }

      // Extract filename from URL
      const filename = currentIcon.replace("/api/v1/image/", "");

      // Delete from R2 if available
      if (env.R2 && filename) {
        await env.R2.delete(filename);
      }

      // Update plugin to remove icon reference
      await this.drizzle
        .update(pluginConfigs)
        .set({
          icon: null,
          updatedAt: sql`CURRENT_TIMESTAMP`
        })
        .where(sql`${pluginConfigs.id} = ${pluginId} AND ${pluginConfigs.userId} = ${userId}`);

      // Invalidate cache
      try {
        const { PluginManager } = await import('../plugins/manager.ts');
        const pm = new PluginManager(this.drizzle);
        pm.invalidate(userId);
      } catch {}

      return ApiResponse.json({});

    } catch (error) {
      console.error("Error deleting plugin icon:", error);
      return ApiResponse.error("Delete failed", 500, error instanceof Error ? error.message : "Unknown error");
    }
  }
}
