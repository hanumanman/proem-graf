import { z } from "zod";
import type {
  Machine,
  Signal,
  TimeseriesResult,
} from "./types.ts";

const tokenResponseSchema = z.object({
  access_token: z.string().min(1),
  expires_in: z.number().int().positive(),
  token_type: z.string(),
});

export interface TokenResponse {
  accessToken: string;
  expiresInSec: number;
}

export function parseTokenResponse(json: unknown): TokenResponse {
  const parsed = tokenResponseSchema.parse(json);
  return {
    accessToken: parsed.access_token,
    expiresInSec: parsed.expires_in,
  };
}

const organizationSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.string(),
});

const machineSchema = z.object({
  id: z.string(),
  name: z.string(),
  serial: z.string(),
  vin: z.string().nullable(),
  pin: z.string().nullable(),
  organization: organizationSchema,
});

const machineListSchema = z.array(machineSchema);

export function parseMachines(json: unknown): Machine[] {
  return machineListSchema.parse(json);
}

const machineCountSchema = z.number().int().nonnegative();

export function parseMachineCount(json: unknown): number {
  return machineCountSchema.parse(json);
}

const signalUnitSchema = z.object({
  key: z.string(),
  label: z.string(),
});

const logicalTypeSchema = z
  .object({
    type: z.string().optional(),
    direction: z.string().optional(),
    subType: z.string().optional(),
  })
  .optional();

const signalSchema = z.object({
  key: z.string(),
  label: z.string(),
  type: z.enum(["numeric", "string"]).nullable(),
  format: z.string().nullable(),
  minValue: z.number().nullable(),
  maxValue: z.number().nullable(),
  unit: signalUnitSchema,
  logicalType: logicalTypeSchema,
});

const signalListSchema = z.array(signalSchema);

export function parseSignals(json: unknown): Signal[] {
  return signalListSchema.parse(json);
}

const datapointSchema = z.object({
  time: z.number(),
  value: z.number().nullable(),
});

const timeseriesResultSchema = z.object({
  type: z.string(),
  id: z.string(),
  signal: z.string(),
  aggregationFunction: z.string(),
  totalDatapoints: z.number().int().nonnegative(),
  timeseries: z.array(datapointSchema),
});

const timeseriesListSchema = z.array(timeseriesResultSchema);

export function parseTimeseriesResults(json: unknown): TimeseriesResult[] {
  return timeseriesListSchema.parse(json);
}
