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

const COLLECTOR_CONFIG_URL = new URL("../config/collector.yaml", import.meta.url);

const PROEMION_BASE_URL = "https://dataportal.proemion.com/api/v26.7.0";
const PROEMION_TOKEN_URL = "https://dataportal.proemion.com/api/auth/token";

const DEFAULT_INFLUX_HOST = "http://127.0.0.1:8181";
const DEFAULT_INFLUX_DATABASE = "proemion";

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

function requireEnvVariable(variableName: string): string {
  const envValue = Bun.env[variableName];
  if (!envValue) throw new Error(`missing env var ${variableName}`);
  return envValue;
}

function requirePositiveInteger(rawValue: unknown, fieldName: string): number {
  if (typeof rawValue !== "number" || !Number.isInteger(rawValue) || rawValue <= 0) {
    throw new Error(`collector.yaml: ${fieldName} must be a positive integer`);
  }
  return rawValue;
}

function parseMachineConfigs(rawValue: unknown): MachineConfig[] {
  if (!Array.isArray(rawValue) || rawValue.length === 0) {
    throw new Error("collector.yaml: machines must be a non-empty list");
  }
  return rawValue.map((rawMachine, index) => {
    if (
      typeof rawMachine !== "object" ||
      rawMachine === null ||
      typeof (rawMachine as Record<string, unknown>).id !== "string" ||
      typeof (rawMachine as Record<string, unknown>).name !== "string"
    ) {
      throw new Error(
        `collector.yaml: machines[${index}] must have string id and name`,
      );
    }
    return {
      id: (rawMachine as Record<string, string>).id,
      name: (rawMachine as Record<string, string>).name,
    };
  });
}

function parseSignalKeys(rawValue: unknown): string[] {
  if (!Array.isArray(rawValue) || rawValue.length === 0) {
    throw new Error("collector.yaml: signals must be a non-empty list");
  }
  return rawValue.map((rawSignal, index) => {
    if (typeof rawSignal !== "string" || rawSignal.length === 0) {
      throw new Error(`collector.yaml: signals[${index}] must be a string`);
    }
    return rawSignal;
  });
}

function parseAggregationFunction(rawValue: unknown): AggregationFunction {
  if (typeof rawValue !== "string" || !AGGREGATION_FUNCTIONS.has(rawValue)) {
    throw new Error(
      `collector.yaml: aggregationFunction must be one of ${[...AGGREGATION_FUNCTIONS].join(", ")}`,
    );
  }
  return rawValue as AggregationFunction;
}

/**
 * Parse collector.yaml. Converts `pollIntervalSeconds` / `bucketSizeSeconds`
 * to millis. Throws on missing or malformed fields.
 */
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

/**
 * Load config from `collector/config/collector.yaml` plus env.
 * Requires PROEMION_CLIENT_ID, PROEMION_CLIENT_SECRET, INFLUX_ADMIN_TOKEN.
 */
export async function loadAppConfig(): Promise<AppConfig> {
  const yamlText = await Bun.file(COLLECTOR_CONFIG_URL).text();
  return {
    collector: parseCollectorConfig(yamlText),
    proemion: {
      baseUrl: PROEMION_BASE_URL,
      tokenUrl: PROEMION_TOKEN_URL,
      clientId: requireEnvVariable("PROEMION_CLIENT_ID"),
      clientSecret: requireEnvVariable("PROEMION_CLIENT_SECRET"),
    },
    influx: {
      host: Bun.env.INFLUX_HOST ?? DEFAULT_INFLUX_HOST,
      database: Bun.env.INFLUX_DATABASE ?? DEFAULT_INFLUX_DATABASE,
      token: requireEnvVariable("INFLUX_ADMIN_TOKEN"),
    },
  };
}
