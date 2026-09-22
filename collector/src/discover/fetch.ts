import { join } from "node:path";
import pLimit from "p-limit";
import { createLogger } from "../infra/logger.ts";
import type { ProemionClient } from "../proemion/client.ts";
import type { Machine } from "../proemion/types.ts";
import {
  mergeSignal,
  type SignalSummary,
  serializeToCsv,
  sortSummaries,
} from "./summary.ts";

const logger = createLogger("discover");

export async function fetchSignalSummaries(
  client: ProemionClient,
  machines: Machine[],
): Promise<SignalSummary[]> {
  const limit = pLimit(3);
  const perMachine = await Promise.all(
    machines.map((machine) =>
      limit(async () => ({
        machine,
        signals: await client.fetchMachineSignals(machine.id),
      })),
    ),
  );
  const index = new Map<string, SignalSummary>();
  for (const { machine, signals } of perMachine) {
    for (const signal of signals) mergeSignal(index, signal, machine.id);
    logger.log(
      `fetched ${signals.length} signals for ${machine.id} (${machine.name})`,
    );
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
    JSON.stringify({ fetchedAt: new Date().toISOString(), machines }, null, 2) +
      "\n",
  );
  await Bun.write(join(discoveryDir, "signals.csv"), serializeToCsv(summaries));
}
