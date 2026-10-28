









import type {
  ProviderResolution,
  ProviderResolver,
  PushDeliveryPolicy,
  PushPlatform,
  PushProvider,
  ProviderSendResult
} from "../../src/services/push/contracts.ts";


const success: ProviderSendResult = { ok: true, retriable: false };
const suspend: ProviderSendResult = { ok: false, retriable: false, failureKind: "suspend" };
const invalidTargetRetriable: ProviderSendResult = {
  ok: false,
  retriable: true,
  failureKind: "invalid-target"
};
const invalidTargetPermanent: ProviderSendResult = {
  ok: false,
  retriable: false,
  failureKind: "invalid-target"
};
const retriableFailure: ProviderSendResult = { ok: false, retriable: true };
const permanentFailure: ProviderSendResult = { ok: false, retriable: false };


const successWithDiagnostics: ProviderSendResult = {
  ok: true,
  retriable: false,
  errorCode: "FIXTURE_PUSH_80000000",
  raw: { code: "80000000" }
};

const fallback: ProviderSendResult = { ok: false, retriable: true, failureKind: 'invalid-target' };

void [success, suspend, invalidTargetRetriable, invalidTargetPermanent, retriableFailure, permanentFailure, successWithDiagnostics, fallback];


function assertNarrowing(result: ProviderSendResult): void {
  if (result.ok) {

    const retriable: false = result.retriable;
    void retriable;
  } else if (result.failureKind === "suspend") {

    const retriable: false = result.retriable;
    void retriable;
  } else if (result.failureKind === "invalid-target") {

    const retriable: boolean = result.retriable;
    void retriable;
  } else {

    const retriable: boolean = result.retriable;
    void retriable;
  }
}

void assertNarrowing;



// @ts-expect-error 成功不能请求重试
const invalidSuccess: ProviderSendResult = { ok: true, retriable: true };

// @ts-expect-error 成功不能携带挂起分类
const classifiedSuccess: ProviderSendResult = { ok: true, retriable: false, failureKind: 'suspend' };

// @ts-expect-error 挂起不能请求业务重试
const retryingSuspend: ProviderSendResult = { ok: false, retriable: true, failureKind: 'suspend' };

// @ts-expect-error 成功不能携带设备失效分类
const invalidTargetSuccess: ProviderSendResult = { ok: true, retriable: false, failureKind: 'invalid-target' };

// @ts-expect-error 未知 failureKind 不被接受
const unknownFailureKind: ProviderSendResult = { ok: false, retriable: false, failureKind: 'unknown-kind' };


const invalidSuccessShape = { ok: true, retriable: true };
// @ts-expect-error 具名变量的非法组合不能被收窄绕过
const namedInvalidSuccess: ProviderSendResult = invalidSuccessShape;

void [invalidSuccess, classifiedSuccess, retryingSuspend, invalidTargetSuccess, unknownFailureKind, namedInvalidSuccess];




const acmePlatform: PushPlatform = "acme-push";
const legacyPlatform: PushPlatform = "legacy-vendor";
void [acmePlatform, legacyPlatform];

const probeProvider: PushProvider = {
  name: "acme-push",
  send: async () => ({ ok: true, retriable: false })
};
const probePolicy: PushDeliveryPolicy = { maxRetries: 3, retryBackoffMs: 2000 };


const resolutionReady: ProviderResolution = {
  status: "ready",
  provider: probeProvider,
  policy: probePolicy
};
const resolutionDisabled: ProviderResolution = {
  status: "disabled",
  provider: null,
  policy: probePolicy
};
const resolutionInitFailed: ProviderResolution = {
  status: "init-failed",
  provider: null,
  policy: probePolicy
};
const resolutionUnregistered: ProviderResolution = {
  status: "unregistered",
  provider: null,
  policy: null
};
void [resolutionReady, resolutionDisabled, resolutionInitFailed, resolutionUnregistered];


function assertResolutionNarrowing(resolution: ProviderResolution): void {
  if (resolution.status === "ready") {
    const provider: PushProvider = resolution.provider;
    const policy: PushDeliveryPolicy = resolution.policy;
    void provider;
    void policy;
  } else if (resolution.status === "unregistered") {

    const provider: null = resolution.provider;
    const policy: null = resolution.policy;
    void provider;
    void policy;
  } else {

    const provider: null = resolution.provider;
    const policy: PushDeliveryPolicy = resolution.policy;
    void provider;
    void policy;
  }
}
void assertResolutionNarrowing;


const resolverProbe: ProviderResolver = {
  get: (platform: PushPlatform): PushProvider | null => (platform === "acme-push" ? probeProvider : null),
  getPolicy: (platform: PushPlatform): PushDeliveryPolicy | null =>
    platform === "acme-push" ? probePolicy : null,
  resolve: (platform: PushPlatform): ProviderResolution =>
    platform === "acme-push"
      ? { status: "ready", provider: probeProvider, policy: probePolicy }
      : { status: "unregistered", provider: null, policy: null }
};
void resolverProbe;



// @ts-expect-error unregistered 不能携带 policy
const unregisteredWithPolicy: ProviderResolution = { status: "unregistered", provider: null, policy: probePolicy };

// @ts-expect-error unregistered 不能携带 provider
const unregisteredWithProvider: ProviderResolution = { status: "unregistered", provider: probeProvider, policy: null };

// @ts-expect-error ready 必须携带 provider
const readyWithoutProvider: ProviderResolution = { status: "ready", provider: null, policy: probePolicy };

// @ts-expect-error ready 不能省略 policy
const readyWithoutPolicy: ProviderResolution = { status: "ready", provider: probeProvider };

// @ts-expect-error disabled 不能携带 provider
const disabledWithProvider: ProviderResolution = { status: "disabled", provider: probeProvider, policy: probePolicy };

// @ts-expect-error 未知状态值不被接受
const unknownResolutionStatus: ProviderResolution = { status: "paused", provider: null, policy: probePolicy };


const badResolutionShape = { status: "ready", provider: null, policy: probePolicy };
// @ts-expect-error 具名变量的非法组合不能被绕过
const namedBadResolution: ProviderResolution = badResolutionShape;

void [
  unregisteredWithPolicy,
  unregisteredWithProvider,
  readyWithoutProvider,
  readyWithoutPolicy,
  disabledWithProvider,
  unknownResolutionStatus,
  namedBadResolution
];

export {};
