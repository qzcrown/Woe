




import { DrizzleDB } from "../../drizzle/index.ts";
import { clients, pushOutbox } from "../../models/index.ts";
import { and, eq, sql } from "drizzle-orm";
import type { ProviderResolver, PushPlatform } from "./contracts.ts";
import { ENQUEUE_WRITE_GATE_KEY, ENQUEUE_WRITE_GATE_PAUSED } from "../writeGateService.ts";


type WriteResult = { meta?: { changes?: number }; changes?: number };


const affectedRows = (r: WriteResult | undefined | null): number => r?.meta?.changes ?? r?.changes ?? 0;


export interface PushOutboxJob {
  id: number;
  userId: number;
  messageId: number;

  platform: PushPlatform;
  clientId: number | null;
  payloadJson: string;
  status: "pending" | "processing" | "success" | "failed" | "dead";
  attemptCount: number;
  nextRetryAt: string | null;
  lastError: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}


export interface EnqueuePushOutboxInput {
  userId: number;
  messageId: number;
  platform: PushPlatform;
  clientId?: number;
  payloadJson: string;
}


export interface EnqueueForUserDevicesInput {
  userId: number;
  messageId: number;
  appid: number;
  date: string;
  platform: PushPlatform;
  title?: string;
  message: string;
  priority?: number;
  extras?: Record<string, any>;
}








export type EnqueueForUserDevicesResult =
  | { status: "accepted"; count: number; outboxIds: number[] }
  | { status: "unavailable"; reason: "disabled" | "init-failed" | "unregistered" };










export type PushTargetLookup =
  | { kind: "deleted"; clientId: number }
  | {
      kind: "ready" | "inactive" | "no-token";
      clientId: number;

      platform: PushPlatform;
      deviceToken: string | null;
      tokenUpdatedAt: string | null;
      tokenStatus: string;
    };


export class PushOutboxService {
  constructor(private drizzle: DrizzleDB) {}

  private getSelectFields() {
    return {
      id: pushOutbox.id,
      userId: pushOutbox.userId,
      messageId: pushOutbox.messageId,
      platform: pushOutbox.platform,
      clientId: pushOutbox.clientId,
      payloadJson: pushOutbox.payloadJson,
      status: pushOutbox.status,
      attemptCount: pushOutbox.attemptCount,
      nextRetryAt: pushOutbox.nextRetryAt,
      lastError: pushOutbox.lastError,
      createdAt: pushOutbox.createdAt,
      updatedAt: pushOutbox.updatedAt
    };
  }


  async enqueue(input: EnqueuePushOutboxInput): Promise<number | null> {
    const result = await this.drizzle
      .insert(pushOutbox)
      .values({
        userId: input.userId,
        messageId: input.messageId,
        platform: input.platform,
        clientId: input.clientId || null,
        payloadJson: input.payloadJson,
        status: "pending",
        attemptCount: 0
      })
      .returning({ id: pushOutbox.id });

    return result?.[0]?.id ?? null;
  }








  async enqueueForUserDevices(
    input: EnqueueForUserDevicesInput,
    providers: ProviderResolver
  ): Promise<EnqueueForUserDevicesResult> {
    const resolution = providers.resolve(input.platform);
    if (resolution.status !== "ready") {
      return { status: "unavailable", reason: resolution.status };
    }

    const targetClients = await this.drizzle
      .select({
        id: clients.id,
        deviceToken: clients.deviceToken
      })
      .from(clients)
      .where(
        sql`${clients.userId} = ${input.userId}
            AND ${clients.platform} = ${input.platform}
            AND ${clients.tokenStatus} = 'active'
            AND ${clients.deviceToken} IS NOT NULL
            AND ${clients.deviceToken} != ''`
      );

    if (!targetClients.length) {
      return { status: "accepted", count: 0, outboxIds: [] };
    }

    const values = targetClients.map((target) => ({
      userId: input.userId,
      messageId: input.messageId,
      platform: input.platform,
      clientId: target.id,


      payloadJson: JSON.stringify({
        userId: input.userId,
        platform: input.platform,
        title: input.title || "",
        message: input.message,
        priority: input.priority ?? 0,
        extras: input.extras || {},
        messageId: input.messageId,
        appid: input.appid,
        date: input.date
      }),

    }));














    const selects = sql.join(
      values.map(
        (v) => sql`SELECT ${v.userId} AS user_id, ${v.messageId} AS message_id, ${v.platform} AS platform, ${v.clientId} AS client_id, ${v.payloadJson} AS payload_json, 'pending' AS status, 0 AS attempt_count`
      ),
      sql` UNION ALL `
    );
    const inserted = (await this.drizzle.all(sql`INSERT INTO push_outbox (user_id, message_id, platform, client_id, payload_json, status, attempt_count)
      SELECT * FROM (${selects})
      WHERE NOT EXISTS (SELECT 1 FROM system_state WHERE key = ${ENQUEUE_WRITE_GATE_KEY} AND value LIKE ${ENQUEUE_WRITE_GATE_PAUSED + "%"})
      ON CONFLICT DO NOTHING
      RETURNING id`)) as { id: number }[];

    return {
      status: "accepted",
      count: inserted.length,
      outboxIds: inserted.map((row) => row.id)
    };
  }


