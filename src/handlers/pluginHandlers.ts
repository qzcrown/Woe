





import { ApiResponse, parseJsonBody, formatDate } from "../utils/response.ts";
import { IMAGE_MAX_FILE_SIZE, validateImageFile, validateRawImageRequest } from "../utils/fileValidation.ts";
import { DrizzleDB } from "../drizzle/index.ts";
import { pluginConfigs, pluginLogs, userPluginPermissions } from "../models/index.ts";
import { eq, sql, desc, and, inArray } from "drizzle-orm";
import { BUILTIN_PLUGINS } from "../constants/builtinPlugins.ts";
import { ImageCompressionError, ImageCompressionService } from "../services/imageCompressionService.ts";
import { randomTokenString, TOKEN_RANDOM_LENGTH } from "../middleware/auth.ts";
import { normalizeMediaPath } from "../utils/mediaPath.ts";
import { getPluginSecretFields } from "../plugins/jobs/registry.ts";
import {
  WEBHOOKER_MODULE_PATH,
  resolveWebhookerConfig
} from "../plugins/builtin/webhooker/config.ts";
import { parse as parseYaml } from "yaml";
import { PluginSecretError, PluginSecretService } from "../services/pluginSecretService.ts";
import { safeErrorKind } from "../utils/safeError.ts";
import type { Env } from "../types/index.ts";


export class PluginHandlers {
  constructor(private drizzle: DrizzleDB, private env?: Env) {}





  private getSecretFields(modulePath: string): readonly string[] {
    return getPluginSecretFields(modulePath).filter(
      (path) => typeof path === "string" && path.length > 0
    );
  }






  private invalidConfigResponse(modulePath: string, configYaml: string): Response | null {
    let parser: ((raw: unknown) => { ok: boolean }) | null = null;
    let errorDescription = "";
    if (modulePath === WEBHOOKER_MODULE_PATH) {
      parser = resolveWebhookerConfig;
      errorDescription = "Invalid Webhooker config";
    }
    if (!parser) return null;

    let parsedConfig: unknown;
    try {
      parsedConfig = parseYaml(configYaml);
    } catch {
      parsedConfig = undefined;
    }
    if (parser(parsedConfig).ok) return null;
    return ApiResponse.json(
      {
        error: "Bad Request",
        errorCode: "config",
        errorDescription
      },
      400
    );
  }





  private mapPluginSecretError(error: unknown): Response | null {
    if (!(error instanceof PluginSecretError)) return null;

    switch (error.code) {
      case 'secret-config':
        return ApiResponse.json(
          { error: "Bad Request", errorCode: "secret-config", errorDescription: "Invalid plugin config" },
          400
        );
      case 'secret-reentry-required':
        return ApiResponse.json(
          { error: "Conflict", errorCode: "secret-reentry-required", errorDescription: "Secret must be re-entered" },
          409
        );
      case 'secret-decrypt-failed':
        return ApiResponse.json(
          { error: "Conflict", errorCode: "secret-decrypt-failed", errorDescription: "Stored secret cannot be decrypted" },
          409
        );
      case 'secret-key-unavailable':
        return ApiResponse.json(
          { error: "Service Unavailable", errorCode: "secret-key-unavailable", errorDescription: "Secret storage is unavailable" },
          503
        );
      default:
        return null;
    }
  }



  private async getUserPermittedPlugins(userId: number): Promise<Set<string>> {
    const permissions = await this.drizzle
      .select({ modulePath: userPluginPermissions.modulePath })
      .from(userPluginPermissions)
      .where(eq(userPluginPermissions.userId, userId));
    return new Set(permissions.map(p => p.modulePath));
  }



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


