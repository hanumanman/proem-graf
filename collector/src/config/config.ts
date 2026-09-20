import { parse as parseYaml } from "yaml";

export type AggregationFunction =
  | "average"
  | "max"
  | "min"
  | "sum"
  | "std"
  | "raw"
  | "delta"
  | "count"
  | "avg_serial_diff"
  | "cumulative_sum";

export interface MachineConfig {
  id: string;
  name: string;
}

export interface CollectorConfig {
  pollIntervalMs: number;
  bucketSizeMs: number;
  overlapBuckets: number;
  aggregationFunction: AggregationFunction;
  machines: MachineConfig[];
  signals: string[];
}

export interface ProemionConfig {
  baseUrl: string;
  tokenUrl: string;
  clientId: string;
  clientSecret: string;
}

export interface InfluxConfig {
  host: string;
  database: string;
  token: string;
}

export interface AppConfig {
  collector: CollectorConfig;
  proemion: ProemionConfig;
  influx: InfluxConfig;
}

const AGGREGATION_FUNCTIONS: ReadonlySet<string> = new Set([
  "average",
  "max",
  "min",
  "sum",
  "std",
  "raw",
  "delta",
  "count",
  "avg_serial_diff",
  "cumulative_sum",
]);

function isPositiveInteger(yamlValue: unknown): yamlValue is number {
  return (
    typeof yamlValue === "number" &&
    Number.isInteger(yamlValue) &&
    yamlValue > 0
  );
}

function requirePositiveInteger(yamlValue: unknown, yamlField: string): number {
  if (!isPositiveInteger(yamlValue)) {
    throw new Error(`collector.yaml: ${yamlField} must be a positive integer`);
  }
  return yamlValue;
}

function isNonEmptyArray(yamlValue: unknown): yamlValue is unknown[] {
  return Array.isArray(yamlValue) && yamlValue.length > 0;
}

function parseNonEmptyList(yamlValue: unknown, yamlField: string): unknown[] {
  if (!isNonEmptyArray(yamlValue)) {
    throw new Error(`collector.yaml: ${yamlField} must be a non-empty list`);
  }
  return yamlValue;
}

function isMachineRecord(item: unknown): item is Record<string, string> {
  return (
    typeof item === "object" &&
    item !== null &&
    typeof (item as Record<string, unknown>).id === "string" &&
    typeof (item as Record<string, unknown>).name === "string"
  );
}

function parseMachineConfigs(yamlValue: unknown): MachineConfig[] {
  const items = parseNonEmptyList(yamlValue, "machines");
  return items.map((item, index) => {
    if (!isMachineRecord(item)) {
      throw new Error(
        `collector.yaml: machines[${index}] must have string id and name`,
      );
    }
    return { id: item.id, name: item.name };
  });
}

function parseSignalKeys(yamlValue: unknown): string[] {
  const items = parseNonEmptyList(yamlValue, "signals");
  return items.map((item, index) => {
    if (typeof item !== "string" || item.length === 0) {
      throw new Error(`collector.yaml: signals[${index}] must be a string`);
    }
    return item;
  });
}

function parseAggregationFunction(yamlValue: unknown): AggregationFunction {
  if (typeof yamlValue !== "string" || !AGGREGATION_FUNCTIONS.has(yamlValue)) {
    throw new Error(
      `collector.yaml: aggregationFunction must be one of ${[...AGGREGATION_FUNCTIONS].join(", ")}`,
    );
  }
  return yamlValue as AggregationFunction;
}

export function parseCollectorConfig(yamlText: string): CollectorConfig {
  const rawConfig = parseYaml(yamlText) as Record<string, unknown>;
  if (typeof rawConfig !== "object" || rawConfig === null) {
    throw new Error("collector.yaml: root must be a mapping");
  }
  return {
    pollIntervalMs:
      requirePositiveInteger(rawConfig.pollIntervalSeconds, "pollIntervalSeconds") *
      1000,
    bucketSizeMs:
      requirePositiveInteger(rawConfig.bucketSizeSeconds, "bucketSizeSeconds") *
      1000,
    overlapBuckets: requirePositiveInteger(
      rawConfig.overlapBuckets,
      "overlapBuckets",
    ),
    aggregationFunction: parseAggregationFunction(rawConfig.aggregationFunction),
    machines: parseMachineConfigs(rawConfig.machines),
    signals: parseSignalKeys(rawConfig.signals),
  };
}
