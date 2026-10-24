









import type { ProviderSendResult } from "../../src/services/push/contracts.ts";


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

export {};
