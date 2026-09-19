import { loadAppConfig, type AppConfig } from "./config.ts";
import { InfluxWriter } from "./influx.ts";
import {
  ProemionClient,
  type Signal,
  type TimeseriesQuery,
} from "./proemion.ts";
import { buildLineProtocol, type SignalDatapoint } from "./points.ts";
import { alignToBucket, alignedWindow, type TimeWindow } from "./window.ts";

/** Max timeseries queries per API request. Bounds payload size. */
const MAX_QUERIES_PER_REQUEST = 350;
/** Buckets per backfill chunk. Bounds each request window. */
const BACKFILL_CHUNK_BUCKETS = 1440;
const PLANNED_SIGNAL_KEY_SEPARATOR = "\u0000";

interface PlannedSignal {
  machineId: string;
  machineName: string;
  signalKey: string;
  unit: string;
}

function chunkArray<T>(items: T[], chunkSize: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += chunkSize) {
    chunks.push(items.slice(index, index + chunkSize));
  }
  return chunks;
}

/** Join machine and signal with NUL so keys cannot collide. */
function plannedSignalKey(machineId: string, signalKey: string): string {
  return `${machineId}${PLANNED_SIGNAL_KEY_SEPARATOR}${signalKey}`;
}

async function buildPlan(
  proemionClient: ProemionClient,
  config: AppConfig,
): Promise<PlannedSignal[]> {
  const allowedSignals = new Set(config.collector.signals);
  const plannedSignals: PlannedSignal[] = [];

  for (const machine of config.collector.machines) {
    const machineSignals: Signal[] =
      await proemionClient.fetchMachineSignals(machine.id);
    const allowedMachineSignals = machineSignals.filter((machineSignal) =>
      allowedSignals.has(machineSignal.key),
    );
    for (const machineSignal of allowedMachineSignals) {
      plannedSignals.push({
        machineId: machine.id,
        machineName: machine.name,
        signalKey: machineSignal.key,
        unit: machineSignal.unit?.key ?? "",
      });
    }
    console.error(
      `planned ${allowedMachineSignals.length} signals for ${machine.id} (${machine.name})`,
    );
  }

  return plannedSignals;
}

function buildQueries(
  plannedSignals: PlannedSignal[],
  aggregationFunction: AppConfig["collector"]["aggregationFunction"],
): TimeseriesQuery[] {
  return plannedSignals.map((plannedSignal) => ({
    signal: plannedSignal.signalKey,
    aggregationFunction,
    groupBy: { type: "machine", id: plannedSignal.machineId },
  }));
}

/** Map API results to datapoints. Drops null and non-finite values. */
function toDatapoints(
  results: Awaited<ReturnType<ProemionClient["fetchTimeseries"]>>,
  plannedSignalsByKey: Map<string, PlannedSignal>,
): SignalDatapoint[] {
  const datapoints: SignalDatapoint[] = [];
  for (const result of results) {
    const plannedSignal = plannedSignalsByKey.get(
      plannedSignalKey(result.id, result.signal),
    );
    if (!plannedSignal) continue;
    for (const datapoint of result.timeseries) {
      if (datapoint.value === null || !Number.isFinite(datapoint.value)) continue;
      datapoints.push({
        machineId: plannedSignal.machineId,
        machineName: plannedSignal.machineName,
        signalKey: plannedSignal.signalKey,
        unit: plannedSignal.unit,
        timeMs: datapoint.time,
        value: datapoint.value,
      });
    }
  }
  return datapoints;
}

async function pollWindow(
  proemionClient: ProemionClient,
  influxWriter: InfluxWriter | null,
  config: AppConfig,
  plannedSignals: PlannedSignal[],
  plannedSignalsByKey: Map<string, PlannedSignal>,
  window: TimeWindow,
): Promise<void> {
  const { fromMs, toMs } = window;
  const queryChunks = chunkArray(plannedSignals, MAX_QUERIES_PER_REQUEST);
  let writtenDatapoints = 0;

  for (const queryChunk of queryChunks) {
    const results = await proemionClient.fetchTimeseries(
      fromMs,
      toMs,
      config.collector.bucketSizeMs,
      buildQueries(queryChunk, config.collector.aggregationFunction),
    );
    const datapoints = toDatapoints(results, plannedSignalsByKey);
    const lines = buildLineProtocol(datapoints);
    if (influxWriter) {
      await influxWriter.writeLines(lines);
    } else {
      for (const line of lines) console.log(line);
    }
    writtenDatapoints += lines.length;
  }

  console.error(
    `window [${new Date(fromMs).toISOString()}, ${new Date(toMs).toISOString()}) -> ${writtenDatapoints} datapoints`,
  );
}

