import { describe, expect, test, afterEach } from "bun:test";
import { TokenProvider } from "../../src/proemion/token.ts";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("TokenProvider", () => {
  test("concurrent getToken sends exactly one POST", async () => {
    let calls = 0;
    globalThis.fetch = (async () => {
      calls += 1;
      await Bun.sleep(10);
      return new Response(
        JSON.stringify({ access_token: "tok", expires_in: 3600, token_type: "bearer" }),
        { status: 200 },
      );
    }) as unknown as typeof fetch;
    const provider = new TokenProvider("https://auth.test/t", "id", "secret");
    const [a, b, c] = await Promise.all([
      provider.getToken(),
      provider.getToken(),
      provider.getToken(),
    ]);
    expect(calls).toBe(1);
    expect([a, b, c]).toEqual(["tok", "tok", "tok"]);
  });

  test("cached token avoids second fetch", async () => {
    let calls = 0;
    globalThis.fetch = (async () => {
      calls += 1;
      return new Response(
        JSON.stringify({ access_token: "tok", expires_in: 3600, token_type: "bearer" }),
        { status: 200 },
      );
    }) as unknown as typeof fetch;
    const provider = new TokenProvider("https://auth.test/t", "id", "secret");
    await provider.getToken();
    await provider.getToken();
    expect(calls).toBe(1);
  });
});
