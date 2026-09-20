import { describe, expect, test } from "bun:test";
import { chunk } from "../../src/infra/chunk.ts";

describe("chunk", () => {
  test("splits evenly", () => {
    expect(chunk([1, 2, 3, 4], 2)).toEqual([
      [1, 2],
      [3, 4],
    ]);
  });

  test("keeps remainder", () => {
    expect(chunk([1, 2, 3], 2)).toEqual([[1, 2], [3]]);
  });

  test("rejects non-positive size", () => {
    expect(() => chunk([1], 0)).toThrow();
  });
});
