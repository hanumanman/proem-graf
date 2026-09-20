import { describe, expect, test } from "bun:test";
import {
  parseMachines,
  parseSignals,
  parseTimeseriesResults,
  parseTokenResponse,
} from "../../src/proemion/schemas.ts";

describe("proemion contracts", () => {
  test("maps token response to camelCase", () => {
    expect(
      parseTokenResponse({ access_token: "abc", expires_in: 3600, token_type: "bearer" }),
    ).toEqual({ accessToken: "abc", expiresInSec: 3600 });
  });

  test("parses machine payload", () => {
    const machine = {
      id: "209233",
      name: "Rig",
      serial: "S1",
      vin: null,
      pin: null,
      organization: { id: "o1", name: "Org", type: "t" },
    };
    expect(parseMachines([machine])).toEqual([machine]);
  });

  test("parses signal payload", () => {
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

  test("parses timeseries payload", () => {
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
});
