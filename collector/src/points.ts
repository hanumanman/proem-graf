export interface SignalDatapoint {
  machineId: string;
  machineName: string;
  signalKey: string;
  unit: string;
  timeMs: number;
  value: number;
}

export const MEASUREMENT_NAME = "signal";

/** Escape InfluxDB tag special chars: backslash, comma, equals, space. */
export function escapeTagValue(rawValue: string): string {
  return rawValue
    .replaceAll("\\", "\\\\")
    .replaceAll(",", "\\,")
    .replaceAll("=", "\\=")
    .replaceAll(" ", "\\ ");
}

/**
 * Format epoch millis as integer nanosecond string for InfluxDB.
 * @throws Error when timeMs is non-finite.
 */
export function formatTimestampNs(timeMs: number): string {
  if (!Number.isFinite(timeMs)) throw new Error("timeMs must be finite");
  return (BigInt(Math.round(timeMs)) * 1_000_000n).toString();
}

/**
 * Build InfluxDB line protocol line. Skips nothing, rejects non-finite value.
 * @throws Error when value is non-finite.
 */
export function buildLineProtocolLine(datapoint: SignalDatapoint): string {
  if (!Number.isFinite(datapoint.value)) {
    throw new Error(
      `non-finite value for ${datapoint.machineId}/${datapoint.signalKey}`,
    );
  }
  const tags = [
    `machine_id=${escapeTagValue(datapoint.machineId)}`,
    `machine_name=${escapeTagValue(datapoint.machineName)}`,
    `signal_key=${escapeTagValue(datapoint.signalKey)}`,
    `unit=${escapeTagValue(datapoint.unit)}`,
  ].join(",");
  return `${MEASUREMENT_NAME},${tags} value=${datapoint.value} ${formatTimestampNs(datapoint.timeMs)}`;
}

export function buildLineProtocol(datapoints: SignalDatapoint[]): string[] {
  return datapoints.map(buildLineProtocolLine);
}
