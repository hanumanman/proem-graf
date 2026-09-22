import pLimit from "p-limit";
import type { AppConfig } from "../config/config.ts";
import type { SeriesTarget } from "../domain/plan.ts";
import { createLogger } from "../infra/logger.ts";
import type { ProemionClient } from "../proemion/client.ts";
import type { Signal } from "../proemion/types.ts";

const logger = createLogger("targets");

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
  logger.log(
    `planned ${targets.length} signals for ${machineId} (${machineName})`,
  );
  return targets;
}

export async function buildTargets(
  client: ProemionClient,
  config: AppConfig,
): Promise<SeriesTarget[]> {
  const allowed = new Set(config.collector.signals);
  const limit = pLimit(3);
  const allTargets = await Promise.all(
    config.collector.machines.map((machine) =>
      limit(() =>
        fetchAllowedForMachine(client, machine.id, machine.name, allowed),
      ),
    ),
  );
  return allTargets.flat();
}