  async getDueJobs(limit: number = 50): Promise<PushOutboxJob[]> {
    const now = new Date().toISOString();
    const rows = await this.drizzle
      .select(this.getSelectFields())
      .from(pushOutbox)
      .where(sql`${pushOutbox.status} = 'pending' AND (${pushOutbox.nextRetryAt} IS NULL OR ${pushOutbox.nextRetryAt} <= ${now})`)
      .orderBy(pushOutbox.id)
      .limit(Math.min(Math.max(limit, 1), 200));

    return rows as PushOutboxJob[];
  }


  async getJobById(id: number): Promise<PushOutboxJob | null> {
    const row = await this.drizzle
      .select(this.getSelectFields())
      .from(pushOutbox)
      .where(eq(pushOutbox.id, id))
      .get();

    return (row as PushOutboxJob) ?? null;
  }


  async getPendingJobIdsByMessage(userId: number, messageId: number): Promise<number[]> {
    const rows = await this.drizzle
      .select({ id: pushOutbox.id })
      .from(pushOutbox)
      .where(sql`${pushOutbox.userId} = ${userId} AND ${pushOutbox.messageId} = ${messageId} AND ${pushOutbox.status} = 'pending'`)
      .orderBy(pushOutbox.id);

    return rows.map((row) => row.id);
  }







  async getPushTargetByClientId(clientId: number): Promise<PushTargetLookup> {
    const row = await this.drizzle
      .select({
        platform: clients.platform,
        deviceToken: clients.deviceToken,
        tokenUpdatedAt: clients.tokenUpdatedAt,
        tokenStatus: clients.tokenStatus
      })
      .from(clients)
      .where(eq(clients.id, clientId))
      .get();

    if (!row) {
      return { kind: "deleted", clientId };
    }


    const snapshot = {
      clientId,
      platform: (row.platform || "unknown") as PushPlatform,
      deviceToken: row.deviceToken ?? null,
      tokenUpdatedAt: row.tokenUpdatedAt ?? null,
      tokenStatus: row.tokenStatus
    };


    if (row.tokenStatus !== "active") {
      return { kind: "inactive", ...snapshot };
    }
    if (!row.deviceToken) {
      return { kind: "no-token", ...snapshot };
    }
    return { kind: "ready", ...snapshot };
  }


  async markProcessing(id: number): Promise<string | null> {
    const rows = await this.drizzle
      .update(pushOutbox)
      .set({
        status: "processing",
        updatedAt: new Date().toISOString()
      })
      .where(and(eq(pushOutbox.id, id), eq(pushOutbox.status, "pending")))
      .returning({ updatedAt: pushOutbox.updatedAt });

    return rows[0]?.updatedAt ?? null;
  }


  async markSuccess(id: number, lease: string): Promise<void> {
    await this.drizzle
      .update(pushOutbox)
      .set({
        status: "success",
        lastError: null,
        updatedAt: new Date().toISOString()
      })
      .where(and(eq(pushOutbox.id, id), eq(pushOutbox.status, "processing"), eq(pushOutbox.updatedAt, lease)));
  }


