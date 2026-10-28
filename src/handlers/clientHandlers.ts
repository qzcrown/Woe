




import { generateEnhancedToken } from "../utils/enhancedToken.ts";
import { Client } from "../types/index.ts";
import { ApiResponse, formatDate } from "../utils/response.ts";
import { DrizzleDB } from "../drizzle/index.ts";
import { clients, pushOutbox } from "../models/index.ts";
import { eq, sql } from "drizzle-orm";
import type { D1Database } from "@cloudflare/workers-types";
import {
  computeExpiresAt,
  normalizeExpiresAfterInactivitySeconds,
  refreshClientActivityById,
  EXPIRES_AFTER_INACTIVITY_MAX_SECONDS
} from "../services/clientExpiry.ts";
import { DECLARED_PUSH_PLATFORMS } from "../services/push/platforms.ts";


type ClientPlatform = string;
type PushState = "active" | "inactive";
type ClientTokenStatus = PushState | "invalid" | "expired";






const CORE_CLIENT_PLATFORMS: readonly string[] = ["web", "unknown"];


const ELEVATION_MAX_DURATION_SECONDS = 86_400 * 365;

interface CreateClientInput {
  name: string;
  platform?: ClientPlatform;
  deviceUid?: string;
  deviceToken?: string;
  appVersion?: string;
  deviceModel?: string;
  expiresAfterInactivitySeconds?: number;
}







export type LogoutClientResult =
  | { ok: true; revoked: boolean }
  | { ok: false; response: Response };


export class ClientHandlers {
  constructor(
    private drizzle: DrizzleDB,
    private rawDb?: D1Database,

    private readonly declaredPushPlatforms: readonly string[] = DECLARED_PUSH_PLATFORMS
  ) {}




  private mapToClient(row: any, exposeToken = false): Client {



    let elevatedUntil = formatDate(row.elevatedUntil) || row.elevatedUntil || null;
    if (elevatedUntil !== null && !(new Date(elevatedUntil).getTime() > Date.now())) {
      elevatedUntil = null;
    }
    const client: Client = {
      id: row.id,
      token: exposeToken ? row.token : "",
      name: row.name,
      platform: (row.platform || "unknown") as ClientPlatform,
      deviceUid: row.deviceUid || null,
      deviceToken: row.deviceToken || null,
      tokenUpdatedAt: formatDate(row.tokenUpdatedAt) || row.tokenUpdatedAt || null,
      tokenStatus: (row.tokenStatus || "active") as ClientTokenStatus,
      appVersion: row.appVersion || null,
      deviceModel: row.deviceModel || null,
      lastUsed: formatDate(row.lastUsed) || null,
      elevatedUntil,
      expiresAfterInactivitySeconds: row.expiresAfterInactivitySeconds ?? 0,
      createdAt: formatDate(row.createdAt) ?? null
    };

    const expiresAt = formatDate(row.expiresAt);
    if (expiresAt) {
      client.expiresAt = expiresAt;
    }
    return client;
  }

  private getClientSelectFields() {
    return {
      id: clients.id,
      userId: clients.userId,
      token: clients.token,
      name: clients.name,
      platform: clients.platform,
      deviceUid: clients.deviceUid,
      deviceToken: clients.deviceToken,
      tokenUpdatedAt: clients.tokenUpdatedAt,
      tokenStatus: clients.tokenStatus,
      appVersion: clients.appVersion,
      deviceModel: clients.deviceModel,
      lastUsed: clients.lastUsed,
      elevatedUntil: clients.elevatedUntil,
      expiresAfterInactivitySeconds: clients.expiresAfterInactivitySeconds,
      expiresAt: clients.expiresAt,
      createdAt: clients.createdAt
    };
  }










  private validateNewPlatform(platform: unknown): { ok: true; platform: ClientPlatform } | { ok: false; response: Response } {
    if (platform === undefined) {
      return { ok: true, platform: "unknown" };
    }
    if (typeof platform !== "string" || platform.trim() === "") {
      return { ok: false, response: ApiResponse.error("Bad Request", 400, "platform must be a non-empty string") };
    }
    const candidate = platform.trim();
    const declared =
      this.declaredPushPlatforms.includes(candidate) || CORE_CLIENT_PLATFORMS.includes(candidate);
    if (!declared) {
      return {
        ok: false,
        response: ApiResponse.error(
          "Conflict",
          409,
          "platform is not declared by any push plugin (plugin-unavailable)"
        )
      };
    }
    return { ok: true, platform: candidate };
  }

  private normalizePushState(state?: string): PushState | null {
    if (state === "active" || state === "inactive") {
      return state;
    }
    return null;
  }



