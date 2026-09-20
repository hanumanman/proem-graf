import { describe, expect, test } from "bun:test";
import { readdir } from "node:fs/promises";

// domain/ is pure math: no I/O, no clock, no env, no fetch.
// Only `import type` may cross the boundary (erased at compile time).
const RUNTIME_APIS = ["Date.now(", "Bun.", "process.env", "fetch("];

describe("domain purity", () => {
  test("no runtime imports outside domain", async () => {
    const dir = new URL("../../src/domain/", import.meta.url);
    const files = (await readdir(dir)).filter((file) => file.endsWith(".ts"));
    expect(files.length).toBeGreaterThan(0);
    const violations: string[] = [];
    for (const file of files) {
      const text = await Bun.file(new URL(file, dir)).text();
      const withoutTypes = text.replace(/import\s+type\s+[^;]+;/g, "");
      const specs = [
        ...withoutTypes.matchAll(/import\s+(?:[^"']+\s+from\s+)?["']([^"']+)["']/g),
      ].map((match) => match[1]);
      for (const spec of specs) {
        if (spec.startsWith("./") || spec.startsWith("../domain/")) continue;
        violations.push(`${file}: runtime import from ${spec}`);
      }
    }
    expect(violations).toEqual([]);
  });

  test("no clock, env, or I/O access", async () => {
    const dir = new URL("../../src/domain/", import.meta.url);
    const files = (await readdir(dir)).filter((file) => file.endsWith(".ts"));
    const violations: string[] = [];
    for (const file of files) {
      const text = await Bun.file(new URL(file, dir)).text();
      for (const api of RUNTIME_APIS) {
        if (text.includes(api)) violations.push(`${file}: uses ${api}`);
      }
    }
    expect(violations).toEqual([]);
  });
});
