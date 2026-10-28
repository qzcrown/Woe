













































import type { D1Database } from "@cloudflare/workers-types";
import { Message } from "../types/index.ts";
import { createDrizzle } from "../drizzle/index.ts";
import { parseClientTimestamp } from "../services/clientExpiry.ts";
import { safeErrorKind } from "../utils/safeError.ts";
import {
  refreshBoundStreamClient,
  loadStreamClientBindingState,
  streamClientRefreshIntervalMs,
  streamClientRetryAfterMs,
  StreamClientRenewalError,
  STREAM_HEADER_USER_ID,
  STREAM_HEADER_CLIENT_ID,
  STREAM_HEADER_TOKEN_LOOKUP,
  type StreamClientBinding
} from "../services/streamClientActivity.ts";


interface BroadcastBody {
  message?: Message;
}









interface BoundStreamAttachment extends StreamClientBinding {
  v: 1;
  expiresAfterInactivitySeconds: number;
}


const CLOSE_CREDENTIAL_INVALID = 4002;

const CLOSE_REAUTH_REQUIRED = 4003;

const CLOSE_CLIENT_DELETED = 4001;

const WS_READYSTATE_OPEN = 1;


function isOpenSocket(ws: WebSocket): boolean {
  return typeof ws.readyState !== "number" || ws.readyState === WS_READYSTATE_OPEN;
}

function closeQuietly(ws: WebSocket, code: number, reason: string): void {
  try {
    ws.close(code, reason);
  } catch {

  }
}


function readBoundAttachment(ws: WebSocket): BoundStreamAttachment | null {
  if (typeof ws.deserializeAttachment !== "function") return null;
  let raw: unknown;
  try {
    raw = ws.deserializeAttachment();
  } catch {
    return null;
  }
  if (!raw || typeof raw !== "object") return null;
  const a = raw as Record<string, unknown>;
  if (a.v !== 1) return null;
  if (!Number.isSafeInteger(a.userId) || (a.userId as number) <= 0) return null;
  if (!Number.isSafeInteger(a.clientId) || (a.clientId as number) <= 0) return null;
  if (typeof a.tokenLookup !== "string" || a.tokenLookup.length === 0) return null;
  const seconds =
    Number.isSafeInteger(a.expiresAfterInactivitySeconds) && (a.expiresAfterInactivitySeconds as number) >= 0
      ? (a.expiresAfterInactivitySeconds as number)
      : 0;
  return {
    v: 1,
    userId: a.userId as number,
    clientId: a.clientId as number,
    tokenLookup: a.tokenLookup,
    expiresAfterInactivitySeconds: seconds
  };
}


function parseBindingHeaders(request: Request): StreamClientBinding | "none" | null {
  const userIdHeader = request.headers.get(STREAM_HEADER_USER_ID);
  const clientIdHeader = request.headers.get(STREAM_HEADER_CLIENT_ID);
  const tokenLookupHeader = request.headers.get(STREAM_HEADER_TOKEN_LOOKUP);
  if (userIdHeader === null && clientIdHeader === null && tokenLookupHeader === null) return "none";
  if (userIdHeader === null || clientIdHeader === null || tokenLookupHeader === null) return null;
  const userId = Number(userIdHeader);
  const clientId = Number(clientIdHeader);
  if (!Number.isSafeInteger(userId) || userId <= 0) return null;
  if (!Number.isSafeInteger(clientId) || clientId <= 0) return null;
  if (!tokenLookupHeader) return null;
  return { userId, clientId, tokenLookup: tokenLookupHeader };
}


function minAt(current: number | null, candidate: number): number {
  return current === null ? candidate : Math.min(current, candidate);
}


interface RenewalGroup {
  binding: StreamClientBinding;
  seconds: number;
  sockets: WebSocket[];
}


export class MessageStreamHubObject {
  constructor(private state: DurableObjectState, private env?: unknown) {}

