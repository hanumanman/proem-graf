import { describe, expect, test } from "bun:test";
import type { SeriesTarget } from "../../src/domain/plan.ts";
import {
  buildQueries,
  buildSeriesIndex,
  findSeries,
} from "../../src/domain/plan.ts";

const TARGET_A: SeriesTarget = {
  machineId: "m1",
  machineName: "Rig 1",
  signalKey: "value.Engine.Running",
  unit: "u",
};

const TARGET_B: SeriesTarget = {
  machineId: "m1",
  machineName: "Rig 1",
  signalKey: "value.Wind.Speed",
  unit: "u",
};

describe("buildSeriesIndex", () => {
  test("indexes by machine then signal", () => {
    const index = buildSeriesIndex([TARGET_A, TARGET_B]);
    expect(findSeries(index, "m1", "value.Engine.Running")).toEqual(TARGET_A);
    expect(findSeries(index, "m1", "value.Wind.Speed")).toEqual(TARGET_B);
  });

  test("returns undefined for missing", () => {
    const index = buildSeriesIndex([TARGET_A]);
    expect(findSeries(index, "m1", "missing")).toBeUndefined();
    expect(
      findSeries(index, "missing", "value.Engine.Running"),
    ).toBeUndefined();
  });
});

describe("buildQueries", () => {
  test("maps targets to queries", () => {
    expect(buildQueries([TARGET_A], "average")).toEqual([
      {
        signal: "value.Engine.Running",
        aggregationFunction: "average",
        groupBy: { type: "machine", id: "m1" },
      },
    ]);
  });
});
