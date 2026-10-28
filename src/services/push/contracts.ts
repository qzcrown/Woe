















export type PushPlatform = string;






export interface ProviderSendInput {
  userId: number;
  platform: PushPlatform;
  deviceToken: string;
  messageId: number;
  appid: number;
  date: string;
  title?: string;
  message: string;
  priority?: number;
  extras?: Record<string, unknown>;
}







export interface ProviderSendDiagnostics {
  errorCode?: string;
  errorMessage?: string;
  raw?: unknown;
}











export type ProviderSendResult = ProviderSendDiagnostics &
  (
    | { ok: true; retriable: false; failureKind?: never }
    | { ok: false; retriable: false; failureKind: "suspend" }
    | { ok: false; retriable: boolean; failureKind: "invalid-target" }
    | { ok: false; retriable: boolean; failureKind?: never }
  );


export interface PushProvider {
  name: PushPlatform;
  send(input: ProviderSendInput): Promise<ProviderSendResult>;
}


export interface PushDeliveryPolicy {
  maxRetries: number;
  retryBackoffMs: number;
}


export interface PushProviderRegistration {
  platform: PushPlatform;
  provider: PushProvider | null;
  policy: PushDeliveryPolicy;
}










export type ProviderResolution =
  | { status: "ready"; provider: PushProvider; policy: PushDeliveryPolicy }
  | { status: "disabled" | "init-failed"; provider: null; policy: PushDeliveryPolicy }
  | { status: "unregistered"; provider: null; policy: null };


export interface ProviderResolver {
  get(platform: PushPlatform): PushProvider | null;
  getPolicy(platform: PushPlatform): PushDeliveryPolicy | null;
  resolve(platform: PushPlatform): ProviderResolution;
}






export const DEFAULT_PUSH_DELIVERY_POLICY: Readonly<PushDeliveryPolicy> = Object.freeze({
  maxRetries: 3,
  retryBackoffMs: 2000
});


export const SUSPEND_RETRY_AT_DELAY_MS = 60_000;
