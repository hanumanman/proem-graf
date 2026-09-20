import type { AggregationFunction } from "../config/config.ts";
import type { TimeseriesQuery } from "../proemion/types.ts";

export interface SeriesTarget {
  machineId: string;
  machineName: string;
  signalKey: string;
  unit: string;
}

export type SeriesIndex = Map<string, Map<string, SeriesTarget>>;

export function buildSeriesIndex(targets: SeriesTarget[]): SeriesIndex {
  const index: SeriesIndex = new Map();
  for (const target of targets) {
    let bySignal = index.get(target.machineId);
    if (!bySignal) {
      bySignal = new Map();
      index.set(target.machineId, bySignal);
    }
    bySignal.set(target.signalKey, target);
  }
  return index;
}

export function findSeries(
  index: SeriesIndex,
  machineId: string,
  signalKey: string,
): SeriesTarget | undefined {
  return index.get(machineId)?.get(signalKey);
}

export function buildQueries(
  targets: SeriesTarget[],
  aggregationFunction: AggregationFunction,
): TimeseriesQuery[] {
  return targets.map((target) => ({
    signal: target.signalKey,
    aggregationFunction,
    groupBy: { type: "machine", id: target.machineId },
  }));
}