  private generatePluginToken(): string {
    return "P" + randomTokenString(TOKEN_RANDOM_LENGTH);
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



  async getAllPlugins(userId: number, isAdmin: boolean = false): Promise<Response> {
    try {

      const permittedPlugins = isAdmin ? null : await this.getUserPermittedPlugins(userId);
      const pluginMetadata = new Map(BUILTIN_PLUGINS.map((plugin) => [plugin.modulePath, plugin]));

      const results = await this.drizzle
        .select({
          id: pluginConfigs.id,
          userId: pluginConfigs.userId,
          name: pluginConfigs.name,
          token: pluginConfigs.token,
          modulePath: pluginConfigs.modulePath,
          enabled: pluginConfigs.enabled,
          icon: pluginConfigs.icon,
          configYaml: pluginConfigs.configYaml,
          createdAt: pluginConfigs.createdAt
        })
        .from(pluginConfigs)
        .where(eq(pluginConfigs.userId, userId))
        .orderBy(pluginConfigs.id);


      const filteredResults = isAdmin
        ? results
        : results.filter(r => permittedPlugins!.has(r.modulePath));

      const plugins = await Promise.all(
        filteredResults.map(async (row) => {
          const metadata = pluginMetadata.get(row.modulePath);
          const configExample = await this.getConfigExample(row.modulePath);
          return {
            id: row.id,
            name: row.name,
            token: row.token,
            modulePath: row.modulePath,
            enabled: Boolean(row.enabled),

            icon: row.icon ? normalizeMediaPath(row.icon) : row.icon,
            capabilities: metadata?.capabilities || [],
            author: metadata?.author || '',
            license: metadata?.license || '',
            website: metadata?.website || '',
            configExample: configExample,
            createdAt: formatDate(row.createdAt) ?? null
          };
        })
      );

      return ApiResponse.json(plugins);
    } catch (error) {
      console.error("Error retrieving plugins:", error);
      return ApiResponse.error("Database error", 500, "Failed to retrieve plugins");
    }
  }



  async getAvailablePlugins(): Promise<Response> {
    return ApiResponse.json(BUILTIN_PLUGINS);
  }



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


      if (!isAdmin) {
        const hasPermission = await this.hasPluginPermission(userId, result.modulePath);
        if (!hasPermission) {
          return ApiResponse.error("Forbidden", 403, "You don't have permission to access this plugin");
        }
      }


      let configYaml = result.configYaml || "";


      const secretFields = this.getSecretFields(result.modulePath);
      if (configYaml && secretFields.length > 0) {
        try {
          configYaml = await new PluginSecretService(this.env).maskConfigForRead({
            configYaml,
            secretFields
          });
        } catch (error) {
          const mapped = this.mapPluginSecretError(error);
          if (mapped) return mapped;
          throw error;
        }
      }


      if (!configYaml) {
        return new Response("", {
          status: 200,
          headers: {
            "Content-Type": "application/x-yaml"
          }
        });
      }


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



  async updatePluginConfig(userId: number, id: string, request: Request, isAdmin: boolean = false): Promise<Response> {
    try {
      const pluginId = parseInt(id);
      if (isNaN(pluginId)) {
        return ApiResponse.error("Bad Request", 400, "Invalid plugin ID");
      }


      const plugin = await this.drizzle
        .select({
          id: pluginConfigs.id,
          modulePath: pluginConfigs.modulePath,
          encryptedSecret: pluginConfigs.encryptedSecret
        })
        .from(pluginConfigs)
        .where(sql`${pluginConfigs.id} = ${pluginId} AND ${pluginConfigs.userId} = ${userId}`)
        .get();

      if (!plugin) {
        return ApiResponse.error("Not Found", 404, "Plugin not found");
      }


      if (!isAdmin) {
        const hasPermission = await this.hasPluginPermission(userId, plugin.modulePath);
        if (!hasPermission) {
          return ApiResponse.error("Forbidden", 403, "You don't have permission to configure this plugin");
        }
      }


      const contentType = request.headers.get("content-type");
      if (!contentType || !contentType.includes("application/x-yaml")) {
        return ApiResponse.error("Bad Request", 400, "Content-Type must be application/x-yaml");
      }


      const configYaml = await request.text();



      const invalidConfig = this.invalidConfigResponse(plugin.modulePath, configYaml);
      if (invalidConfig) return invalidConfig;



      const secretFields = this.getSecretFields(plugin.modulePath);

      if (secretFields.length > 0) {
        let prepared: { configYaml: string; encryptedSecret: string | null };
        try {
          prepared = await new PluginSecretService(this.env).processConfigForSave({
            pluginId,
            userId,
            configYaml,
            encryptedSecret: plugin.encryptedSecret ?? null,
            secretFields
          });
        } catch (error) {
          const mapped = this.mapPluginSecretError(error);
          if (mapped) return mapped;
          throw error;
        }


        await this.drizzle
          .update(pluginConfigs)
          .set({
            configYaml: prepared.configYaml,
            encryptedSecret: prepared.encryptedSecret,
            updatedAt: sql`CURRENT_TIMESTAMP`
          })
          .where(sql`${pluginConfigs.id} = ${pluginId} AND ${pluginConfigs.userId} = ${userId}`);
      } else {
        await this.drizzle
          .update(pluginConfigs)
          .set({
            configYaml,
            updatedAt: sql`CURRENT_TIMESTAMP`
          })
          .where(sql`${pluginConfigs.id} = ${pluginId} AND ${pluginConfigs.userId} = ${userId}`);
      }

      try {
        const { PluginManager } = await import('../plugins/manager.ts');
        const pm = new PluginManager(this.drizzle);
        pm.invalidate(userId);
      } catch {}
      return ApiResponse.json({});
    } catch (error) {


      console.error("Error updating plugin config:", safeErrorKind(error));
      return ApiResponse.error("Database error", 500, "Failed to update plugin config");
    }
  }



  async enablePlugin(userId: number, id: string, isAdmin: boolean = false): Promise<Response> {
    try {
      const pluginId = parseInt(id);
      if (isNaN(pluginId)) {
        return ApiResponse.error("Bad Request", 400, "Invalid plugin ID");
      }


      const plugin = await this.drizzle
        .select({ id: pluginConfigs.id, modulePath: pluginConfigs.modulePath })
        .from(pluginConfigs)
        .where(sql`${pluginConfigs.id} = ${pluginId} AND ${pluginConfigs.userId} = ${userId}`)
        .get();

      if (!plugin) {
        return ApiResponse.error("Not Found", 404, "Plugin not found or no permission");
      }


      if (!isAdmin) {
        const hasPermission = await this.hasPluginPermission(userId, plugin.modulePath);
        if (!hasPermission) {
          return ApiResponse.error("Forbidden", 403, "You don't have permission to enable this plugin");
        }
      }


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



  async disablePlugin(userId: number, id: string, isAdmin: boolean = false): Promise<Response> {
    try {
      const pluginId = parseInt(id);
      if (isNaN(pluginId)) {
        return ApiResponse.error("Bad Request", 400, "Invalid plugin ID");
      }


      const plugin = await this.drizzle
        .select({ id: pluginConfigs.id, modulePath: pluginConfigs.modulePath })
        .from(pluginConfigs)
        .where(sql`${pluginConfigs.id} = ${pluginId} AND ${pluginConfigs.userId} = ${userId}`)
        .get();

      if (!plugin) {
        return ApiResponse.error("Not Found", 404, "Plugin not found or no permission");
      }


      if (!isAdmin) {
        const hasPermission = await this.hasPluginPermission(userId, plugin.modulePath);
        if (!hasPermission) {
          return ApiResponse.error("Forbidden", 403, "You don't have permission to disable this plugin");
        }
      }


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
        return ApiResponse.error("Forbidden", 403, "Plugin is disabled");
      }

      try {
        const { parse } = await import('yaml')
        const config = pluginConfig.configYaml ? parse(pluginConfig.configYaml) as Record<string, any> : undefined
        const { resolve } = await import('../plugins/registry.ts')
        const plugin = resolve(pluginConfig.modulePath, pluginConfig.id, pluginConfig.name)
        if (!plugin || !plugin.renderDisplay) {
          return ApiResponse.json("")
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



  async createPlugin(adminUserId: number, request: Request): Promise<Response> {
    try {
      const parsed = await parseJsonBody<{
        modulePath?: string;
        name?: string;
        targetUserId?: number;
      }>(request);
      if (!parsed.ok) return parsed.response;
      const { modulePath, name, targetUserId } = parsed.data;

      if (!modulePath || !name) {
        return ApiResponse.error("Bad Request", 400, "modulePath and name are required");
      }


      const userId = targetUserId || adminUserId;


      try {
        const { resolve } = await import('../plugins/registry.ts');
        const plugin = resolve(modulePath, 0, '');
        if (!plugin) {
          return ApiResponse.error("Bad Request", 400, "Invalid modulePath");
        }
      } catch {
        return ApiResponse.error("Bad Request", 400, "Invalid modulePath");
      }


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
        .returning({ id: pluginConfigs.id, createdAt: pluginConfigs.createdAt });


      try {
        const { PluginManager } = await import('../plugins/manager.ts');
        const pm = new PluginManager(this.drizzle);
        pm.invalidate(userId);
      } catch {}

      return ApiResponse.json({
        id: result[0].id,
        name,
        token,
        modulePath,
        enabled: false,
        createdAt: formatDate(result[0].createdAt) ?? null
      });
    } catch (error) {
      console.error("Error creating plugin:", error);
      return ApiResponse.error("Database error", 500, "Failed to create plugin");
    }
  }



  async deletePlugin(id: string): Promise<Response> {
    try {
      const pluginId = parseInt(id);
      if (isNaN(pluginId)) {
        return ApiResponse.error("Bad Request", 400, "Invalid plugin ID");
      }


      const plugin = await this.drizzle
        .select({ id: pluginConfigs.id, userId: pluginConfigs.userId })
        .from(pluginConfigs)
        .where(eq(pluginConfigs.id, pluginId))
        .get();

      if (!plugin) {
        return ApiResponse.error("Not Found", 404, "Plugin not found");
      }


      await this.drizzle
        .delete(pluginConfigs)
        .where(eq(pluginConfigs.id, pluginId));


      try {
        const { PluginManager } = await import('../plugins/manager.ts');
        const pm = new PluginManager(this.drizzle);
        pm.invalidate(plugin.userId);
      } catch {}

      return ApiResponse.json({});
    } catch (error) {
      console.error("Error deleting plugin:", error);
      return ApiResponse.error("Database error", 500, "Failed to delete plugin");
    }
  }



  async updatePluginName(userId: number, id: string, request: Request, isAdmin: boolean = false): Promise<Response> {
    try {
      const pluginId = parseInt(id);
      if (isNaN(pluginId)) {
        return ApiResponse.error("Bad Request", 400, "Invalid plugin ID");
      }

      const parsed = await parseJsonBody<{ name?: string }>(request);
      if (!parsed.ok) return parsed.response;
      const { name } = parsed.data;

      if (!name || name.trim() === '') {
        return ApiResponse.error("Bad Request", 400, "Name is required");
      }

      const trimmedName = name.trim();


      const plugin = await this.drizzle
        .select({ id: pluginConfigs.id, modulePath: pluginConfigs.modulePath })
        .from(pluginConfigs)
        .where(sql`${pluginConfigs.id} = ${pluginId} AND ${pluginConfigs.userId} = ${userId}`)
        .get();

      if (!plugin) {
        return ApiResponse.error("Not Found", 404, "Plugin not found");
      }


      if (!isAdmin) {
        const hasPermission = await this.hasPluginPermission(userId, plugin.modulePath);
        if (!hasPermission) {
          return ApiResponse.error("Forbidden", 403, "You don't have permission to modify this plugin");
        }
      }


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


      await this.drizzle
        .update(pluginConfigs)
        .set({
          name: trimmedName,
          updatedAt: sql`CURRENT_TIMESTAMP`
        })
        .where(sql`${pluginConfigs.id} = ${pluginId} AND ${pluginConfigs.userId} = ${userId}`);


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



  async uploadPluginIcon(userId: number, id: string, request: Request, env: any, isAdmin: boolean = false): Promise<Response> {
    try {
      const pluginId = parseInt(id);
      if (isNaN(pluginId)) {
        return ApiResponse.error("Bad Request", 400, "Invalid plugin ID");
      }


      const plugin = await this.drizzle
        .select({ id: pluginConfigs.id, modulePath: pluginConfigs.modulePath, icon: pluginConfigs.icon })
        .from(pluginConfigs)
        .where(sql`${pluginConfigs.id} = ${pluginId} AND ${pluginConfigs.userId} = ${userId}`)
        .get();

      if (!plugin) {
        return ApiResponse.error("Not Found", 404, "Plugin not found");
      }


      if (!isAdmin) {
        const hasPermission = await this.hasPluginPermission(userId, plugin.modulePath);
        if (!hasPermission) {
          return ApiResponse.error("Forbidden", 403, "You don't have permission to modify this plugin");
        }
      }


      if (!env.R2) {
        return ApiResponse.error("Service Unavailable", 503, "R2 storage not configured");
      }

      let sourceBuffer: ArrayBuffer | undefined;

      let fileBody: ArrayBuffer | undefined;
      let fileContentType: string | undefined;

      const contentType = request.headers.get("content-type");


      if (contentType && contentType.includes("multipart/form-data")) {
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

      else if (contentType && contentType.toLowerCase().startsWith("image/")) {
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
        const compressed = await compressor.processImage(sourceBuffer!, fileContentType!);
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
      const filename = `plugin-images/${pluginId}-${timestamp}`;


      const object = await env.R2.put(filename, fileBody, {
        httpMetadata: {
          contentType: fileContentType,
        },
      });

      if (!object) {
        return ApiResponse.error("Internal Server Error", 500, "Upload failed");
      }


      const iconUrl = `/api/v1/image/${filename}`;
      await this.drizzle
        .update(pluginConfigs)
        .set({
          icon: iconUrl,
          updatedAt: sql`CURRENT_TIMESTAMP`
        })
        .where(sql`${pluginConfigs.id} = ${pluginId} AND ${pluginConfigs.userId} = ${userId}`);



      if (plugin.icon) {
        const oldFilename = plugin.icon.replace("/api/v1/image/", "");
        if (oldFilename && oldFilename !== filename) {
          try {
            await env.R2.delete(oldFilename);
          } catch (e) {
            console.warn("Failed to delete old icon:", e);
          }
        }
      }


      try {
        const { PluginManager } = await import('../plugins/manager.ts');
        const pm = new PluginManager(this.drizzle);
        pm.invalidate(userId);
      } catch {}


      return ApiResponse.json({ icon: normalizeMediaPath(iconUrl) });

    } catch (error) {
      console.error("Error uploading plugin icon:", error);
      return ApiResponse.error("Upload failed", 500, "Icon upload failed");
    }
  }



  async deletePluginIcon(userId: number, id: string, env: any, isAdmin: boolean = false): Promise<Response> {
    try {
      const pluginId = parseInt(id);
      if (isNaN(pluginId)) {
        return ApiResponse.error("Bad Request", 400, "Invalid plugin ID");
      }


      const plugin = await this.drizzle
        .select({ icon: pluginConfigs.icon, modulePath: pluginConfigs.modulePath })
        .from(pluginConfigs)
        .where(sql`${pluginConfigs.id} = ${pluginId} AND ${pluginConfigs.userId} = ${userId}`)
        .get();

      if (!plugin) {
        return ApiResponse.error("Not Found", 404, "Plugin not found");
      }


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


      const filename = currentIcon.replace("/api/v1/image/", "");


      if (env.R2 && filename) {
        await env.R2.delete(filename);
      }


      await this.drizzle
        .update(pluginConfigs)
        .set({
          icon: null,
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
      console.error("Error deleting plugin icon:", error);
      return ApiResponse.error("Delete failed", 500, "Icon deletion failed");
    }
  }
}
