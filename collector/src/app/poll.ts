import type { CollectorConfig } from "../config/config.ts";
import { buildLineProtocol, type SignalDatapoint } from "../domain/points.ts";
import { buildQueries, findSeries, type SeriesIndex, type SeriesTarget } from "../domain/plan.ts";
import { alignedWindow, type TimeWindow } from "../domain/window.ts";
import { chunk } from "../infra/chunk.ts";
import { log } from "../infra/logger.ts";
import type { LineWriter } from "../influx/writer.ts";
import type { ProemionClient } from "../proemion/client.ts";
import type { TimeseriesResult } from "../proemion/types.ts";

const MAX_QUERIES_PER_REQUEST = 350;

export interface PollDeps {
  client: ProemionClient;
  writer: LineWriter;
  collector: CollectorConfig;
  targets: SeriesTarget[];
  index: SeriesIndex;
}

export function currentWindow(collector: CollectorConfig, nowMs: number): TimeWindow {
  return alignedWindow(nowMs, collector.bucketSizeMs, collector.overlapBuckets);
}

function isUsableValue(value: number | null): value is number {
  return value !== null && Number.isFinite(value);
}

function mapPoint(
  target: SeriesTarget,
  time: number,
  value: number,
): SignalDatapoint {
  return {
    machineId: target.machineId,
    machineName: target.machineName,
    signalKey: target.signalKey,
    unit: target.unit,
    timeMs: time,
    value,
  };
}

function assertNotTruncated(result: TimeseriesResult): void {
  if (result.totalDatapoints > result.timeseries.length) {
    throw new Error(
      `truncated range for ${result.id}/${result.signal}: total ${result.totalDatapoints} > returned ${result.timeseries.length}`,
    );
  }
}

function mapResultToDatapoints(
  result: TimeseriesResult,
  index: SeriesIndex,
): SignalDatapoint[] {
  const target = findSeries(index, result.id, result.signal);
  if (!target) return [];
  assertNotTruncated(result);
  const points: SignalDatapoint[] = [];
  for (const point of result.timeseries) {
    if (!isUsableValue(point.value)) continue;
    points.push(mapPoint(target, point.time, point.value));
  }
  return points;
}

export function toDatapoints(
  results: TimeseriesResult[],
  index: SeriesIndex,
): SignalDatapoint[] {
  return results.flatMap((result) => mapResultToDatapoints(result, index));
}

async function fetchChunk(
  deps: PollDeps,
  chunkTargets: SeriesTarget[],
  window: TimeWindow,
): Promise<SignalDatapoint[]> {
  const results = await deps.client.fetchTimeseries({
    window,
    bucketSizeMs: deps.collector.bucketSizeMs,
    queries: buildQueries(chunkTargets, deps.collector.aggregationFunction),
  });
  return toDatapoints(results, deps.index);
}

export async function pollWindow(deps: PollDeps, window: TimeWindow): Promise<number> {
  let totalLines = 0;
  for (const chunkTargets of chunk(deps.targets, MAX_QUERIES_PER_REQUEST)) {
    const datapoints = await fetchChunk(deps, chunkTargets, window);
    const lines = buildLineProtocol(datapoints);
    await deps.writer.writeLines(lines);
    totalLines += lines.length;
  }
  log(
    `window [${new Date(window.fromMs).toISOString()}, ${new Date(window.toMs).toISOString()}) -> ${totalLines} datapoints`,
  );
  return totalLines;
}
