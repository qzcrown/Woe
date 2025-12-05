export type Method = "GET" | "POST" | "PUT" | "DELETE";

export interface Endpoint {
  path: string;
  methods: Method[];
  produces?: string[];
  consumes?: string[];
}

export const expected: Endpoint[] = [
  { path: "/application", methods: ["GET", "POST"], consumes: ["application/json"], produces: ["application/json"] },
  { path: "/application/{id}", methods: ["PUT", "DELETE"], consumes: ["application/json"], produces: ["application/json"] },
  { path: "/application/{id}/image", methods: ["POST", "DELETE"], consumes: ["multipart/form-data"], produces: ["application/json"] },
  { path: "/application/{id}/message", methods: ["GET", "DELETE"], produces: ["application/json"] },
  { path: "/client", methods: ["GET", "POST"], consumes: ["application/json"], produces: ["application/json"] },
  { path: "/client/{id}", methods: ["PUT", "DELETE"], consumes: ["application/json"], produces: ["application/json"] },
  { path: "/current/user", methods: ["GET"], produces: ["application/json"] },
  { path: "/current/user/password", methods: ["POST"], consumes: ["application/json"], produces: ["application/json"] },
  { path: "/health", methods: ["GET"], produces: ["application/json"] },
  { path: "/message", methods: ["GET", "POST", "DELETE"], consumes: ["application/json"], produces: ["application/json"] },
  { path: "/message/{id}", methods: ["DELETE"], produces: ["application/json"] },
  { path: "/plugin", methods: ["GET"], produces: ["application/json"] },
  { path: "/plugin/{id}/config", methods: ["GET", "POST"], consumes: ["application/x-yaml"], produces: ["application/x-yaml", "application/json"] },
  { path: "/plugin/{id}/disable", methods: ["POST"], produces: ["application/json"] },
  { path: "/plugin/{id}/display", methods: ["GET"], produces: ["application/json"] },
  { path: "/plugin/{id}/enable", methods: ["POST"], produces: ["application/json"] },
  { path: "/stream", methods: ["GET"], produces: ["application/json"] },
  { path: "/user", methods: ["GET", "POST"], consumes: ["application/json"], produces: ["application/json"] },
  { path: "/user/{id}", methods: ["GET", "POST", "PUT", "DELETE"], consumes: ["application/json"], produces: ["application/json"] },
  { path: "/version", methods: ["GET"], produces: ["application/json"] }
];

export function runContractSnapshot(): Endpoint[] {
  return expected;
}