  async scheduleRetry(id: number, attemptCount: number, nextRetryAt: string, error: string, lease: string): Promise<boolean> {
    const rows = await this.drizzle
      .update(pushOutbox)
      .set({
        status: "pending",
        attemptCount,
        nextRetryAt,
        lastError: error,
        updatedAt: new Date().toISOString()
      })
      .where(and(eq(pushOutbox.id, id), eq(pushOutbox.status, "processing"), eq(pushOutbox.updatedAt, lease)))
      .returning({ id: pushOutbox.id });
    return rows.length > 0;
  }


  async suspend(id: number, nextRetryAt: string, reason: string, lease: string): Promise<void> {
    await this.drizzle
      .update(pushOutbox)
      .set({
        status: "pending",
        nextRetryAt,
        lastError: reason,
        updatedAt: new Date().toISOString()
      })
      .where(and(eq(pushOutbox.id, id), eq(pushOutbox.status, "processing"), eq(pushOutbox.updatedAt, lease)));
  }


  async reclaimStaleProcessing(leaseMs: number = 10 * 60 * 1000): Promise<number> {
    const cutoff = new Date(Date.now() - leaseMs).toISOString();
    const result = await this.drizzle
      .update(pushOutbox)
      .set({
        status: "pending",
        lastError: "Reclaimed stale processing lease",
        updatedAt: new Date().toISOString()
      })
      .where(sql`${pushOutbox.status} = 'processing' AND ${pushOutbox.updatedAt} < ${cutoff}`);
    return affectedRows(result);
  }


  async markDead(id: number, attemptCount: number, error: string, lease: string): Promise<boolean> {
    const rows = await this.drizzle
      .update(pushOutbox)
      .set({
        status: "dead",
        attemptCount,
        lastError: error,
        updatedAt: new Date().toISOString()
      })
      .where(and(eq(pushOutbox.id, id), eq(pushOutbox.status, "processing"), eq(pushOutbox.updatedAt, lease)))
      .returning({ id: pushOutbox.id });
    return rows.length > 0;
  }


  async invalidateClient(
    clientId: number,
    reason: string,
    jobId: number,
    attemptCount: number,
    error: string,
    lease: string
  ): Promise<void> {
    const updatedAt = new Date().toISOString();
    const statements = [
      {
        sql: `UPDATE clients SET token_status = 'invalid', device_token = NULL
          WHERE id = ? AND token_status = 'active'
          AND EXISTS (
            SELECT 1 FROM push_outbox
            WHERE id = ? AND client_id = ? AND status = 'processing' AND updated_at = ?
          )`,
        args: [clientId, jobId, clientId, lease] as unknown[]
      },
      {
        sql: `UPDATE push_outbox SET status = 'dead', last_error = ?, updated_at = ?
          WHERE client_id = ? AND id <> ? AND status IN ('pending', 'processing')
          AND EXISTS (
            SELECT 1 FROM push_outbox
            WHERE id = ? AND client_id = ? AND status = 'processing' AND updated_at = ?
          )`,
        args: [reason, updatedAt, clientId, jobId, jobId, clientId, lease] as unknown[]
      },
      {
        sql: `UPDATE push_outbox SET status = 'dead', attempt_count = ?, last_error = ?, updated_at = ?
          WHERE id = ? AND client_id = ? AND status = 'processing' AND updated_at = ?`,
        args: [attemptCount, error, updatedAt, jobId, clientId, lease] as unknown[]
      }
    ];

    type D1BatchClient = {
      prepare(sql: string): { bind(...args: unknown[]): unknown };
      batch(statements: unknown[]): Promise<unknown>;
    };
    type SqliteTransactionClient = {
      prepare(sql: string): { run(...args: unknown[]): unknown };
      transaction<T>(fn: () => T): () => T;
    };
    const rawClient = this.drizzle.$client as unknown as D1BatchClient | SqliteTransactionClient;
    if ('batch' in rawClient && typeof rawClient.batch === 'function') {
      await rawClient.batch(statements.map((statement) => rawClient.prepare(statement.sql).bind(...statement.args)));
      return;
    }

    const sqlite = rawClient as SqliteTransactionClient;
    sqlite.transaction(() => {
      for (const statement of statements) {
        sqlite.prepare(statement.sql).run(...statement.args);
      }
    })();
  }
}
