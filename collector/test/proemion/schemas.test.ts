import { describe, expect, test } from "bun:test";
import {
  parseMachineCount,
  parseMachines,
  parseSignals,
  parseTimeseriesResults,
  parseTokenResponse,
} from "../../src/proemion/schemas.ts";

const machine = {
  id: "209233",
  name: "Rig",
  serial: "S1",
  vin: null,
  pin: null,
  organization: { id: "o1", name: "Org", type: "t" },
};

describe("proemion schemas", () => {
  test("parses token response to camelCase", () => {
    expect(
      parseTokenResponse({ access_token: "abc", expires_in: 3600, token_type: "bearer" }),
    ).toEqual({ accessToken: "abc", expiresInSec: 3600 });
  });

  test("rejects token response without access_token", () => {
    expect(() => parseTokenResponse({ expires_in: 3600 })).toThrow();
  });

  test("parses one machine", () => {
    expect(parseMachines([machine])).toEqual([machine]);
  });

  test("rejects machine without id", () => {
    expect(() => parseMachines([{ ...machine, id: 5 }])).toThrow();
  });

  test("parses machine count", () => {
    expect(parseMachineCount(9)).toBe(9);
  });

  test("rejects string count", () => {
    expect(() => parseMachineCount("9")).toThrow();
  });

  test("parses numeric signal", () => {
    const signal = {
      key: "s1",
      label: "S1",
      type: "numeric" as const,
      format: null,
      minValue: null,
      maxValue: null,
      unit: { key: "V", label: "Volt" },
    };
    expect(parseSignals([signal])).toEqual([signal]);
  });

  test("rejects unknown signal type", () => {
    expect(() =>
      parseSignals([
        {
          key: "s1",
          label: "S1",
          type: "bool",
          format: null,
          minValue: null,
          maxValue: null,
          unit: { key: "V", label: "Volt" },
        },
      ]),
    ).toThrow();
  });

  test("parses timeseries result", () => {
    const result = {
      type: "machine",
      id: "m1",
      signal: "s1",
      aggregationFunction: "average",
      totalDatapoints: 1,
      timeseries: [{ time: 1000, value: 1.5 }],
    };
    expect(parseTimeseriesResults([result])).toEqual([result]);
  });

  test("rejects timeseries result without timeseries array", () => {
    expect(() =>
      parseTimeseriesResults([
        {
          type: "machine",
          id: "m1",
          signal: "s1",
          aggregationFunction: "average",
          totalDatapoints: 1,
        },
      ]),
    ).toThrow();
  });
});
