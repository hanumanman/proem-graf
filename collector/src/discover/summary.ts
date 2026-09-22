import type { Signal } from "../proemion/types.ts";

export interface SignalSummary {
  key: string;
  label: string;
  type: string;
  unit: string;
  logicalType: string;
  machineIds: string[];
}

export function escapeCsvField(field: string): string {
  if (/[",\n]/.test(field)) {
    return `"${field.replaceAll('"', '""')}"`;
  }
  return field;
}

function logicalQualifier(signal: Signal): string {
  return signal.logicalType?.subType ?? signal.logicalType?.direction ?? "";
}

export function formatLogicalType(signal: Signal): string {
  const type = signal.logicalType?.type;
  if (!type) return "";
  const qualifier = logicalQualifier(signal);
  return qualifier ? `${type}:${qualifier}` : type;
}

function newSummary(signal: Signal, machineId: string): SignalSummary {
  return {
    key: signal.key,
    label: signal.label,
    type: signal.type ?? "",
    unit: signal.unit?.key ?? signal.unit?.label ?? "",
    logicalType: formatLogicalType(signal),
    machineIds: [machineId],
  };
}

export function mergeSignal(
  index: Map<string, SignalSummary>,
  signal: Signal,
  machineId: string,
): void {
  const existing = index.get(signal.key);
  if (existing) {
    existing.machineIds.push(machineId);
    return;
  }
  index.set(signal.key, newSummary(signal, machineId));
}

export function sortSummaries(summaries: SignalSummary[]): SignalSummary[] {
  return [...summaries].sort((left, right) =>
    left.key.localeCompare(right.key),
  );
}

function summaryToRow(summary: SignalSummary): string {
  return [
    summary.key,
    summary.label,
    summary.type,
    summary.unit,
    summary.logicalType,
    summary.machineIds.join(";"),
  ]
    .map(escapeCsvField)
    .join(",");
}

export function serializeToCsv(summaries: SignalSummary[]): string {
  const header = "key,label,type,unit,logicalType,machines";
  const rows = summaries.map(summaryToRow);
  return `${[header, ...rows].join("\n")}\n`;
}
