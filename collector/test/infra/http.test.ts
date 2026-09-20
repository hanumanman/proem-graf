import { describe, expect, test, afterEach } from "bun:test";
import { requestWithRetry } from "../../src/infra/http.ts";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("requestWithRetry", () => {
  test("succeeds after two 500s with exactly 3 calls", async () => {
    let calls = 0;
    globalThis.fetch = (async () => {
      calls += 1;
      if (calls < 3) return new Response("boom", { status: 500 });
      return jsonResponse({ ok: true }, 200);
    }) as unknown as typeof fetch;
    const res = await requestWithRetry("https://x.test/r", {}, "CTX", {
      baseDelayMs: 1,
    });
    expect(calls).toBe(3);
    expect(res.ok).toBe(true);
  });

  test("does not retry 400 and error includes status and body", async () => {
    let calls = 0;
    globalThis.fetch = (async () => {
      calls += 1;
      return new Response("bad-query", { status: 400 });
    }) as unknown as typeof fetch;
    const err = await requestWithRetry("https://x.test/r", {}, "CTX", {
      baseDelayMs: 1,
    }).catch((e: unknown) => e as Error);
    expect(calls).toBe(1);
    expect((err as Error).message).toBe("CTX failed: HTTP 400 bad-query");
  });

  test("retries network failure then succeeds", async () => {
    let calls = 0;
    globalThis.fetch = (async () => {
      calls += 1;
      if (calls === 1) throw new TypeError("down");
      return jsonResponse({ ok: true }, 200);
    }) as unknown as typeof fetch;
    const res = await requestWithRetry("https://x.test/r", {}, "CTX", {
      baseDelayMs: 1,
    });
    expect(calls).toBe(2);
    expect(res.ok).toBe(true);
  });

  test("gives up after maxRetries and reports attempt count", async () => {
    let calls = 0;
    globalThis.fetch = (async () => {
      calls += 1;
      throw new TypeError("down");
    }) as unknown as typeof fetch;
    const err = await requestWithRetry("https://x.test/r", {}, "CTX", {
      maxRetries: 2,
      baseDelayMs: 1,
    }).catch((e: unknown) => e as Error);
    expect(calls).toBe(3);
    expect((err as Error).message).toBe("CTX network failed after 3 attempts");
  });
});