  async updateLastUsed(clientId: number): Promise<void> {
    await refreshClientActivityById(this.drizzle, clientId);
  }



  async getAllClients(userId: number): Promise<Response> {
    try {
      const clientsList = await this.drizzle
        .select(this.getClientSelectFields())
        .from(clients)
        .where(eq(clients.userId, userId))
        .orderBy(clients.id);

      const mappedClients = clientsList.map(row => this.mapToClient(row));

      return ApiResponse.json(mappedClients);
    } catch (error) {
      return ApiResponse.error("Database error", 500, "Failed to retrieve clients");
    }
  }



  async createClient(userId: number, input: string | CreateClientInput): Promise<Response> {
    try {
      const body: CreateClientInput = typeof input === "string" ? { name: input } : input;
      const name = body?.name?.trim();
      if (!name) {
        return ApiResponse.error("Bad Request", 400, "Client name is required");
      }

      const platformResult = this.validateNewPlatform(body.platform);
      if (!platformResult.ok) {
        return platformResult.response;
      }
      const platform = platformResult.platform;
      const deviceUid = body.deviceUid?.trim();
      const deviceToken = body.deviceToken?.trim();
      const appVersion = body.appVersion?.trim();
      const deviceModel = body.deviceModel?.trim();


      let expiresAfterInactivitySeconds = 0;
      if (body.expiresAfterInactivitySeconds !== undefined && body.expiresAfterInactivitySeconds !== null) {
        const normalized = normalizeExpiresAfterInactivitySeconds(body.expiresAfterInactivitySeconds);
        if (normalized === null) {
          return ApiResponse.error(
            "Bad Request",
            400,
            `expiresAfterInactivitySeconds must be a non-negative integer no greater than ${EXPIRES_AFTER_INACTIVITY_MAX_SECONDS} seconds`
          );
        }
        expiresAfterInactivitySeconds = normalized;
      }

      const expiresAt = expiresAfterInactivitySeconds > 0
        ? new Date(Date.now() + expiresAfterInactivitySeconds * 1000).toISOString()
        : null;

      const { publicForm, privateForm } = generateEnhancedToken("client");
      const now = new Date().toISOString();

      let result: any[] = [];

      if (this.rawDb && deviceUid && deviceToken) {
        const upsert = this.rawDb.prepare(`
          INSERT INTO clients (user_id, token, name, platform, device_uid, device_token, token_updated_at, token_status, app_version, device_model, expires_after_inactivity_seconds, expires_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?)
          ON CONFLICT(user_id, device_uid) DO UPDATE SET
            token = excluded.token,
            platform = excluded.platform,
            device_token = excluded.device_token,
            token_updated_at = excluded.token_updated_at,
            token_status = 'active',
            app_version = excluded.app_version,
            device_model = excluded.device_model,
            expires_after_inactivity_seconds = excluded.expires_after_inactivity_seconds,
            expires_at = excluded.expires_at
          RETURNING id, user_id, token, name, platform, device_uid, device_token, token_updated_at, token_status, app_version, device_model, last_used, elevated_until, expires_after_inactivity_seconds, expires_at, created_at
        `).bind(userId, publicForm, name, platform, deviceUid, deviceToken, now, appVersion || null, deviceModel || null, expiresAfterInactivitySeconds, expiresAt);
        const results = await this.rawDb.batch([
          this.rawDb.prepare(`UPDATE clients SET token_status = 'inactive', device_token = NULL WHERE device_token = ? AND token_status = 'active' AND NOT (user_id = ? AND device_uid IS ?)`).bind(deviceToken, userId, deviceUid),
          upsert
        ]);
        const row = (results[1]?.results?.[0] || {}) as Record<string, unknown>;
        result = [{
          id: row.id,
          userId: row.user_id,
          token: row.token,
          name: row.name,
          platform: row.platform,
          deviceUid: row.device_uid,
          deviceToken: row.device_token,
          tokenUpdatedAt: row.token_updated_at,
          tokenStatus: row.token_status,
          appVersion: row.app_version,
          deviceModel: row.device_model,
          lastUsed: row.last_used,
          elevatedUntil: row.elevated_until,
          expiresAfterInactivitySeconds: row.expires_after_inactivity_seconds,
          expiresAt: row.expires_at,
          createdAt: row.created_at
        }];
      }



      if (deviceToken && deviceUid && result.length === 0) {
        await this.drizzle.update(clients).set({ tokenStatus: 'inactive', deviceToken: null })
          .where(sql`${clients.deviceToken} = ${deviceToken} AND ${clients.tokenStatus} = 'active' AND NOT (${clients.userId} = ${userId} AND ${clients.deviceUid} IS ${deviceUid})`);
      }

      if (deviceUid && result.length === 0) {





        const conflictSet: Record<string, any> = {
          token: publicForm,
          platform,
          appVersion: appVersion || null,
          deviceModel: deviceModel || null,



          expiresAfterInactivitySeconds,
          expiresAt,
          ...(deviceToken
            ? {
                deviceToken,
                tokenUpdatedAt: now,
                tokenStatus: 'active'
              }
            : {
                tokenStatus: sql`CASE WHEN ${clients.tokenStatus} = 'inactive' THEN 'inactive' WHEN ${clients.tokenStatus} IN ('invalid', 'expired') THEN ${clients.tokenStatus} ELSE 'active' END`
              })
        };

        result = await this.drizzle
          .insert(clients)
          .values({
            userId,
            token: publicForm,
            name,
            platform,
            deviceUid,
            deviceToken: deviceToken || null,
            tokenUpdatedAt: deviceToken ? now : null,
            tokenStatus: "active",
            appVersion: appVersion || null,
            deviceModel: deviceModel || null,
            expiresAfterInactivitySeconds,
            expiresAt
          })
          .onConflictDoUpdate({
            target: [clients.userId, clients.deviceUid],
            set: conflictSet
          })
          .returning(this.getClientSelectFields());
      } else if (!deviceUid) {
        result = await this.drizzle
          .insert(clients)
          .values({
            userId,
            token: publicForm,
            name,
            platform,
            expiresAfterInactivitySeconds,
            expiresAt
          })
          .returning(this.getClientSelectFields());
      }

      if (!result || result.length === 0) {
        return ApiResponse.error("Client creation failed", 400, "Could not create client");
      }

      const client: Client = this.mapToClient(result[0], true);

      client.token = privateForm;

      try {
        const { PluginManager } = await import('../plugins/manager.ts')
        const pm = new PluginManager(this.drizzle)
        await pm.emit(userId, 'client.create', {
          userId,
          now: new Date().toISOString(),
          client: { id: client.id, name: client.name }
        })
      } catch {}
      return ApiResponse.json(client);
    } catch (error) {
      return ApiResponse.error("Database error", 500, "Failed to create client");
    }
  }



