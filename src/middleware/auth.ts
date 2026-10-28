







import { Env } from "../types/index.ts";
import { DrizzleDB } from "../drizzle/index.ts";
import { users, applications, clients } from "../models/index.ts";
import { eq, and, count } from "drizzle-orm";
import { isClientExpired, refreshClientActivity } from "../services/clientExpiry.ts";
import { resolveTokenForLookup } from "../utils/enhancedToken.ts";
import { safeErrorKind } from "../utils/safeError.ts";


interface TokenInfo {
  userId: number;
  isAdmin: boolean;
  tokenType: "app" | "client";
  resourceId?: number;

  clientId?: number;

  elevatedUntil?: string | null;







  clientTokenLookup?: string;
}


interface UserInfo {
  id: number;
  name: string;
  pass: string;
  admin: boolean;
}





export class Authenticator {
  constructor(private drizzle: DrizzleDB) {}






  private tokenAuthMemo: Promise<TokenInfo | null> | null = null;
  private basicAuthMemo = new Map<string, Promise<UserInfo | null>>();



  private parseBasicAuth(authHeader: string): { username: string; password: string } | null {
    try {
      const base64Credentials = authHeader.substring(6);





      const latin1 = atob(base64Credentials);
      const bytes = new Uint8Array(latin1.length);
      for (let i = 0; i < latin1.length; i++) {
        bytes[i] = latin1.charCodeAt(i);
      }
      const credentials = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
      const separatorIndex = credentials.indexOf(":");
      if (separatorIndex < 0) {
        return null;
      }

      const username = credentials.slice(0, separatorIndex);
      const password = credentials.slice(separatorIndex + 1);
      return { username, password };
    } catch (error) {
      console.error("Failed to parse Basic Auth header:", error);
      return null;
    }
  }


  private static readonly WEAK_INIT_PASSWORDS = new Set(["password", "admin", "123456"]);


  async isDefaultInitAuth(request: Request, env: Env): Promise<boolean> {
    const authHeader = request.headers.get("Authorization");
    if (!authHeader?.startsWith("Basic ")) return false;
    const credentials = this.parseBasicAuth(authHeader);
    if (!credentials) return false;
    const { username, password } = credentials;
    if (!env.DEFAULT_ADMIN_USER || !env.DEFAULT_ADMIN_PASSWORD) return false;

    if (Authenticator.WEAK_INIT_PASSWORDS.has(password)) return false;
    return username === env.DEFAULT_ADMIN_USER && password === env.DEFAULT_ADMIN_PASSWORD;
  }



  async initializeDefaultAdmin(defaultUsername?: string, defaultPassword?: string): Promise<boolean> {
    try {

      const existingUserCount = await this.drizzle
        .select({ count: count() })
        .from(users)
        .get();

      if (existingUserCount && existingUserCount.count > 0) {
        console.log("Users already exist, skipping admin initialization");
        return false;
      }


      if (!defaultUsername || !defaultPassword) {
        console.log("No default credentials provided, skipping admin creation");
        return false;
      }


      const hashedPassword = await hashPassword(defaultPassword);


      const result = await this.drizzle
        .insert(users)
        .values({
          name: defaultUsername,
          nickname: defaultUsername,
          email: 'needupdate@example.com',
          pass: hashedPassword,
          admin: true,
          createdAt: new Date().toISOString()
        });

      if (result.meta.changes > 0) {
        console.log(`Default admin user '${defaultUsername}' created successfully`);
        return true;
      } else {
        console.error("Failed to create default admin user");
        return false;
      }
    } catch (error) {

      console.error("Error initializing default admin:", safeErrorKind(error));
      return false;
    }
  }



  async authenticate(request: Request): Promise<TokenInfo | null> {
    if (!this.tokenAuthMemo) {
      this.tokenAuthMemo = (async () => {
        const token = this.extractToken(request);
        if (!token) return null;
        return await this.validateToken(token);
      })();
    }
    return this.tokenAuthMemo;
  }


