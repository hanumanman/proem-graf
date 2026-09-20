export interface SignalDatapoint {
  machineId: string;
  machineName: string;
  signalKey: string;
  unit: string;
  timeMs: number;
  value: number;
}

export const MEASUREMENT = "signal";

export function escapeTagValue(tagValue: string): string {
  return tagValue
    .replaceAll("\\", "\\\\")
    .replaceAll(",", "\\,")
    .replaceAll("=", "\\=")
    .replaceAll(" ", "\\ ");
}

export function formatTimestampNs(timeMs: number): string {
  if (!Number.isFinite(timeMs)) throw new Error("timeMs must be finite");
  return (BigInt(Math.round(timeMs)) * 1_000_000n).toString();
}

function assertFiniteValue(datapoint: SignalDatapoint): void {
  if (!Number.isFinite(datapoint.value)) {
    throw new Error(
      `non-finite value for ${datapoint.machineId}/${datapoint.signalKey}`,
    );
  }
}

function buildTagSet(datapoint: SignalDatapoint): string {
  const tags = [
    `machine_id=${escapeTagValue(datapoint.machineId)}`,
    `machine_name=${escapeTagValue(datapoint.machineName)}`,
    `signal_key=${escapeTagValue(datapoint.signalKey)}`,
    `unit=${escapeTagValue(datapoint.unit)}`,
  ].join(",");
  return tags;
}

export function buildLineProtocolLine(datapoint: SignalDatapoint): string {
  assertFiniteValue(datapoint);
  return `${MEASUREMENT},${buildTagSet(datapoint)} value=${datapoint.value} ${formatTimestampNs(datapoint.timeMs)}`;
}

export function buildLineProtocol(datapoints: SignalDatapoint[]): string[] {
  return datapoints.map(buildLineProtocolLine);
}
