import { describe, expect, test } from "bun:test";
import { parseCollectorConfig } from "../../src/config/config.ts";

const BASE_YAML = `pollIntervalSeconds: 60
bucketSizeSeconds: 60
overlapBuckets: 1
aggregationFunction: average
machines:
  - id: "1"
    name: "Rig"
signals:
  - value.Wind.Speed
`;

describe("parseCollectorConfig", () => {
  test("converts seconds to ms", () => {
    const config = parseCollectorConfig(BASE_YAML);
    expect(config.pollIntervalMs).toBe(60_000);
    expect(config.bucketSizeMs).toBe(60_000);
    expect(config.overlapBuckets).toBe(1);
  });

  test("rejects bad aggregation", () => {
    expect(() =>
      parseCollectorConfig(BASE_YAML.replace("average", "nope")),
    ).toThrow();
  });

  test("rejects empty signals", () => {
    const bad = BASE_YAML.replace("- value.Wind.Speed", "[]");
    expect(() => parseCollectorConfig(bad)).toThrow();
  });

  test("rejects bad machine record", () => {
    const bad = BASE_YAML.replace('id: "1"', 'id: 1');
    expect(() => parseCollectorConfig(bad)).toThrow();
  });

  test("rejects bad signal entry", () => {
    const bad = BASE_YAML.replace("- value.Wind.Speed", "- 1");
    expect(() => parseCollectorConfig(bad)).toThrow();
  });

  test("rejects non-positive interval", () => {
    expect(() =>
      parseCollectorConfig(BASE_YAML.replace("pollIntervalSeconds: 60", "pollIntervalSeconds: 0")),
    ).toThrow();
  });
});