  private getDb(): D1Database | undefined {
    return (this.env as { DB?: D1Database } | undefined)?.DB;
  }
























  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    if (message !== "ping") return;
    try {
      ws.send("pong");
    } catch {
      return;
    }

    const attachment = readBoundAttachment(ws);
    if (!attachment) {
      if (this.state.getTags(ws).some((tag) => tag.startsWith("client:"))) {
        closeQuietly(ws, CLOSE_REAUTH_REQUIRED, "re-authentication required");
      }
      return;
    }
    const db = this.getDb();
    if (!db) return;
    const binding: StreamClientBinding = {
      userId: attachment.userId,
      clientId: attachment.clientId,
      tokenLookup: attachment.tokenLookup
    };
    try {
      const result = await refreshBoundStreamClient(createDrizzle(db), binding);
      if (result.status === "invalid") {
        closeQuietly(ws, CLOSE_CREDENTIAL_INVALID, "client credential invalid");
        return;
      }
      const currentSeconds = typeof result.currentSeconds === "number" ? result.currentSeconds : null;
      if (currentSeconds !== null) {

        this.syncMatchingSocketsAttachmentHint(binding, currentSeconds);
      }

      if (this.hasOpenMatchingSockets(binding)) {
        const hintSeconds = currentSeconds ?? attachment.expiresAfterInactivitySeconds;
        await this.ensureAlarmAt(
          typeof result.refreshDueAtMs === "number"
            ? result.refreshDueAtMs
            : Date.now() + streamClientRefreshIntervalMs(hintSeconds)
        );
      }
    } catch (error) {


      console.error("Failed to renew bound stream client on ping:", safeErrorKind(error));



      const currentSeconds = error instanceof StreamClientRenewalError ? error.currentSeconds : undefined;
      if (typeof currentSeconds === "number") {
        this.syncMatchingSocketsAttachmentHint(binding, currentSeconds);
        if (this.hasOpenMatchingSockets(binding)) {
          await this.ensureAlarmAt(Date.now() + streamClientRetryAfterMs(currentSeconds));
        }
      }
    }
  }


















  async alarm(): Promise<void> {
    const nowMs = Date.now();
    const db = this.getDb();
    const groups = new Map<string, RenewalGroup>();

    for (const ws of this.state.getWebSockets()) {
      if (!isOpenSocket(ws)) continue;
      const attachment = readBoundAttachment(ws);
      if (attachment) {
        const key = `${attachment.userId}:${attachment.clientId}:${attachment.tokenLookup}`;
        let group = groups.get(key);
        if (!group) {
          group = {
            binding: { userId: attachment.userId, clientId: attachment.clientId, tokenLookup: attachment.tokenLookup },
            seconds: attachment.expiresAfterInactivitySeconds,
            sockets: []
          };
          groups.set(key, group);
        }
        group.sockets.push(ws);
      } else if (this.state.getTags(ws).some((tag) => tag.startsWith("client:"))) {


        closeQuietly(ws, CLOSE_REAUTH_REQUIRED, "re-authentication required");
      }

    }

    let nextDueAtMs: number | null = null;
    for (const group of groups.values()) {
      if (!db) {

        console.error("Stream client renewal skipped: DB binding missing");
        nextDueAtMs = minAt(nextDueAtMs, nowMs + streamClientRetryAfterMs(group.seconds));
        continue;
      }
      try {
        const result = await refreshBoundStreamClient(createDrizzle(db), group.binding, nowMs);
        if (result.status === "invalid") {
          for (const ws of group.sockets) {
            closeQuietly(ws, CLOSE_CREDENTIAL_INVALID, "client credential invalid");
          }
          continue;
        }



        if (typeof result.currentSeconds === "number") {
          this.syncMatchingSocketsAttachmentHint(group.binding, result.currentSeconds);
          group.seconds = result.currentSeconds;
        }
        if (group.sockets.some(isOpenSocket)) {
          nextDueAtMs = minAt(
            nextDueAtMs,
            result.refreshDueAtMs ?? nowMs + streamClientRefreshIntervalMs(group.seconds)
          );
        }
      } catch (error) {

        console.error("Bound stream client renewal failed (alarm will retry):", safeErrorKind(error));





        const currentSeconds = error instanceof StreamClientRenewalError ? error.currentSeconds : undefined;
        if (typeof currentSeconds === "number") {
          this.syncMatchingSocketsAttachmentHint(group.binding, currentSeconds);
          group.seconds = currentSeconds;
        }
        nextDueAtMs = minAt(nextDueAtMs, nowMs + streamClientRetryAfterMs(currentSeconds ?? group.seconds));
      }
    }

    const storage = this.state.storage;
    if (!storage) return;

    if (!this.hasOpenBoundSockets()) {
      await storage.deleteAlarm();
      return;
    }
    if (nextDueAtMs === null) return;



    await this.ensureAlarmAt(nextDueAtMs);
  }





  async webSocketClose(ws: WebSocket, code: number, reason: string, _wasClean: boolean): Promise<void> {
    closeQuietly(ws, code, reason);
    await this.deleteAlarmIfNoBoundSockets();
  }


  async webSocketError(ws: WebSocket, error: unknown): Promise<void> {
    console.error("Stream hub WebSocket error:", safeErrorKind(error));
    closeQuietly(ws, 1011, "stream error");
    await this.deleteAlarmIfNoBoundSockets();
  }


  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/connect") {
      return this.handleConnect(request);
    }

    if (url.pathname === "/disconnect" && request.method === "POST") {
      return this.handleDisconnect(request);
    }

    if (url.pathname === "/broadcast" && request.method === "POST") {
      return this.handleBroadcast(request);
    }

    return new Response("Not Found", { status: 404 });
  }


  private async handleConnect(request: Request): Promise<Response> {
    const upgrade = request.headers.get("Upgrade");
    if (!upgrade || upgrade.toLowerCase() !== "websocket") {
      return new Response("Expected websocket upgrade request", { status: 426 });
    }

    const url = new URL(request.url);
    const clientId = Number(url.searchParams.get("clientId"));
    const hasValidClientId = Number.isSafeInteger(clientId) && clientId > 0;



    const parsed = parseBindingHeaders(request);
    let pending: { attachment: BoundStreamAttachment; dueAtMs: number } | null = null;
    if (parsed !== "none") {
      if (parsed === null || !hasValidClientId || parsed.clientId !== clientId) {
        return new Response("Invalid stream binding", { status: 400 });
      }
      const db = this.getDb();
      if (!db) {
        console.error("Stream connect binding validation failed: DB binding missing");
        return new Response("Stream binding validation unavailable", { status: 500 });
      }
      let loaded: Awaited<ReturnType<typeof loadStreamClientBindingState>>;
      try {
        loaded = await loadStreamClientBindingState(createDrizzle(db), parsed);
      } catch (error) {


        console.error("Stream connect binding validation failed:", safeErrorKind(error));
        return new Response("Stream binding validation failed", { status: 500 });
      }
      if (loaded.status !== "active") {
        return new Response("Stream binding invalid", { status: 401 });
      }

      const lastUsedMs = parseClientTimestamp(loaded.state.lastUsed);
      pending = {
        attachment: { v: 1, ...parsed, expiresAfterInactivitySeconds: loaded.state.expiresAfterInactivitySeconds },
        dueAtMs:
          (lastUsedMs ?? Date.now()) + streamClientRefreshIntervalMs(loaded.state.expiresAfterInactivitySeconds)
      };
    }

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    const tags = hasValidClientId ? [`client:${clientId}`] : undefined;



    this.state.acceptWebSocket(server, tags);

    if (pending) {
      server.serializeAttachment(pending.attachment);






      this.syncMatchingSocketsAttachmentHint(pending.attachment, pending.attachment.expiresAfterInactivitySeconds);
      await this.ensureAlarmAt(pending.dueAtMs);
    }


    return new Response(null, {
      status: 101,
      webSocket: client,
    });
  }


  private async ensureAlarmAt(dueAtMs: number): Promise<void> {
    const storage = this.state.storage;
    if (!storage) return;
    const existing = await storage.getAlarm();
    if (existing === null || existing > dueAtMs) {
      await storage.setAlarm(dueAtMs);
    }
  }






  private openMatchingBindings(binding: StreamClientBinding): Array<{ ws: WebSocket; attachment: BoundStreamAttachment }> {
    const matched: Array<{ ws: WebSocket; attachment: BoundStreamAttachment }> = [];
    for (const ws of this.state.getWebSockets()) {
      if (!isOpenSocket(ws)) continue;
      const candidate = readBoundAttachment(ws);
      if (!candidate) continue;
      if (
        candidate.userId !== binding.userId ||
        candidate.clientId !== binding.clientId ||
        candidate.tokenLookup !== binding.tokenLookup
      ) {
        continue;
      }
      matched.push({ ws, attachment: candidate });
    }
    return matched;
  }


  private hasOpenMatchingSockets(binding: StreamClientBinding): boolean {
    return this.openMatchingBindings(binding).length > 0;
  }











  private syncMatchingSocketsAttachmentHint(binding: StreamClientBinding, currentSeconds: number): void {
    for (const { ws, attachment } of this.openMatchingBindings(binding)) {
      if (attachment.expiresAfterInactivitySeconds === currentSeconds) continue;
      this.syncSocketAttachmentHint(ws, binding, currentSeconds);
    }
  }







  private syncSocketAttachmentHint(ws: WebSocket, binding: StreamClientBinding, currentSeconds: number): void {
    if (!isOpenSocket(ws)) return;
    try {
      ws.serializeAttachment({ v: 1, ...binding, expiresAfterInactivitySeconds: currentSeconds });
    } catch {

    }
  }


  private hasOpenBoundSockets(): boolean {
    for (const ws of this.state.getWebSockets()) {
      if (isOpenSocket(ws) && readBoundAttachment(ws)) return true;
    }
    return false;
  }


  private async deleteAlarmIfNoBoundSockets(): Promise<void> {
    const storage = this.state.storage;
    if (!storage) return;
    if (this.hasOpenBoundSockets()) return;
    await storage.deleteAlarm();
  }


  private async handleDisconnect(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const clientId = Number(url.searchParams.get("clientId"));
    if (!Number.isSafeInteger(clientId) || clientId <= 0) {
      return new Response("Invalid clientId", { status: 400 });
    }

    let closed = 0;
    let failed = 0;
    for (const socket of this.state.getWebSockets(`client:${clientId}`)) {
      try {
        socket.close(CLOSE_CLIENT_DELETED, "client deleted");
        closed++;
      } catch {
        failed++;
      }
    }

    await this.deleteAlarmIfNoBoundSockets();
    return new Response(JSON.stringify({ closed, failed }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }


  private async handleBroadcast(request: Request): Promise<Response> {
    let body: BroadcastBody;
    try {
      body = (await request.json()) as BroadcastBody;
    } catch {
      return new Response("Invalid JSON body", { status: 400 });
    }

    if (!body?.message) {
      return new Response("Missing required field: message", { status: 400 });
    }

    const payload = JSON.stringify(body.message);
    let delivered = 0;
    let failed = 0;


    for (const socket of this.state.getWebSockets()) {
      try {
        socket.send(payload);
        delivered++;
      } catch {
        failed++;
        try {
          socket.close(1011, "broadcast send failed");
        } catch {

        }
      }
    }

    return new Response(JSON.stringify({ delivered, failed }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }
}