  async requireClient(request: Request, env: Env, opts?: { skipRehash?: boolean }): Promise<TokenInfo | null> {
    const basicUser = await this.authenticateBasic(request, env, opts);
    if (basicUser) {
      return { userId: basicUser.id, isAdmin: basicUser.admin, tokenType: "client" };
    }
    const tokenInfo = await this.authenticate(request);
    if (!tokenInfo || tokenInfo.tokenType !== "client") return null;
    return tokenInfo;
  }


  async requireApp(request: Request): Promise<TokenInfo | null> {
    const tokenInfo = await this.authenticate(request);
    if (!tokenInfo || tokenInfo.tokenType !== "app") return null;
    return tokenInfo;
  }






  async requireElevatedClient(request: Request, env: Env, opts?: { skipRehash?: boolean }): Promise<TokenInfo | null> {
    const basicUser = await this.authenticateBasic(request, env, opts);
    if (basicUser) {
      return { userId: basicUser.id, isAdmin: basicUser.admin, tokenType: "client" };
    }
    const tokenInfo = await this.authenticate(request);
    if (!tokenInfo || tokenInfo.tokenType !== "client" || !tokenInfo.resourceId) {
      return null;
    }
    const row = await this.drizzle
      .select({ elevatedUntil: clients.elevatedUntil })
      .from(clients)
      .where(eq(clients.id, tokenInfo.resourceId))
      .get();
    if (!row?.elevatedUntil) return null;
    return new Date(row.elevatedUntil).getTime() > Date.now() ? tokenInfo : null;
  }







  async requireElevatedAdmin(request: Request, env: Env, opts?: { skipRehash?: boolean }): Promise<TokenInfo | null> {
    const elevated = await this.requireElevatedClient(request, env, opts);
    if (!elevated || !elevated.isAdmin) return null;
    return elevated;
  }







  async isOrphanClientToken(request: Request): Promise<boolean> {
    const rawToken = this.extractToken(request);
    if (!rawToken) return false;

    const token = await resolveTokenForLookup(rawToken);
    if (!token || !(token.startsWith("C") || token.startsWith("gtfyc."))) return false;
    const clientRow = await this.drizzle
      .select({ id: clients.id, userId: clients.userId, expiresAt: clients.expiresAt })
      .from(clients)
      .where(eq(clients.token, token))
      .get();
    if (!clientRow || isClientExpired(clientRow.expiresAt)) return false;
    const userRow = await this.drizzle
      .select({ id: users.id })
      .from(users)
      .where(eq(users.id, clientRow.userId))
      .get();
    return !userRow;
  }








  private static isBearerScheme(authHeader: string | null): authHeader is string {
    const scheme = "Bearer ";
    return (
      authHeader !== null &&
      authHeader.length >= scheme.length &&
      authHeader.slice(0, scheme.length).toLowerCase() === "bearer "
    );
  }








  private static extractBearerToken(authHeader: string | null): string | null {
    if (!Authenticator.isBearerScheme(authHeader)) return null;
    const token = authHeader.slice("Bearer ".length);
    return token === "" ? null : token;
  }












  hasCredentials(request: Request): boolean {
    const authHeader = request.headers.get("Authorization");
    if (authHeader?.startsWith("Basic ")) {
      return true;
    }
    if (Authenticator.isBearerScheme(authHeader)) {
      return true;
    }

    return this.extractToken(request) !== null;
  }









  async authenticateBasic(request: Request, env: Env, opts?: { skipRehash?: boolean }): Promise<UserInfo | null> {
    const key = opts?.skipRehash ? "skip" : "rehash";
    let memo = this.basicAuthMemo.get(key);
    if (!memo) {
      memo = this.doAuthenticateBasic(request, env, opts);
      this.basicAuthMemo.set(key, memo);
    }
    return memo;
  }

