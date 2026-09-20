import { describe, expect, test } from "bun:test";
import {
  buildLineProtocol,
  buildLineProtocolLine,
  escapeTagValue,
  formatTimestampNs,
} from "../../src/domain/points.ts";

describe("escapeTagValue", () => {
  test("escapes spaces, commas, equals and backslashes", () => {
    expect(escapeTagValue("a b,c=d\\e")).toBe("a\\ b\\,c\\=d\\\\e");
  });

  test("escapes backslash before other specials", () => {
    expect(escapeTagValue("a\\b c")).toBe("a\\\\b\\ c");
  });

  test("leaves plain values untouched", () => {
    expect(escapeTagValue("value.clamp.30.voltage")).toBe(
      "value.clamp.30.voltage",
    );
  });
});

describe("formatTimestampNs", () => {
  test("converts epoch ms to nanoseconds", () => {
    expect(formatTimestampNs(1_757_654_460_000)).toBe("1757654460000000000");
  });

  test("scales by exactly 1e6 with no rounding of integers", () => {
    expect(formatTimestampNs(1)).toBe("1000000");
  });

  test("pins Math.round for fractional ms", () => {
    expect(formatTimestampNs(1.5)).toBe("2000000");
  });
});

describe("buildLineProtocolLine", () => {
  test("builds a signal line with tags, field and ns timestamp", () => {
    expect(
      buildLineProtocolLine({
        machineId: "209233",
        machineName: "CANlink 10000",
        signalKey: "value.clamp.30.voltage",
        unit: "predefined.unit.NUMBER",
        timeMs: 1_757_654_460_000,
        value: 13.8,
      }),
    ).toBe(
      "signal,machine_id=209233,machine_name=CANlink\\ 10000,signal_key=value.clamp.30.voltage,unit=predefined.unit.NUMBER value=13.8 1757654460000000000",
    );
  });

  test("rejects non-finite values", () => {
    expect(() =>
      buildLineProtocolLine({
        machineId: "1",
        machineName: "m",
        signalKey: "s",
        unit: "u",
        timeMs: 0,
        value: Number.NaN,
      }),
    ).toThrow();
  });
});

describe("buildLineProtocol", () => {
  test("maps every datapoint to a line", () => {
    const lines = buildLineProtocol([
      {
        machineId: "1",
        machineName: "m",
        signalKey: "s",
        unit: "u",
        timeMs: 0,
        value: 1,
      },
      {
        machineId: "1",
        machineName: "m",
        signalKey: "s",
        unit: "u",
        timeMs: 60_000,
        value: 2,
      },
    ]);
    expect(lines).toEqual([
      "signal,machine_id=1,machine_name=m,signal_key=s,unit=u value=1 0",
      "signal,machine_id=1,machine_name=m,signal_key=s,unit=u value=2 60000000000",
    ]);
  });
});
