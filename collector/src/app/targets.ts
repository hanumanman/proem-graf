import type { AppConfig } from "../config/config.ts";
import { log } from "../infra/logger.ts";
import type { ProemionClient } from "../proemion/client.ts";
import type { Signal } from "../proemion/types.ts";
import type { SeriesTarget } from "../domain/plan.ts";

async function fetchAllowedForMachine(
  client: ProemionClient,
  machineId: string,
  machineName: string,
  allowed: Set<string>,
): Promise<SeriesTarget[]> {
  const signals: Signal[] = await client.fetchMachineSignals(machineId);
  const targets = signals
    .filter((signal) => allowed.has(signal.key))
    .map((signal) => ({
      machineId,
      machineName,
      signalKey: signal.key,
      unit: signal.unit?.key ?? "",
    }));
  log(`planned ${targets.length} signals for ${machineId} (${machineName})`);
  return targets;
}

export async function buildTargets(
  client: ProemionClient,
  config: AppConfig,
): Promise<SeriesTarget[]> {
  const allowed = new Set(config.collector.signals);
  const allTargets: SeriesTarget[][] = [];
  for (const machine of config.collector.machines) {
    allTargets.push(
      await fetchAllowedForMachine(client, machine.id, machine.name, allowed),
    );
  }
  return allTargets.flat();
}
