import { join } from "node:path";
import { log } from "../infra/logger.ts";
import type { ProemionClient } from "../proemion/client.ts";
import type { Machine } from "../proemion/types.ts";
import {
  mergeSignal,
  serializeToCsv,
  sortSummaries,
  type SignalSummary,
} from "./summary.ts";

export async function fetchSignalSummaries(
  client: ProemionClient,
  machines: Machine[],
): Promise<SignalSummary[]> {
  const index = new Map<string, SignalSummary>();
  for (const machine of machines) {
    const signals = await client.fetchMachineSignals(machine.id);
    for (const signal of signals) mergeSignal(index, signal, machine.id);
    log(`fetched ${signals.length} signals for ${machine.id} (${machine.name})`);
  }
  return sortSummaries([...index.values()]);
}

export async function writeDiscovery(
  discoveryDir: string,
  machines: Machine[],
  summaries: SignalSummary[],
): Promise<void> {
  await Bun.write(
    join(discoveryDir, "machines.json"),
    JSON.stringify(
      { fetchedAt: new Date().toISOString(), machines },
      null,
      2,
    ) + "\n",
  );
  await Bun.write(join(discoveryDir, "signals.csv"), serializeToCsv(summaries));
}
