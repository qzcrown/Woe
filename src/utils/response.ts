import { ErrorResponse } from "../types/index.ts";

export class ApiResponse {
  static json(data: any, status: number = 200, headers: Record<string, string> = {}): Response {
    return new Response(JSON.stringify(data), {
      status,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Gotify-Key",
        ...headers,
      },
    });
  }

  static error(error: string, errorCode: number, errorDescription: string): Response {
    const errorResponse: ErrorResponse = {
      error,
      errorCode,
      errorDescription,
    };
    return new Response(JSON.stringify(errorResponse), {
      status: errorCode,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Gotify-Key",
      },
    });
  }

  static noContent(): Response {
    return new Response(null, {
      status: 204,
      headers: {
        "Content-Type": "application/json",
      },
    });
  }
}

export function toBoolean(value: number | boolean): boolean {
  return !!value;
}

export function safeJsonParse(value: string | null | undefined): any {
  if (!value) return undefined;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

/**
 * 格式化日期为ISO字符串格式
 * 处理SQLite日期时间格式(YYYY-MM-DD HH:MM:SS)转换为ISO格式(YYYY-MM-DDTHH:MM:SSZ)
 */
export function formatDate(dateStr: string | null | undefined): string | null {
  if (!dateStr) return null;

  // 如果已经是ISO格式或包含T，直接返回
  if (dateStr.includes('T')) return dateStr;

  // 处理SQLite日期时间格式: YYYY-MM-DD HH:MM:SS
  // 替换空格为T，添加Z表示UTC
  return dateStr.replace(' ', 'T') + 'Z';
}
