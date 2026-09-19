import { join } from "node:path";
import { ProemionClient, type Machine, type Signal } from "./proemion.ts";

const PROEMION_API_BASE_URL = "https://dataportal.proemion.com/api/v26.7.0";
const PROEMION_AUTH_TOKEN_URL =
  "https://dataportal.proemion.com/api/auth/token";
const MACHINE_PAGE_SIZE = 100;

interface SignalSummary {
  signalKey: string;
  signalLabel: string;
  signalType: string;
  unitLabel: string;
  logicalTypeDescription: string;
  machineIds: string[];
}

function requireEnvVariable(variableName: string): string {
  const envValue = Bun.env[variableName];
  if (!envValue) throw new Error(`missing env var ${variableName}`);
  return envValue;
}

function escapeCsvField(rawField: string): string {
  if (/[",\n]/.test(rawField)) {
    return `"${rawField.replaceAll('"', '""')}"`;
  }
  return rawField;
}

function formatLogicalType(signal: Signal): string {
  const logicalType = signal.logicalType;
  if (!logicalType?.type) return "";
  const qualifier = logicalType.subType ?? logicalType.direction;
  return qualifier ? `${logicalType.type}:${qualifier}` : logicalType.type;
}

async function fetchAllMachines(
  proemionClient: ProemionClient,
): Promise<Machine[]> {
  const totalMachines = await proemionClient.fetchMachineCount();
  const allMachines: Machine[] = [];
  for (let offset = 0; offset < totalMachines; offset += MACHINE_PAGE_SIZE) {
    const machinePage = await proemionClient.fetchMachines(
      MACHINE_PAGE_SIZE,
      offset,
    );
    allMachines.push(...machinePage);
    if (machinePage.length < MACHINE_PAGE_SIZE) break;
  }
  return allMachines;
}

async function fetchSignalSummaries(
  proemionClient: ProemionClient,
  allMachines: Machine[],
): Promise<SignalSummary[]> {
  const summariesBySignalKey = new Map<string, SignalSummary>();

  for (const machine of allMachines) {
    const machineSignals = await proemionClient.fetchMachineSignals(machine.id);
    for (const machineSignal of machineSignals) {
      const existingSummary = summariesBySignalKey.get(machineSignal.key);
      if (existingSummary) {
        existingSummary.machineIds.push(machine.id);
        continue;
      }
      summariesBySignalKey.set(machineSignal.key, {
        signalKey: machineSignal.key,
        signalLabel: machineSignal.label,
        signalType: machineSignal.type ?? "",
        unitLabel: machineSignal.unit?.key ?? machineSignal.unit?.label ?? "",
        logicalTypeDescription: formatLogicalType(machineSignal),
        machineIds: [machine.id],
      });
    }
    console.error(
      `fetched ${machineSignals.length} signals for ${machine.id} (${machine.name})`,
    );
  }

  const sortedSummaries = [...summariesBySignalKey.values()].sort(
    (firstSummary, secondSummary) =>
      firstSummary.signalKey.localeCompare(secondSummary.signalKey),
  ); // sort alphabetically by key
  return sortedSummaries;
}

function serializeSignalSummariesToCsv(
  signalSummaries: SignalSummary[],
): string {
  const csvHeader = "key,label,type,unit,logicalType,machines";
  const csvRows = signalSummaries.map((signalSummary) =>
    [
      signalSummary.signalKey,
      signalSummary.signalLabel,
      signalSummary.signalType,
      signalSummary.unitLabel,
      signalSummary.logicalTypeDescription,
      signalSummary.machineIds.join(";"),
    ]
      .map(escapeCsvField)
      .join(","),
  );
  return [csvHeader, ...csvRows].join("\n") + "\n";
}

const proemionClient = new ProemionClient(
  PROEMION_API_BASE_URL,
  PROEMION_AUTH_TOKEN_URL,
  requireEnvVariable("PROEMION_CLIENT_ID"),
  requireEnvVariable("PROEMION_CLIENT_SECRET"),
);

const discoveryDir = join(import.meta.dir, "..", "..", "discovery");

const allMachines = await fetchAllMachines(proemionClient);
await Bun.write(
  join(discoveryDir, "machines.json"),
  JSON.stringify(
    { fetchedAt: new Date().toISOString(), machines: allMachines },
    null,
    2,
  ) + "\n",
);
console.error(`wrote ${allMachines.length} machines to machines.json`);

const signalSummaries = await fetchSignalSummaries(proemionClient, allMachines);
await Bun.write(
  join(discoveryDir, "signals.csv"),
  serializeSignalSummariesToCsv(signalSummaries),
);
console.error(`wrote ${signalSummaries.length} signals to signals.csv`);
