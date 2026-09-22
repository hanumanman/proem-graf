import pLimit from "p-limit";
import type { CollectorConfig } from "../config/config.ts";
import {
  buildQueries,
  findSeries,
  type SeriesIndex,
  type SeriesTarget,
} from "../domain/plan.ts";
import { buildLineProtocol, type SignalDatapoint } from "../domain/points.ts";
import { alignedWindow, type TimeWindow } from "../domain/window.ts";
import type { LineWriter } from "../influx/writer.ts";
import { createLogger } from "../infra/logger.ts";
import type { ProemionClient } from "../proemion/client.ts";
import type { TimeseriesResult } from "../proemion/types.ts";

const MAX_QUERIES_PER_REQUEST = 350;
const FETCH_CONCURRENCY = 3;

const logger = createLogger("poll");

export interface PollDeps {
  client: ProemionClient;
  writer: LineWriter;
  collector: CollectorConfig;
  targets: SeriesTarget[];
  index: SeriesIndex;
}

export function currentWindow(
  collector: CollectorConfig,
  nowMs: number,
): TimeWindow {
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

function chunk<T>(items: T[], chunkSize: number): T[][] {
  if (!Number.isInteger(chunkSize) || chunkSize <= 0) {
    throw new Error("chunkSize must be a positive integer");
  }
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += chunkSize) {
    chunks.push(items.slice(index, index + chunkSize));
  }
  return chunks;
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

export async function pollWindow(
  deps: PollDeps,
  window: TimeWindow,
): Promise<number> {
  const chunks = chunk(deps.targets, MAX_QUERIES_PER_REQUEST);
  const limit = pLimit(FETCH_CONCURRENCY);
  const fetched = await Promise.all(
    chunks.map((chunkTargets) =>
      limit(() => fetchChunk(deps, chunkTargets, window)),
    ),
  );
  let totalLines = 0;
  for (const datapoints of fetched) {
    const lines = buildLineProtocol(datapoints);
    await deps.writer.writeLines(lines);
    totalLines += lines.length;
  }
  logger.log(
    `window [${new Date(window.fromMs).toISOString()}, ${new Date(window.toMs).toISOString()}) -> ${totalLines} datapoints`,
  );
  return totalLines;
}
