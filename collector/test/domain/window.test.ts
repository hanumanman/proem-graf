import { describe, expect, test } from "bun:test";
import { alignToBucket, alignedWindow } from "../../src/domain/window.ts";

const SAMPLE_TIME_MS = 1_757_654_460_123;
const ALIGNED_SAMPLE_TIME_MS = 1_757_654_460_000;
const BUCKET_MS = 60_000;

describe("alignToBucket", () => {
  test("floors to the bucket grid", () => {
    expect(alignToBucket(SAMPLE_TIME_MS, BUCKET_MS)).toBe(ALIGNED_SAMPLE_TIME_MS);
  });

  test("keeps an already aligned timestamp", () => {
    expect(alignToBucket(ALIGNED_SAMPLE_TIME_MS, BUCKET_MS)).toBe(
      ALIGNED_SAMPLE_TIME_MS,
    );
  });

  test("is idempotent", () => {
    expect(alignToBucket(alignToBucket(SAMPLE_TIME_MS, BUCKET_MS), BUCKET_MS)).toBe(
      ALIGNED_SAMPLE_TIME_MS,
    );
  });

  test("rejects a non-positive bucket", () => {
    expect(() => alignToBucket(1_000, 0)).toThrow();
  });
});

describe("alignedWindow", () => {
  test("excludes the current incomplete bucket and overlaps prior buckets", () => {
    expect(alignedWindow(SAMPLE_TIME_MS, BUCKET_MS, 1)).toEqual({
      fromMs: 1_757_654_340_000,
      toMs: ALIGNED_SAMPLE_TIME_MS,
    });
  });

  test("spans overlap + 1 buckets", () => {
    const window = alignedWindow(ALIGNED_SAMPLE_TIME_MS, BUCKET_MS, 2);
    expect(window.toMs - window.fromMs).toBe(3 * BUCKET_MS);
  });

  test("rejects negative overlap", () => {
    expect(() => alignedWindow(1_000, BUCKET_MS, -1)).toThrow();
  });
});
