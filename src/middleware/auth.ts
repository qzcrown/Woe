import { Env } from "../types/index.ts";

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
  constructor(private db: D1Database) {}

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
      const existingUserCount = await this.db.prepare(`
        SELECT COUNT(*) as count FROM users
      `).first<{ count: number }>();

      if (existingUserCount && existingUserCount.count > 0) {
        console.log("Users already exist, skipping admin initialization");
        return false;
      }

      // 如果没有提供默认凭据，不创建管理员
      if (!defaultUsername || !defaultPassword) {
        console.log("No default credentials provided, skipping admin creation");
        return false;
      }

      // 创建默认管理员用户
      const result = await this.db.prepare(`
        INSERT INTO users (name, pass, admin, created_at)
        VALUES (?, ?, 1, datetime('now'))
      `).bind(defaultUsername, defaultPassword).run();

      if (result.success) {
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

      if (env.DEFAULT_ADMIN_USER && env.DEFAULT_ADMIN_PASSWORD && username === env.DEFAULT_ADMIN_USER && password === env.DEFAULT_ADMIN_PASSWORD) {
        const { InitializationService } = await import("../services/initializationService.ts");
        const initService = new InitializationService(this.db);
        const isInitialized = await initService.isSystemInitialized();
        if (!isInitialized) {
          return null;
        }
        return null;
      }

      // 正常用户认证流程
      const result = await this.db.prepare(`
        SELECT id, name, pass, admin, disabled
        FROM users
        WHERE name = ? AND disabled = 0
      `).bind(username).first();

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
        const result = await this.db.prepare(`
          SELECT a.id, a.user_id, u.admin as user_admin
          FROM applications a
          JOIN users u ON a.user_id = u.id
          WHERE a.token = ?
        `).bind(token).first();

        if (result) {
          return {
            userId: (result as any).user_id,
            isAdmin: (result as any).user_admin,
            tokenType: "app" as const,
            resourceId: (result as any).id
          };
        }
      }

      if (token.startsWith("C")) {
        const result = await this.db.prepare(`
          SELECT c.id, c.user_id, u.admin as user_admin
          FROM clients c
          JOIN users u ON c.user_id = u.id
          WHERE c.token = ?
        `).bind(token).first();

        if (result) {
          return {
            userId: (result as any).user_id,
            isAdmin: (result as any).user_admin,
            tokenType: "client" as const,
            resourceId: (result as any).id
          };
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

  private async verifyPassword(storedPassword: string, inputPassword: string): Promise<boolean> {
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
      // 明文密码（向后兼容）
      return storedPassword === inputPassword;
    }
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
  let randomPart = "";
  for (let i = 0; i < 10; i++) {
    randomPart += chars.charAt(Math.floor(Math.random() * chars.length));
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
