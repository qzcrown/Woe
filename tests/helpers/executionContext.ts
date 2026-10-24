








export type ExecutionCtxStub = ExecutionContext & { waitUntil: jest.Mock };

export function makeExecutionCtxStub(): ExecutionCtxStub {
  return {
    waitUntil: jest.fn(),
    passThroughOnException: jest.fn(),
    exports: {},
    props: {},
    tracing: undefined,
    abort: jest.fn(),
  } as unknown as ExecutionCtxStub;
}
