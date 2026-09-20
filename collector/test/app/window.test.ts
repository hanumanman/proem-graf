import { describe, expect, test } from "bun:test";
import { currentWindow, pollWindow, type PollDeps } from "../../src/app/poll.ts";
import { runBackfill } from "../../src/app/backfill.ts";
import { buildSeriesIndex } from "../../src/domain/plan.ts";
import type { CollectorConfig } from "../../src/config/config.ts";
import type { TimeWindow } from "../../src/domain/window.ts";
import type { ProemionClient } from "../../src/proemion/client.ts";
import type { TimeseriesResult } from "../../src/proemion/types.ts";

const BUCKET_MS = 60_000;
const CHUNK_SPAN_MS = 1440 * BUCKET_MS;

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

function makeDeps(batches: string[][], windows: TimeWindow[]): PollDeps {
  const collector = makeCollector();
  const targets = [{ machineId: "m1", machineName: "Rig", signalKey: "s1", unit: "u" }];
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
    writer: { writeLines: async (batch: string[]) => { batches.push(batch); } },
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

describe("pollWindow", () => {
  test("writes lines and returns count", async () => {
    const batches: string[][] = [];
    const windows: TimeWindow[] = [];
    const total = await pollWindow(makeDeps(batches, windows), { fromMs: 0, toMs: 60_000 });
    expect(total).toBe(1);
    expect(windows).toEqual([{ fromMs: 0, toMs: 60_000 }]);
    expect(batches).toHaveLength(1);
    expect(batches[0]).toHaveLength(1);
  });
});

describe("runBackfill", () => {
  test("walks single chunk with exact window", async () => {
    const batches: string[][] = [];
    const windows: TimeWindow[] = [];
    await runBackfill(makeDeps(batches, windows), 0, 60_000);
    expect(windows).toEqual([{ fromMs: 0, toMs: 60_000 }]);
  });

  test("splits multi-chunk range without gaps", async () => {
    const batches: string[][] = [];
    const windows: TimeWindow[] = [];
    await runBackfill(makeDeps(batches, windows), 0, 2 * CHUNK_SPAN_MS);
    expect(windows).toEqual([
      { fromMs: 0, toMs: CHUNK_SPAN_MS },
      { fromMs: CHUNK_SPAN_MS, toMs: 2 * CHUNK_SPAN_MS },
    ]);
  });
});
