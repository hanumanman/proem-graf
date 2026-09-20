import { join } from "node:path";
import { installDotEnv } from "../config/dotenv.ts";
import {
  PROEMION_BASE_URL,
  PROEMION_TOKEN_URL,
  requireEnvVariable,
} from "../config/load.ts";
import { log } from "../infra/logger.ts";
import { ProemionClient } from "../proemion/client.ts";
import { TokenProvider } from "../proemion/token.ts";
import type { Machine } from "../proemion/types.ts";
import {
  fetchSignalSummaries,
  writeDiscovery,
} from "../discover/fetch.ts";

const MACHINE_PAGE_SIZE = 100;

async function fetchAllMachines(client: ProemionClient): Promise<Machine[]> {
  const total = await client.fetchMachineCount();
  const machines: Machine[] = [];
  for (let offset = 0; offset < total; offset += MACHINE_PAGE_SIZE) {
    const page = await client.fetchMachines(MACHINE_PAGE_SIZE, offset);
    machines.push(...page);
    if (page.length < MACHINE_PAGE_SIZE) break;
  }
  return machines;
}

function buildClient(): ProemionClient {
  const tokens = new TokenProvider(
    PROEMION_TOKEN_URL,
    requireEnvVariable("PROEMION_CLIENT_ID"),
    requireEnvVariable("PROEMION_CLIENT_SECRET"),
  );
  return new ProemionClient(PROEMION_BASE_URL, tokens);
}

async function run(): Promise<void> {
  await installDotEnv();
  const client = buildClient();
  const discoveryDir = join(import.meta.dir, "..", "..", "..", "discovery");
  const machines = await fetchAllMachines(client);
  const summaries = await fetchSignalSummaries(client, machines);
  await writeDiscovery(discoveryDir, machines, summaries);
  log(`wrote ${machines.length} machines to machines.json`);
  log(`wrote ${summaries.length} signals to signals.csv`);
}

await run();
