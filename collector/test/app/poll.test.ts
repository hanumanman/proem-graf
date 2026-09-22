import { describe, expect, test } from "bun:test";
import {
  currentWindow,
  type PollDeps,
  pollWindow,
  toDatapoints,
} from "../../src/app/poll.ts";
import type { CollectorConfig } from "../../src/config/config.ts";
import { buildSeriesIndex, type SeriesTarget } from "../../src/domain/plan.ts";
import type { TimeWindow } from "../../src/domain/window.ts";
import type { ProemionClient } from "../../src/proemion/client.ts";
import type { TimeseriesResult } from "../../src/proemion/types.ts";

const BUCKET_MS = 60_000;

function makeCollector(): CollectorConfig {
  return {
    pollIntervalMs: 60_000,
    bucketSizeMs: BUCKET_MS,
    overlapBuckets: 1,
    aggregationFunction: "average",
    machines: [{ id: "m1", name: "Rig" }],
    signals: ["s1"],
  };
}

function makeSingleTargetDeps(
  batches: string[][],
  windows: TimeWindow[],
): PollDeps {
  const collector = makeCollector();
  const targets = [
    { machineId: "m1", machineName: "Rig", signalKey: "s1", unit: "u" },
  ];
  const result: TimeseriesResult = {
    type: "machine",
    id: "m1",
    signal: "s1",
    aggregationFunction: "average",
    totalDatapoints: 1,
    timeseries: [{ time: 60_000, value: 1 }],
  };
  const client = {
    fetchTimeseries: async (request: { window: TimeWindow }) => {
      windows.push(request.window);
      return [result];
    },
  } as unknown as ProemionClient;
  return {
    client,
    writer: {
      writeLines: async (batch: string[]) => {
        batches.push(batch);
      },
    },
    collector,
    targets,
    index: buildSeriesIndex(targets),
  };
}

describe("currentWindow", () => {
  test("returns exact grid-aligned bounds", () => {
    expect(currentWindow(makeCollector(), 120_000)).toEqual({
      fromMs: 0,
      toMs: 120_000,
    });
  });

  test("floors unaligned now onto grid", () => {
    expect(currentWindow(makeCollector(), 150_123)).toEqual({
      fromMs: 0,
      toMs: 120_000,
    });
  });
});

describe("toDatapoints", () => {
  test("drops unknown series and null values", () => {
    const index = buildSeriesIndex([
      { machineId: "m1", machineName: "Rig", signalKey: "s1", unit: "u" },
    ]);
    const results: TimeseriesResult[] = [
      {
        type: "machine",
        id: "m1",
        signal: "s1",
        aggregationFunction: "average",
        totalDatapoints: 3,
        timeseries: [
          { time: 1000, value: 1 },
          { time: 2000, value: null },
          { time: 3000, value: Number.NaN },
        ],
      },
      {
        type: "machine",
        id: "m1",
        signal: "unknown",
        aggregationFunction: "average",
        totalDatapoints: 1,
        timeseries: [{ time: 1000, value: 9 }],
      },
    ];
    const points = toDatapoints(results, index);
    expect(points).toEqual([
      {
        machineId: "m1",
        machineName: "Rig",
        signalKey: "s1",
        unit: "u",
        timeMs: 1000,
        value: 1,
      },
    ]);
  });

  test("aborts on truncated range instead of storing a gap", () => {
    const index = buildSeriesIndex([
      { machineId: "m1", machineName: "Rig", signalKey: "s1", unit: "u" },
    ]);
    const truncated: TimeseriesResult[] = [
      {
        type: "machine",
        id: "m1",
        signal: "s1",
        aggregationFunction: "average",
        totalDatapoints: 2,
        timeseries: [{ time: 1000, value: 1 }],
      },
    ];
    expect(() => toDatapoints(truncated, index)).toThrow(/truncated/);
  });
});

describe("pollWindow", () => {
  test("writes lines and returns count", async () => {
    const batches: string[][] = [];
    const windows: TimeWindow[] = [];
    const total = await pollWindow(makeSingleTargetDeps(batches, windows), {
      fromMs: 0,
      toMs: 60_000,
    });
    expect(total).toBe(1);
    expect(windows).toEqual([{ fromMs: 0, toMs: 60_000 }]);
    expect(batches).toHaveLength(1);
    expect(batches[0]).toHaveLength(1);
  });

  test("chunks 1201 targets at 350 per request in order", async () => {
    const targets: SeriesTarget[] = Array.from({ length: 1201 }, (_, i) => ({
      machineId: `m${i}`,
      machineName: `Rig ${i}`,
      signalKey: `s${i}`,
      unit: "u",
    }));
    const queryCounts: number[] = [];
    const firstIds: string[] = [];
    const client = {
      fetchTimeseries: async (request: {
        queries: { groupBy: { id: string } }[];
      }) => {
        queryCounts.push(request.queries.length);
        firstIds.push(request.queries[0].groupBy.id);
        return [];
      },
    } as unknown as ProemionClient;
    const batches: string[][] = [];
    const deps: PollDeps = {
      client,
      writer: {
        writeLines: async (batch: string[]) => {
          batches.push(batch);
        },
      },
      collector: {
        pollIntervalMs: 60_000,
        bucketSizeMs: 60_000,
        overlapBuckets: 1,
        aggregationFunction: "average",
        machines: [],
        signals: [],
      },
      targets,
      index: buildSeriesIndex(targets),
    };
    const total = await pollWindow(deps, { fromMs: 0, toMs: 60_000 });
    expect(total).toBe(0);
    expect(queryCounts).toEqual([350, 350, 350, 151]);
    expect(firstIds).toEqual(["m0", "m350", "m700", "m1050"]);
    expect(batches).toHaveLength(4);
  });
});
