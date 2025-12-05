// Woe API Types - Based on Gotify API v2.0.2

export interface User {
  id: number;
  name: string;
  admin: boolean;
}

export interface UserWithPass extends User {
  pass: string;
}

export interface Application {
  id: number;
  token: string;
  name: string;
  description: string;
  internal: boolean;
  image: string;
  lastUsed: string | null;
  defaultPriority: number;
}

export interface Client {
  id: number;
  token: string;
  name: string;
  lastUsed: string | null;
}

export interface Message {
  id: number;
  appid: number;
  message: string;
  title: string;
  priority: number;
  date: string;
  extras?: Record<string, any>;
}

export interface Paging {
  size: number;
  since: number;
  limit: number;
  next?: string;
}

export interface PagedMessages {
  paging: Paging;
  messages: Message[];
}

export interface PluginConf {
  id: number;
  name: string;
  token: string;
  modulePath: string;
  enabled: boolean;
  capabilities: string[];
  author?: string;
  license?: string;
  website?: string;
}

export interface Health {
  health: string;
  database: string;
}

export interface VersionInfo {
  version: string;
  commit: string;
  buildDate: string;
}

export interface ErrorResponse {
  error: string;
  errorCode: number;
  errorDescription: string;
}

export interface Env {
  DB: D1Database;
  R2?: R2Bucket;
  ASSETS?: Fetcher;
  VERSION?: string;
  ENVIRONMENT?: string;
  DEFAULT_ADMIN_USER?: string;
  DEFAULT_ADMIN_PASSWORD?: string;
  REGISTRATION?: string; // Allow user registration (true/false), default false
}