  private async doAuthenticateBasic(request: Request, env: Env, opts?: { skipRehash?: boolean }): Promise<UserInfo | null> {
    const authHeader = request.headers.get("Authorization");
    if (!authHeader?.startsWith("Basic ")) return null;

    try {
      const credentials = this.parseBasicAuth(authHeader);
      if (!credentials) return null;

      const { username, password } = credentials;


      if (env.DEFAULT_ADMIN_USER && env.DEFAULT_ADMIN_PASSWORD && username === env.DEFAULT_ADMIN_USER && password === env.DEFAULT_ADMIN_PASSWORD) {
        const { InitService } = await import("../services/initService.ts");
        const initService = new InitService(this.drizzle.$client);
        const isInitialized = await initService.isSystemInitialized();
        if (!isInitialized) {
          return null;
        }
        return null;
      }


      const result = await this.drizzle
        .select({
          id: users.id,
          name: users.name,
          pass: users.pass,
          admin: users.admin,
          disabled: users.disabled
        })
        .from(users)
        .where(and(eq(users.name, username), eq(users.disabled, false)))
        .get();

      if (!result) return null;

      const user = result as unknown as UserInfo;

      const isValid = await this.verifyPassword(user.pass, password);
      if (!isValid) return null;



      if (!opts?.skipRehash && (isLegacyPasswordHash(user.pass) || needsIterationUpgrade(user.pass))) {
        try {
          const upgraded = await hashPassword(password);
          await this.drizzle
            .update(users)
            .set({ pass: upgraded })
            .where(eq(users.id, user.id));
        } catch (e) {

          console.warn("Password rehash-on-login failed (non-fatal):", safeErrorKind(e));
        }
      }

      return user;
    } catch (error) {
      console.error("Basic auth error:", error);
      return null;
    }
  }


  private extractToken(request: Request): string | null {
    const gotifyKey = request.headers.get("X-Gotify-Key");
    if (gotifyKey) return gotifyKey;


    const bearerToken = Authenticator.extractBearerToken(request.headers.get("Authorization"));
    if (bearerToken !== null) return bearerToken;

    const url = new URL(request.url);
    return url.searchParams.get("token");
  }


  private async validateToken(token: string): Promise<TokenInfo | null> {
    try {



      const lookupToken = await resolveTokenForLookup(token);
      if (lookupToken === null) return null;

      if (lookupToken.startsWith("A") || lookupToken.startsWith("gtfya.")) {
        const result = await this.drizzle
          .select({
            id: applications.id,
            userId: applications.userId
          })
          .from(applications)
          .where(eq(applications.token, lookupToken))
          .get();

        if (result) {

          const userResult = await this.drizzle
            .select({ admin: users.admin })
            .from(users)
            .where(and(eq(users.id, result.userId), eq(users.disabled, false)))
            .get();

          if (userResult) {
            return {
              userId: result.userId,
              isAdmin: userResult.admin,
              tokenType: "app" as const,
              resourceId: result.id
            };
          }
        }
      }

      if (lookupToken.startsWith("C") || lookupToken.startsWith("gtfyc.")) {
        const result = await this.drizzle
          .select({
            id: clients.id,
            userId: clients.userId,

            token: clients.token,
            lastUsed: clients.lastUsed,
            expiresAt: clients.expiresAt,
            expiresAfterInactivitySeconds: clients.expiresAfterInactivitySeconds,

            elevatedUntil: clients.elevatedUntil
          })
          .from(clients)
          .where(eq(clients.token, lookupToken))
          .get();

        if (result) {


          if (isClientExpired(result.expiresAt)) {
            return null;
          }

          const userResult = await this.drizzle
            .select({ admin: users.admin })
            .from(users)
            .where(and(eq(users.id, result.userId), eq(users.disabled, false)))
            .get();

          if (userResult) {

            await refreshClientActivity(this.drizzle, result);
            return {
              userId: result.userId,
              isAdmin: userResult.admin,
              tokenType: "client" as const,
              resourceId: result.id,
              clientId: result.id,
              elevatedUntil: result.elevatedUntil ?? null,


              clientTokenLookup: lookupToken
            };
          }
        }
      }

      return null;
    } catch (error) {

      console.error("Token validation error:", safeErrorKind(error));
      return null;
    }
  }


