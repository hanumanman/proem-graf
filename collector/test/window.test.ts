import { describe, expect, test } from "bun:test";
import { alignToBucket, alignedWindow } from "../src/window.ts";

describe("alignToBucket", () => {
  test("floors to the bucket grid", () => {
    expect(alignToBucket(1_757_654_460_123, 60_000)).toBe(1_757_654_460_000);
  });

  test("keeps an already aligned timestamp", () => {
    expect(alignToBucket(1_757_654_460_000, 60_000)).toBe(1_757_654_460_000);
  });

  test("rejects a non-positive bucket", () => {
    expect(() => alignToBucket(1_000, 0)).toThrow();
  });
});

describe("alignedWindow", () => {
  test("excludes the current incomplete bucket and overlaps prior buckets", () => {
    expect(alignedWindow(1_757_654_460_123, 60_000, 1)).toEqual({
      fromMs: 1_757_654_340_000,
      toMs: 1_757_654_460_000,
    });
  });

  test("spans overlap + 1 buckets", () => {
    const window = alignedWindow(1_757_654_460_000, 60_000, 2);
    expect(window.toMs - window.fromMs).toBe(3 * 60_000);
  });

  test("rejects negative overlap", () => {
    expect(() => alignedWindow(1_000, 60_000, -1)).toThrow();
  });
});