  async getClient(userId: number, id: string): Promise<Response> {
    try {
      const clientId = parseInt(id);

      const result = await this.drizzle
        .select(this.getClientSelectFields())
        .from(clients)
        .where(sql`${clients.id} = ${clientId} AND ${clients.userId} = ${userId}`)
        .get();

      if (!result) {
        return ApiResponse.error("Not Found", 404, "Client not found");
      }

      return ApiResponse.json(this.mapToClient(result));
    } catch (error) {
      return ApiResponse.error("Database error", 500, "Failed to retrieve client");
    }
  }

  async updatePushState(userId: number, id: string, state?: string): Promise<Response> {
    try {
      const clientId = parseInt(id);
      if (Number.isNaN(clientId)) {
        return ApiResponse.error("Bad Request", 400, "Invalid client ID");
      }

      const nextState = this.normalizePushState(state);
      if (!nextState) {
        return ApiResponse.error("Bad Request", 400, "state must be active or inactive");
      }

      const existingClient = await this.drizzle
        .select(this.getClientSelectFields())
        .from(clients)
        .where(sql`${clients.id} = ${clientId} AND ${clients.userId} = ${userId}`)
        .get();

      if (!existingClient) {
        return ApiResponse.error("Not Found", 404, "Client not found");
      }

      if (nextState === "active" && !existingClient.deviceToken) {
        return ApiResponse.error("Conflict", 409, "Client has no device token");
      }

      const result = await this.drizzle
        .update(clients)
        .set({ tokenStatus: nextState })
        .where(sql`${clients.id} = ${clientId} AND ${clients.userId} = ${userId}`)
        .returning(this.getClientSelectFields());

      if (!result || result.length === 0) {
        return ApiResponse.error("Not Found", 404, "Client not found or update failed");
      }

      return ApiResponse.json(this.mapToClient(result[0], true));
    } catch (error) {
      return ApiResponse.error("Database error", 500, "Failed to update client push state");
    }
  }




