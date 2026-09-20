import { describe, expect, test } from "bun:test";
import { alignBackfillRange } from "../../src/app/backfill.ts";

describe("alignBackfillRange", () => {
  test("floors start and ceils end", () => {
    expect(alignBackfillRange(1_000, 61_000, 60_000)).toEqual({
      alignedFromMs: 0,
      alignedToMs: 120_000,
    });
  });

  test("keeps aligned end", () => {
    expect(alignBackfillRange(0, 60_000, 60_000)).toEqual({
      alignedFromMs: 0,
      alignedToMs: 60_000,
    });
  });
});
