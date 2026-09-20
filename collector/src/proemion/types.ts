import type { AggregationFunction } from "../config/config.ts";
import type { TimeWindow } from "../domain/window.ts";

export interface Organization {
  id: string;
  name: string;
  type: string;
}

export interface Machine {
  id: string;
  name: string;
  serial: string;
  vin: string | null;
  pin: string | null;
  organization: Organization;
}

export type SignalType = "numeric" | "string" | null;

export interface SignalUnit {
  key: string;
  label: string;
}

export interface LogicalType {
  type?: string;
  direction?: string;
  subType?: string;
}

export interface Signal {
  key: string;
  label: string;
  type: SignalType;
  format: string | null;
  minValue: number | null;
  maxValue: number | null;
  unit: SignalUnit;
  logicalType?: LogicalType;
}

export interface MachineGroupBy {
  type: "machine";
  id: string;
}

export interface TimeseriesQuery {
  signal: string;
  aggregationFunction: AggregationFunction;
  groupBy: MachineGroupBy;
}

export interface TimeseriesDatapoint {
  time: number;
  value: number | null;
}

export interface TimeseriesResult {
  type: string;
  id: string;
  signal: string;
  aggregationFunction: string;
  totalDatapoints: number;
  timeseries: TimeseriesDatapoint[];
}

export interface TimeseriesRequest {
  window: TimeWindow;
  bucketSizeMs: number;
  queries: TimeseriesQuery[];
  limit?: number;
}