  async updateClient(userId: number, id: string, body: unknown): Promise<Response> {
    try {
      const clientId = parseInt(id);
      if (Number.isNaN(clientId)) {
        return ApiResponse.error("Bad Request", 400, "Invalid client ID");
      }


      if (typeof body !== "object" || body === null || Array.isArray(body)) {
        return ApiResponse.error("Bad Request", 400, "Invalid JSON body");
      }
      const record = body as Record<string, unknown>;



      if (typeof record.name !== "string" || record.name === "") {
        return ApiResponse.error("Bad Request", 400, "Client name is required");
      }



      let deviceUid: string | null | undefined;
      if ("deviceUid" in record) {
        const raw = record.deviceUid;
        if (raw === null) {
          deviceUid = null;
        } else if (typeof raw === "string") {
          const trimmed = raw.trim();
          if (!trimmed) {
            return ApiResponse.error("Bad Request", 400, "deviceUid must be a non-empty string or null");
          }
          deviceUid = trimmed;
        } else {
          return ApiResponse.error("Bad Request", 400, "deviceUid must be a non-empty string or null");
        }
      }

      let deviceToken: string | null | undefined;
      if ("deviceToken" in record) {
        const raw = record.deviceToken;
        if (raw === null) {
          deviceToken = null;
        } else if (typeof raw === "string") {
          const trimmed = raw.trim();
          if (!trimmed) {
            return ApiResponse.error("Bad Request", 400, "deviceToken must be a non-empty string or null");
          }
          deviceToken = trimmed;
        } else {
          return ApiResponse.error("Bad Request", 400, "deviceToken must be a non-empty string or null");
        }
      }



      let expiresAfterInactivitySeconds: number | undefined;
      if ("expiresAfterInactivitySeconds" in record) {
        const raw = record.expiresAfterInactivitySeconds;
        if (raw === null) {
          expiresAfterInactivitySeconds = 0;
        } else {
          const normalized = normalizeExpiresAfterInactivitySeconds(raw);
          if (normalized === null) {
            return ApiResponse.error(
              "Bad Request",
              400,
              `expiresAfterInactivitySeconds must be a non-negative integer no greater than ${EXPIRES_AFTER_INACTIVITY_MAX_SECONDS} seconds`
            );
          }
          expiresAfterInactivitySeconds = normalized;
        }
      }



      const setPayload: Record<string, any> = { name: record.name };
      if (deviceUid !== undefined) {
        setPayload.deviceUid = deviceUid;
      }
      if (deviceToken !== undefined) {
        if (deviceToken === null) {

          setPayload.deviceToken = null;
          setPayload.tokenUpdatedAt = null;
        } else {
          setPayload.deviceToken = deviceToken;
          setPayload.tokenUpdatedAt = new Date().toISOString();


          setPayload.tokenStatus = sql`CASE WHEN ${clients.tokenStatus} = 'inactive' THEN 'inactive' ELSE 'active' END`;
        }
      }

      if (expiresAfterInactivitySeconds !== undefined) {

        const existing = await this.drizzle
          .select({ lastUsed: clients.lastUsed, createdAt: clients.createdAt })
          .from(clients)
          .where(sql`${clients.id} = ${clientId} AND ${clients.userId} = ${userId}`)
          .get();
        if (!existing) {
          return ApiResponse.error("Not Found", 404, "Client not found");
        }
        setPayload.expiresAfterInactivitySeconds = expiresAfterInactivitySeconds;

        setPayload.expiresAt =
          computeExpiresAt(existing, expiresAfterInactivitySeconds) ??
          (expiresAfterInactivitySeconds > 0
            ? new Date(Date.now() + expiresAfterInactivitySeconds * 1000).toISOString()
            : null);
      }

      const result = await this.drizzle
        .update(clients)
        .set(setPayload)
        .where(sql`${clients.id} = ${clientId} AND ${clients.userId} = ${userId}`)
        .returning(this.getClientSelectFields());

      if (!result || result.length === 0) {
        return ApiResponse.error("Not Found", 404, "Client not found");
      }

      return ApiResponse.json(this.mapToClient(result[0], true));
    } catch (error) {



      if (this.isDeviceUidUniqueViolation(error)) {
        return ApiResponse.error("Conflict", 409, "deviceUid is already registered to another client of this user");
      }
      return ApiResponse.error("Database error", 500, "Failed to update client");
    }
  }






  private isDeviceUidUniqueViolation(error: unknown): boolean {
    const seen = new Set<unknown>();
    let current: unknown = error;
    while (typeof current === "object" && current !== null && !seen.has(current)) {
      seen.add(current);
      const message = (current as { message?: unknown }).message;
      if (
        typeof message === "string" &&
        message.includes("UNIQUE constraint failed") &&
        message.includes("clients.user_id") &&
        message.includes("clients.device_uid")
      ) {
        return true;
      }
      current = (current as { cause?: unknown }).cause;
    }
    return false;
  }



