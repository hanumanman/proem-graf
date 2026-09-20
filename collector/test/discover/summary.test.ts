import { describe, expect, test } from "bun:test";
import {
  escapeCsvField,
  formatLogicalType,
  mergeSignal,
  serializeToCsv,
  sortSummaries,
} from "../../src/discover/summary.ts";
import type { Signal } from "../../src/proemion/types.ts";

function makeSignal(partial: Partial<Signal> = {}): Signal {
  return {
    key: "value.Wind.Speed",
    label: "Wind",
    type: "numeric",
    format: null,
    minValue: null,
    maxValue: null,
    unit: { key: "u", label: "u" },
    ...partial,
  };
}

describe("escapeCsvField", () => {
  test("quotes commas", () => {
    expect(escapeCsvField("a,b")).toBe('"a,b"');
  });

  test("leaves plain", () => {
    expect(escapeCsvField("abc")).toBe("abc");
  });
});

describe("formatLogicalType", () => {
  test("empty without type", () => {
    expect(formatLogicalType(makeSignal({ logicalType: undefined }))).toBe("");
  });

  test("type plus qualifier", () => {
    expect(
      formatLogicalType(makeSignal({ logicalType: { type: "counter", direction: "increasing" } })),
    ).toBe("counter:increasing");
  });
});

describe("mergeSignal", () => {
  test("merges machine ids", () => {
    const index = new Map();
    mergeSignal(index, makeSignal(), "m1");
    mergeSignal(index, makeSignal(), "m2");
    expect(index.get("value.Wind.Speed")?.machineIds).toEqual(["m1", "m2"]);
  });
});

describe("sortSummaries", () => {
  test("sorts by key", () => {
    const sorted = sortSummaries([
      { key: "b", label: "", type: "", unit: "", logicalType: "", machineIds: [] },
      { key: "a", label: "", type: "", unit: "", logicalType: "", machineIds: [] },
    ]);
    expect(sorted.map((s) => s.key)).toEqual(["a", "b"]);
  });
});

describe("serializeToCsv", () => {
  test("writes header plus rows", () => {
    const csv = serializeToCsv([
      { key: "k", label: "l", type: "numeric", unit: "u", logicalType: "", machineIds: ["m1"] },
    ]);
    expect(csv).toContain("key,label,type,unit,logicalType,machines");
    expect(csv).toContain("k,l,numeric,u,,m1");
  });
});
