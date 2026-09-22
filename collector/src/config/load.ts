import { type AppConfig, parseCollectorConfig } from "./config.ts";

export const PROEMION_BASE_URL = "https://dataportal.proemion.com/api/v26.7.0";
export const PROEMION_TOKEN_URL =
  "https://dataportal.proemion.com/api/auth/token";

const COLLECTOR_CONFIG_URL = new URL(
  "../../config/collector.yaml",
  import.meta.url,
);
const DEFAULT_INFLUX_HOST = "http://127.0.0.1:8181";
const DEFAULT_INFLUX_DATABASE = "proemion";

export function requireEnvVariable(envKey: string): string {
  const value = Bun.env[envKey];
  if (!value) throw new Error(`missing env var ${envKey}`);
  return value;
}

async function readCollectorYaml(): Promise<string> {
  return Bun.file(COLLECTOR_CONFIG_URL).text();
}

function loadProemionEnv(): AppConfig["proemion"] {
  return {
    baseUrl: PROEMION_BASE_URL,
    tokenUrl: PROEMION_TOKEN_URL,
    clientId: requireEnvVariable("PROEMION_CLIENT_ID"),
    clientSecret: requireEnvVariable("PROEMION_CLIENT_SECRET"),
  };
}

function loadInfluxEnv(): AppConfig["influx"] {
  return {
    host: Bun.env.INFLUX_HOST ?? DEFAULT_INFLUX_HOST,
    database: Bun.env.INFLUX_DATABASE ?? DEFAULT_INFLUX_DATABASE,
    token: requireEnvVariable("INFLUX_ADMIN_TOKEN"),
  };
}

export async function loadAppConfig(): Promise<AppConfig> {
  const yamlText = await readCollectorYaml();
  return {
    collector: parseCollectorConfig(yamlText),
    proemion: loadProemionEnv(),
    influx: loadInfluxEnv(),
  };
}