  async deleteClient(userId: number, id: string): Promise<Response> {
    try {
      const clientId = parseInt(id);

      const result = await this.drizzle
        .delete(clients)
        .where(sql`${clients.id} = ${clientId} AND ${clients.userId} = ${userId}`);

      if (result.meta.changes === 0) {
        return ApiResponse.error("Not Found", 404, "Client not found");
      }

      return ApiResponse.json({});
    } catch (error) {
      return ApiResponse.error("Database error", 500, "Failed to delete client");
    }
  }


  async deactivateClient(userId: number, id: string): Promise<Response> {
    try {
      const clientId = parseInt(id);
      await this.drizzle.update(clients).set({ tokenStatus: 'inactive', deviceToken: null })
        .where(sql`${clients.id} = ${clientId} AND ${clients.userId} = ${userId}`);


      await this.drizzle.update(pushOutbox).set({ status: 'dead', lastError: 'Client deactivated' })
        .where(sql`${pushOutbox.clientId} = ${clientId} AND ${pushOutbox.userId} = ${userId} AND ${pushOutbox.status} IN ('pending', 'processing')`);
      return ApiResponse.json({});
    } catch (error) {
      return ApiResponse.error('Database error', 500, 'Failed to deactivate client');
    }
  }




















  async logoutClient(userId: number, clientId: number, expectedToken: string): Promise<LogoutClientResult> {
    if (!this.rawDb) {
      return { ok: false, response: ApiResponse.error("Database error", 500, "Failed to logout") };
    }
    const updatedAt = new Date().toISOString();
    try {
      const results: unknown = await this.rawDb.batch([

        this.rawDb.prepare(`
          UPDATE push_outbox
          SET status = 'dead', last_error = 'Client logged out', updated_at = ?
          WHERE user_id = ? AND client_id = ?
            AND status IN ('pending', 'processing')
            AND EXISTS (
              SELECT 1 FROM clients
              WHERE id = ? AND user_id = ? AND token = ?
            )
        `).bind(updatedAt, userId, clientId, clientId, userId, expectedToken),

        this.rawDb.prepare(`
          DELETE FROM clients
          WHERE id = ? AND user_id = ? AND token = ?
          RETURNING id
        `).bind(clientId, userId, expectedToken)
      ]);


      if (!Array.isArray(results) || results.length < 2) {
        return { ok: false, response: ApiResponse.error("Database error", 500, "Failed to logout") };
      }
      const isD1Result = (value: unknown): value is { success: true; results: unknown[] } =>
        typeof value === "object" &&
        value !== null &&
        (value as { success?: unknown }).success === true &&
        Array.isArray((value as { results?: unknown }).results);
      const [outboxResult, deleteResult] = results;
      if (!isD1Result(outboxResult) || !isD1Result(deleteResult)) {
        return { ok: false, response: ApiResponse.error("Database error", 500, "Failed to logout") };
      }

      const revoked = deleteResult.results.some(
        (row) =>
          typeof row === "object" &&
          row !== null &&
          Number((row as { id?: unknown }).id) === clientId
      );
      return { ok: true, revoked };
    } catch (error) {

      console.error(
        "logoutClient: D1 batch failed:",
        error instanceof Error ? error.message : "non-error failure"
      );
      return { ok: false, response: ApiResponse.error("Database error", 500, "Failed to logout") };
    }
  }


  async elevateClient(userId: number, id: string, durationSeconds: number): Promise<Response> {
    try {
      if (!Number.isSafeInteger(durationSeconds) || durationSeconds <= 0) {
        return ApiResponse.error("Bad Request", 400, "durationSeconds must be a positive integer");
      }

      if (durationSeconds > ELEVATION_MAX_DURATION_SECONDS) {
        return ApiResponse.error(
          "Bad Request",
          400,
          "durationSeconds must be a positive integer no greater than one year"
        );
      }
      const clientId = parseInt(id);

      const existing = await this.drizzle
        .select(this.getClientSelectFields())
        .from(clients)
        .where(sql`${clients.id} = ${clientId} AND ${clients.userId} = ${userId}`)
        .get();
      if (!existing) {
        return ApiResponse.error("Not Found", 404, "Client not found");
      }

      const elevatedUntil = new Date(Date.now() + durationSeconds * 1000).toISOString();
      await this.drizzle
        .update(clients)
        .set({ elevatedUntil })
        .where(sql`${clients.id} = ${clientId} AND ${clients.userId} = ${userId}`);

      return new Response(null, { status: 204 });
    } catch (error) {
      console.error("Error elevating client:", error);
      return ApiResponse.error("Database error", 500, "Failed to elevate client");
    }
  }
}
