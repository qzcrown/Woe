import { PluginConf } from "../types/index.ts";
import { ApiResponse, safeJsonParse } from "../utils/response.ts";
import { DrizzleDB } from "../drizzle/index.ts";
import { pluginConfigs, pluginLogs } from "../models/index.ts";
import { eq, sql, desc } from "drizzle-orm";

export class PluginHandlers {
  constructor(private drizzle: DrizzleDB) {}

  // Helper to map DB result to PluginConf type
  private mapToPluginConf(row: any): PluginConf {
    return {
      id: row.id,
      name: row.name,
      token: row.token,
      modulePath: row.module_path,
      enabled: Boolean(row.enabled),
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
  async getAllPlugins(userId: number): Promise<Response> {
    try {
      await this.ensureDefaultPlugins(userId);
      
      const results = await this.drizzle
        .select({
          id: pluginConfigs.id,
          userId: pluginConfigs.userId,
          name: pluginConfigs.name,
          token: pluginConfigs.token,
          modulePath: pluginConfigs.modulePath,
          enabled: pluginConfigs.enabled,
          configYaml: pluginConfigs.configYaml
        })
        .from(pluginConfigs)
        .where(eq(pluginConfigs.userId, userId))
        .orderBy(pluginConfigs.id);

      const plugins = results.map(row => ({
        id: row.id,
        name: row.name,
        token: row.token,
        modulePath: row.modulePath,
        enabled: Boolean(row.enabled),
        capabilities: [],
        author: '',
        license: '',
        website: ''
      }));

      return ApiResponse.json(plugins);
    } catch (error) {
      console.error("Error retrieving plugins:", error);
      return ApiResponse.error("Database error", 500, "Failed to retrieve plugins");
    }
  }

  // GET /plugin/{id}/config - Get YAML configuration for Configurer plugin
  async getPluginConfig(userId: number, id: string): Promise<Response> {
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
  async updatePluginConfig(userId: number, id: string, request: Request): Promise<Response> {
    try {
      const pluginId = parseInt(id);
      if (isNaN(pluginId)) {
        return ApiResponse.error("Bad Request", 400, "Invalid plugin ID");
      }

      // Verify plugin exists and belongs to user
      const plugin = await this.drizzle
        .select({ id: pluginConfigs.id })
        .from(pluginConfigs)
        .where(sql`${pluginConfigs.id} = ${pluginId} AND ${pluginConfigs.userId} = ${userId}`)
        .get();

      if (!plugin) {
        return ApiResponse.error("Not Found", 404, "Plugin not found");
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
  async enablePlugin(userId: number, id: string): Promise<Response> {
    try {
      const pluginId = parseInt(id);
      if (isNaN(pluginId)) {
        return ApiResponse.error("Bad Request", 400, "Invalid plugin ID");
      }

      // Verify plugin exists and belongs to user, then enable it
      const result = await this.drizzle
        .update(pluginConfigs)
        .set({
          enabled: 1,
          updatedAt: sql`CURRENT_TIMESTAMP`
        })
        .where(sql`${pluginConfigs.id} = ${pluginId} AND ${pluginConfigs.userId} = ${userId}`);

      if (result.meta.changes === 0) {
        return ApiResponse.error("Not Found", 404, "Plugin not found or no permission");
      }

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
  async disablePlugin(userId: number, id: string): Promise<Response> {
    try {
      const pluginId = parseInt(id);
      if (isNaN(pluginId)) {
        return ApiResponse.error("Bad Request", 400, "Invalid plugin ID");
      }

      // Verify plugin exists and belongs to user, then disable it
      const result = await this.drizzle
        .update(pluginConfigs)
        .set({
          enabled: 0,
          updatedAt: sql`CURRENT_TIMESTAMP`
        })
        .where(sql`${pluginConfigs.id} = ${pluginId} AND ${pluginConfigs.userId} = ${userId}`);

      if (result.meta.changes === 0) {
        return ApiResponse.error("Not Found", 404, "Plugin not found or no permission");
      }

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
        const { parseYaml } = await import('../utils/yaml.ts')
        const config = parseYaml(pluginConfig.configYaml)
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
}
