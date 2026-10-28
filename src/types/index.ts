





export interface User {
  id: number;
  name: string;
  nickname: string;
  email: string;
  avatar?: string;
  description?: string;
  admin: boolean;
  disabled: boolean;

  createdAt: string | null;

  clientId?: number;

  elevatedUntil?: string;
}


export interface UserWithPass extends User {
  pass: string;
}


export interface Application {
  id: number;
  token: string;
  name: string;
  sortKey: string;
  description: string;
  internal: boolean;
  image: string;
  lastUsed: string | null;
  defaultPriority: number;

  createdAt: string | null;
}


export interface Client {
  id: number;
  token: string;
  name: string;

  platform?: string;
  deviceUid?: string | null;
  deviceToken?: string | null;
  tokenUpdatedAt?: string | null;
  tokenStatus?: "active" | "inactive" | "invalid" | "expired";
  appVersion?: string | null;
  deviceModel?: string | null;
  lastUsed: string | null;

  elevatedUntil?: string | null;

  expiresAfterInactivitySeconds: number;

  expiresAt?: string;

  createdAt: string | null;
}


export interface Message {
  id: number;
  appid: number;
  message: string;
  title?: string;
  priority?: number;
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
  icon?: string;
  capabilities: string[];
  author?: string;
  license?: string;
  website?: string;
  configExample?: string;

  createdAt: string | null;
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








export interface Ai {
  run(model: string, input: unknown): Promise<unknown>;
}


export interface Env {
  DB: D1Database;
  PUSH_QUEUE?: Queue;
  R2?: R2Bucket;
  IMAGES?: ImagesBinding;
  ASSETS?: Fetcher;
  MESSAGE_STREAM_HUB?: DurableObjectNamespace;

  AI?: Ai;
  ENVIRONMENT?: string;
  DEFAULT_ADMIN_USER?: string;
  DEFAULT_ADMIN_PASSWORD?: string;
  REGISTRATION?: string | boolean;

  PLUGIN_SECRET_MASTER_KEY?: string;

  PLUGIN_SECRET_KEY_VERSION?: string;

  QUOTA_KV?: KVNamespace;




  PLUGIN_JOB_QUEUE?: Queue;




  PLUGIN_JOB_QUEUE_NAME?: string;

  PUSH_QUEUE_NAME?: string;





  WEBHOOKER_ALLOW_HTTP?: string;





  WEBHOOKER_ALLOW_PRIVATE_NETWORK?: string;
}