  async verifyPassword(storedPassword: string, inputPassword: string): Promise<boolean> {
    return verifyPassword(storedPassword, inputPassword);
  }


  hasPermission(tokenInfo: TokenInfo, resourceType: string, resourceUserId?: number): boolean {
    if (tokenInfo.isAdmin) return true;
    if (resourceUserId) {
      return tokenInfo.userId === resourceUserId;
    }
    return true;
  }
}


export const SESSION_NOT_ELEVATED_MESSAGE =
  "session not elevated, use basic auth or call /client:elevate";


export const TOKEN_RANDOM_LENGTH = 22;
const TOKEN_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";


export function randomTokenString(length: number): string {
  const max = 256 - (256 % TOKEN_CHARS.length);
  let out = "";
  while (out.length < length) {
    const bytes = crypto.getRandomValues(new Uint8Array(length * 2));
    for (const b of bytes) {
      if (b < max && out.length < length) {
        out += TOKEN_CHARS[b % TOKEN_CHARS.length];
      }
    }
  }
  return out;
}














const PBKDF2_ITERATIONS = 30_000;

function toHex(buffer: ArrayBuffer | Uint8Array): string {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function pbkdf2Derive(password: string, saltHex: string, iterations: number): Promise<string> {
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"]
  );
  const salt = new Uint8Array(saltHex.match(/.{2}/g)!.map((h) => parseInt(h, 16)));
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations, hash: "SHA-256" },
    keyMaterial,
    256
  );
  return toHex(bits);
}


function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}


export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const saltHex = toHex(salt);
  const hashHex = await pbkdf2Derive(password, saltHex, PBKDF2_ITERATIONS);
  return `$pbkdf2$${PBKDF2_ITERATIONS}$${saltHex}$${hashHex}`;
}


export async function verifyPassword(storedPassword: string, inputPassword: string): Promise<boolean> {
  if (storedPassword.startsWith("$pbkdf2$")) {

    const parts = storedPassword.split("$");
    if (parts.length !== 5) return false;
    if (!/^\d+$/.test(parts[2])) return false;
    const iterations = parseInt(parts[2], 10);
    if (!Number.isSafeInteger(iterations) || iterations < 10_000 || iterations > 2_000_000) return false;
    if (!/^[0-9a-f]{32}$/.test(parts[3]) || !/^[0-9a-f]{64}$/.test(parts[4])) return false;
    try {
      const inputHash = await pbkdf2Derive(inputPassword, parts[3], iterations);
      return timingSafeEqualHex(inputHash, parts[4]);
    } catch {
      return false;
    }
  }

  if (storedPassword.startsWith("$sha256$")) {

    const parts = storedPassword.split("$");
    if (parts.length !== 4) return false;
    if (!/^[0-9a-f]{32}$/.test(parts[2]) || !/^[0-9a-f]{64}$/.test(parts[3])) return false;
    try {
      const data = new TextEncoder().encode(inputPassword + parts[2]);
      const hashBuffer = await crypto.subtle.digest("SHA-256", data);
      return timingSafeEqualHex(toHex(hashBuffer), parts[3]);
    } catch {
      return false;
    }
  }

  console.warn("Rejected unsupported password hash format");
  return false;
}


export function isLegacyPasswordHash(storedPassword: string): boolean {
  return storedPassword.startsWith("$sha256$");
}


export function needsIterationUpgrade(storedPassword: string): boolean {
  if (!storedPassword.startsWith("$pbkdf2$")) return false;
  const iterations = parseInt(storedPassword.split("$")[2] ?? "", 10);
  return Number.isSafeInteger(iterations) && iterations < PBKDF2_ITERATIONS;
}
