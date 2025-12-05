import { PluginConf } from "../types/index.ts";
import { ApiResponse, safeJsonParse } from "../utils/response.ts";

export class PluginHandlers {
  constructor(private db: D1Database) {}

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
    const existingRes = await this.db.prepare(`
      SELECT module_path
      FROM plugin_configs
      WHERE user_id = ?
    `).bind(userId).all();

    const existing = new Set((existingRes.results || []).map((r: any) => r.module_path as string));

    const builtins = [
      { modulePath: 'builtin/webhooker', name: 'Webhooker', capabilities: ['webhooker', 'messenger'] },
      { modulePath: 'builtin/displayer', name: 'Displayer', capabilities: ['displayer'] }
    ];

    for (const b of builtins) {
      if (!existing.has(b.modulePath)) {
        const token = this.generatePluginToken();
        await this.db.prepare(`
          INSERT INTO plugin_configs (user_id, name, token, module_path, enabled, config_yaml, capabilities, author, license, website)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).bind(userId, b.name, token, b.modulePath, 0, '', JSON.stringify(b.capabilities), 'Woe', 'MIT', null).run();
      }
    }
  }

  // GET /plugin - Return all plugins for the authenticated user
  async getAllPlugins(userId: number): Promise<Response> {
    try {
      await this.ensureDefaultPlugins(userId);
      const result = await this.db.prepare(`
        SELECT id, user_id as userId, name, token, module_path as modulePath,
               enabled, capabilities, author, license, website
        FROM plugin_configs
        WHERE user_id = ?
        ORDER BY id
      `).bind(userId).all();

      const plugins = result.results.map(row => this.mapToPluginConf(row));

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

      const result = await this.db.prepare(`
        SELECT config_yaml, module_path
        FROM plugin_configs
        WHERE id = ? AND user_id = ?
      `).bind(pluginId, userId).first();

      if (!result) {
        return ApiResponse.error("Not Found", 404, "Plugin not found");
      }

      // Return YAML config as plain text if it exists, otherwise return empty string
      const configYaml = (result.config_yaml as string) || "";

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
      return new Response(configYaml as string, {
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

      const result = await this.db.prepare(`
        SELECT id, event, status, duration_ms as durationMs, error, created_at as createdAt
        FROM plugin_logs
        WHERE plugin_id = ? AND user_id = ?
        ORDER BY id DESC
        LIMIT ?
      `).bind(pluginId, userId, Math.min(Math.max(limit, 1), 200)).all()

      return ApiResponse.json(result.results || [])
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
      const plugin = await this.db.prepare(`
        SELECT id FROM plugin_configs WHERE id = ? AND user_id = ?
      `).bind(pluginId, userId).first();

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
      await this.db.prepare(`
        UPDATE plugin_configs
        SET config_yaml = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND user_id = ?
      `).bind(configYaml, pluginId, userId).run();

      try {
        const { PluginManager } = await import('../plugins/manager.ts')
        const pm = new PluginManager(this.db)
        pm.invalidate(userId)
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
      const result = await this.db.prepare(`
        UPDATE plugin_configs
        SET enabled = 1, updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND user_id = ?
      `).bind(pluginId, userId).run();

      if (result.meta.changes === 0) {
        return ApiResponse.error("Not Found", 404, "Plugin not found or no permission");
      }

      try {
        const { PluginManager } = await import('../plugins/manager.ts')
        const pm = new PluginManager(this.db)
        pm.invalidate(userId)
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
      const result = await this.db.prepare(`
        UPDATE plugin_configs
        SET enabled = 0, updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND user_id = ?
      `).bind(pluginId, userId).run();

      if (result.meta.changes === 0) {
        return ApiResponse.error("Not Found", 404, "Plugin not found or no permission");
      }

      try {
        const { PluginManager } = await import('../plugins/manager.ts')
        const pm = new PluginManager(this.db)
        pm.invalidate(userId)
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

      const result = await this.db.prepare(`
        SELECT id, name, module_path, enabled, config_yaml
        FROM plugin_configs
        WHERE id = ? AND user_id = ?
      `).bind(pluginId, userId).first();

      if (!result) {
        return ApiResponse.error("Not Found", 404, "Plugin not found");
      }

      if (!Boolean((result as any).enabled)) {
        return ApiResponse.json({})
      }

      try {
        const { parseYaml } = await import('../utils/yaml.ts')
        const config = parseYaml((result as any).config_yaml)
        const { resolve } = await import('../plugins/registry.ts')
        const plugin = resolve((result as any).module_path, (result as any).id, (result as any).name)
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