async function runLoop(
  proemionClient: ProemionClient,
  influxWriter: InfluxWriter,
  config: AppConfig,
  plannedSignals: PlannedSignal[],
  plannedSignalsByKey: Map<string, PlannedSignal>,
): Promise<void> {
  for (;;) {
    try {
      await pollWindow(
        proemionClient,
        influxWriter,
        config,
        plannedSignals,
        plannedSignalsByKey,
        alignedWindow(
          Date.now(),
          config.collector.bucketSizeMs,
          config.collector.overlapBuckets,
        ),
      );
    } catch (error) {
      console.error("poll failed", error);
    }
    await Bun.sleep(config.collector.pollIntervalMs);
  }
}

/**
 * Backfill range in bucket-aligned chunks. Expands `toMs` to bucket edge
 * so partial trailing bucket is included.
 */
async function runBackfill(
  proemionClient: ProemionClient,
  influxWriter: InfluxWriter | null,
  config: AppConfig,
  plannedSignals: PlannedSignal[],
  plannedSignalsByKey: Map<string, PlannedSignal>,
  fromMs: number,
  toMs: number,
): Promise<void> {
  const { bucketSizeMs } = config.collector;
  const chunkSpanMs = BACKFILL_CHUNK_BUCKETS * bucketSizeMs;
  const alignedFromMs = alignToBucket(fromMs, bucketSizeMs);
  const alignedToMs =
    toMs % bucketSizeMs === 0
      ? toMs
      : alignToBucket(toMs, bucketSizeMs) + bucketSizeMs;

  for (let cursorMs = alignedFromMs; cursorMs < alignedToMs; cursorMs += chunkSpanMs) {
    const chunkToMs = Math.min(cursorMs + chunkSpanMs, alignedToMs);
    await pollWindow(
      proemionClient,
      influxWriter,
      config,
      plannedSignals,
      plannedSignalsByKey,
      { fromMs: cursorMs, toMs: chunkToMs },
    );
  }
}

function parseEpochMs(isoText: string, argumentName: string): number {
  const epochMs = Date.parse(isoText);
  if (Number.isNaN(epochMs)) {
    throw new Error(`${argumentName} is not a valid date: ${isoText}`);
  }
  return epochMs;
}

const rawArguments = process.argv.slice(2);
const isDryRun = rawArguments.includes("--dry-run");
const positionalArguments = rawArguments.filter(
  (rawArgument) => rawArgument !== "--dry-run",
);

const config = await loadAppConfig();
const proemionClient = new ProemionClient(
  config.proemion.baseUrl,
  config.proemion.tokenUrl,
  config.proemion.clientId,
  config.proemion.clientSecret,
);
const plannedSignals = await buildPlan(proemionClient, config);
const plannedSignalsByKey = new Map(
  plannedSignals.map((plannedSignal) => [
    plannedSignalKey(plannedSignal.machineId, plannedSignal.signalKey),
    plannedSignal,
  ]),
);
const influxWriter = isDryRun ? null : new InfluxWriter(config.influx);

const subcommand = positionalArguments[0];

if (subcommand === "backfill") {
  const fromMs = parseEpochMs(positionalArguments[1], "backfill from");
  const toMs = parseEpochMs(positionalArguments[2], "backfill to");
  await runBackfill(
    proemionClient,
    influxWriter,
    config,
    plannedSignals,
    plannedSignalsByKey,
    fromMs,
    toMs,
  );
} else if (isDryRun) {
  await pollWindow(
    proemionClient,
    null,
    config,
    plannedSignals,
    plannedSignalsByKey,
    alignedWindow(
      Date.now(),
      config.collector.bucketSizeMs,
      config.collector.overlapBuckets,
    ),
  );
} else {
  await runLoop(
    proemionClient,
    influxWriter as InfluxWriter,
    config,
    plannedSignals,
    plannedSignalsByKey,
  );
}
