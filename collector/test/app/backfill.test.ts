import { describe, expect, test } from "bun:test";
import { alignBackfillRange, runBackfill } from "../../src/app/backfill.ts";
import type { PollDeps } from "../../src/app/poll.ts";
import { buildSeriesIndex } from "../../src/domain/plan.ts";
import type { TimeWindow } from "../../src/domain/window.ts";
import type { ProemionClient } from "../../src/proemion/client.ts";
import type { TimeseriesResult } from "../../src/proemion/types.ts";

const BUCKET_MS = 60_000;
const CHUNK_SPAN_MS = 1440 * BUCKET_MS;

function makeDeps(batches: string[][], windows: TimeWindow[]): PollDeps {
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
    collector: {
      pollIntervalMs: 60_000,
      bucketSizeMs: BUCKET_MS,
      overlapBuckets: 1,
      aggregationFunction: "average",
      machines: [{ id: "m1", name: "Rig" }],
      signals: ["s1"],
    },
    targets,
    index: buildSeriesIndex(targets),
  };
}

describe("alignBackfillRange", () => {
  test("floors start and ceils end", () => {
    expect(alignBackfillRange(1_000, 61_000, 60_000)).toEqual({
      alignedFromMs: 0,
      alignedToMs: 120_000,
    });
  });

  test("keeps aligned end", () => {
    expect(alignBackfillRange(0, 60_000, 60_000)).toEqual({
      alignedFromMs: 0,
      alignedToMs: 60_000,
    });
  });

  test("is idempotent", () => {
    const once = alignBackfillRange(1_000, 61_000, 60_000);
    const twice = alignBackfillRange(once.alignedFromMs, once.alignedToMs, 60_000);
    expect(twice).toEqual(once);
  });

  test("chunks are contiguous with full coverage", async () => {
    const windows: TimeWindow[] = [];
    const client = {
      fetchTimeseries: async (request: { window: TimeWindow }) => {
        windows.push(request.window);
        return [];
      },
    } as unknown as ProemionClient;
    const targets = [{ machineId: "m1", machineName: "Rig", signalKey: "s1", unit: "u" }];
    const deps: PollDeps = {
      client,
      writer: { writeLines: async () => {} },
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
    // 3000 buckets forces 3 chunks of 1440/1440/120.
    await runBackfill(deps, 1_000, 3000 * 60_000 + 1_000);
    expect(windows).toHaveLength(3);
    for (let i = 0; i + 1 < windows.length; i += 1) {
      expect(windows[i + 1].fromMs).toBe(windows[i].toMs);
    }
    expect(windows[0].fromMs).toBe(0);
    expect(windows[windows.length - 1].toMs).toBe(3000 * 60_000 + 60_000);
    const covered = windows.reduce((sum, w) => sum + (w.toMs - w.fromMs), 0);
    expect(covered).toBe(windows[windows.length - 1].toMs - windows[0].fromMs);
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
