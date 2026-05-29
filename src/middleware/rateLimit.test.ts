import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { rateLimit } from "./rateLimit.js";

function mockResponse() {
  return {
    statusCode: 200,
    headers: {} as Record<string, string>,
    body: undefined as unknown,
    setHeader(name: string, value: string) {
      this.headers[name] = value;
    },
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(body: unknown) {
      this.body = body;
      return this;
    },
  };
}

describe("rateLimit middleware", () => {
  it("allows requests within the configured limit and blocks excess requests", () => {
    const middleware = rateLimit({ windowMs: 60_000, max: 2, message: "Too many requests" });
    const req = { ip: "127.0.0.1", method: "POST", baseUrl: "/api/auth", path: "/login" };
    let nextCalls = 0;

    const first = mockResponse();
    middleware(req as never, first as never, () => { nextCalls += 1; });
    const second = mockResponse();
    middleware(req as never, second as never, () => { nextCalls += 1; });
    const third = mockResponse();
    middleware(req as never, third as never, () => { nextCalls += 1; });

    assert.equal(nextCalls, 2);
    assert.equal(third.statusCode, 429);
    assert.deepEqual(third.body, { error: "Too many requests" });
    assert.ok(Number(third.headers["Retry-After"]) > 0);
  });
});
