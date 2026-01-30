import { Env } from "../types/index.ts";
import { DrizzleDB } from "../drizzle/index.ts";
import { users, applications, clients } from "../models/index.ts";
import { eq, and, count } from "drizzle-orm";

interface TokenInfo {
  userId: number;
  isAdmin: boolean;
  tokenType: "app" | "client";
  resourceId?: number;
}

interface UserInfo {
  id: number;
  name: string;
  pass: string;
  admin: boolean;
}

export class Authenticator {
  constructor(private drizzle: DrizzleDB) {}

  // Add a private method to parse basic auth
  private parseBasicAuth(authHeader: string): { username: string; password: string } | null {
    try {
      const base64Credentials = authHeader.substring(6);
      const credentials = atob(base64Credentials);
      const [username, password] = credentials.split(':');
      return { username, password };
    } catch (error) {
      console.error("Failed to parse Basic Auth header:", error);
      return null;
    }
  }

  async isDefaultInitAuth(request: Request, env: Env): Promise<boolean> {
    const authHeader = request.headers.get("Authorization");
    if (!authHeader?.startsWith("Basic ")) return false;
    const credentials = this.parseBasicAuth(authHeader);
    if (!credentials) return false;
    const { username, password } = credentials;
    if (!env.DEFAULT_ADMIN_USER || !env.DEFAULT_ADMIN_PASSWORD) return false;
    return username === env.DEFAULT_ADMIN_USER && password === env.DEFAULT_ADMIN_PASSWORD;
  }

  // 初始化默认管理员用户
  async initializeDefaultAdmin(defaultUsername?: string, defaultPassword?: string): Promise<boolean> {
    try {
      // 检查是否已有用户
      const existingUserCount = await this.drizzle
        .select({ count: count() })
        .from(users)
        .get();

      if (existingUserCount && existingUserCount.count > 0) {
        console.log("Users already exist, skipping admin initialization");
        return false;
      }

      // 如果没有提供默认凭据，不创建管理员
      if (!defaultUsername || !defaultPassword) {
        console.log("No default credentials provided, skipping admin creation");
        return false;
      }

      // 哈希密码
      const hashedPassword = await hashPassword(defaultPassword);

      // 创建默认管理员用户
      const result = await this.drizzle
        .insert(users)
        .values({
          name: defaultUsername,
          nickname: defaultUsername,
          email: 'needupdate@crownkin.space',
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
      console.error("Error initializing default admin:", error);
      return false;
    }
  }

  // 认证请求：支持多种认证方式
  async authenticate(request: Request): Promise<TokenInfo | null> {
    const token = this.extractToken(request);
    if (!token) return null;
    return await this.validateToken(token);
  }

  async requireClient(request: Request, env: Env): Promise<TokenInfo | null> {
    const basicUser = await this.authenticateBasic(request, env);
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

  // Basic Auth 认证，仅用于创建客户端token (Gotify规范要求)
  // 支持初始化触发：当使用默认凭证且系统未初始化时，自动初始化系统
  async authenticateBasic(request: Request, env: Env): Promise<UserInfo | null> {
    const authHeader = request.headers.get("Authorization");
    if (!authHeader?.startsWith("Basic ")) return null;

    try {
      const credentials = this.parseBasicAuth(authHeader);
      if (!credentials) return null;

      const { username, password } = credentials;
      
      // DEFAULT_ADMIN_USER 和 DEFAULT_ADMIN_PASSWORD 无法用于认证，仅用于触发初始化
      if (env.DEFAULT_ADMIN_USER && env.DEFAULT_ADMIN_PASSWORD && username === env.DEFAULT_ADMIN_USER && password === env.DEFAULT_ADMIN_PASSWORD) {
        const { InitService } = await import("../services/initService.ts");
        const initService = new InitService(this.drizzle.$client);
        const isInitialized = await initService.isSystemInitialized();
        if (!isInitialized) {
          return null;
        }
        return null;
      }

      // 正常用户认证流程
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
      // 使用哈希密码验证（支持向后兼容）
      const isValid = await this.verifyPassword(user.pass, password);
      if (!isValid) return null;

      return user;
    } catch (error) {
      console.error("Basic auth error:", error);
      return null;
    }
  }

  private extractToken(request: Request): string | null {
    const gotifyKey = request.headers.get("X-Gotify-Key");
    if (gotifyKey) return gotifyKey;

    const authHeader = request.headers.get("Authorization");
    if (authHeader?.startsWith("Bearer ")) {
      return authHeader.substring(7);
    }

    const url = new URL(request.url);
    return url.searchParams.get("token");
  }

  private async validateToken(token: string): Promise<TokenInfo | null> {
    try {
      if (token.startsWith("A")) {
        const result = await this.drizzle
          .select({
            id: applications.id,
            userId: applications.userId
          })
          .from(applications)
          .where(eq(applications.token, token))
          .get();
        
        if (result) {
          // Get user admin status separately
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

      if (token.startsWith("C")) {
        const result = await this.drizzle
          .select({
            id: clients.id,
            userId: clients.userId
          })
          .from(clients)
          .where(eq(clients.token, token))
          .get();
        
        if (result) {
          // Get user admin status separately
          const userResult = await this.drizzle
            .select({ admin: users.admin })
            .from(users)
            .where(and(eq(users.id, result.userId), eq(users.disabled, false)))
            .get();

          if (userResult) {
            return {
              userId: result.userId,
              isAdmin: userResult.admin,
              tokenType: "client" as const,
              resourceId: result.id
            };
          }
        }
      }

      return null;
    } catch (error) {
      console.error("Token validation error:", error);
      return null;
    }
  }

  // 密码哈希工具方法
  private async hashPassword(password: string): Promise<string> {
    // 生成盐值
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const saltHex = Array.from(salt).map(b => b.toString(16).padStart(2, '0')).join('');

    // 将密码和盐值组合
    const encoder = new TextEncoder();
    const data = encoder.encode(password + saltHex);

    // 计算SHA-256哈希
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');

    // 返回格式: $sha256$salt$hash
    return `$sha256$${saltHex}$${hashHex}`;
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

// Token 生成工具函数
export function generateToken(type: "app" | "client"): string {
  const prefix = type === "app" ? "A" : "C";
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

  // 使用crypto API 生成随机字节以提升安全性
  const randomBytes = crypto.getRandomValues(new Uint8Array(20));
  let randomPart = "";

  for (let i = 0; i < 10; i++) {
    randomPart += chars.charAt(randomBytes[i] % chars.length);
  }
  return prefix + randomPart;
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const saltHex = Array.from(salt).map(b => b.toString(16).padStart(2, '0')).join('');
  const encoder = new TextEncoder();
  const data = encoder.encode(password + saltHex);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  return `$sha256$${saltHex}$${hashHex}`;
}

// Export verifyPassword function for use in other modules
export async function verifyPassword(storedPassword: string, inputPassword: string): Promise<boolean> {
  // 检查是否为哈希格式
  if (storedPassword.startsWith('$sha256$')) {
    // 解析哈希格式: $sha256$salt$hash
    const parts = storedPassword.split('$');
    if (parts.length !== 4) return false;

    const saltHex = parts[2];
    const storedHash = parts[3];

    // 计算输入密码的哈希
    const encoder = new TextEncoder();
    const data = encoder.encode(inputPassword + saltHex);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const inputHash = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');

    return inputHash === storedHash;
  } else {
    console.warn("Detected plaintext or unsupported hash password in database - this is invalid/insecure and deprecated");
    return false;
  }
}
