/** Poll window. `toMs` exclusive, both epoch millis on bucket grid. */
export interface TimeWindow {
  fromMs: number;
  toMs: number;
}

/**
 * Floor timestamp to bucket grid so re-fetch is byte-identical.
 * @throws Error when inputs are not finite / positive.
 */
export function alignToBucket(epochMs: number, bucketMs: number): number {
  if (!Number.isFinite(epochMs)) throw new Error("epochMs must be finite");
  if (!Number.isInteger(bucketMs) || bucketMs <= 0) {
    throw new Error("bucketMs must be a positive integer");
  }
  return Math.floor(epochMs / bucketMs) * bucketMs;
}

/**
 * Build window ending at last complete bucket. Covers overlap + 1 buckets
 * so re-poll repairs late-arriving datapoints.
 */
export function alignedWindow(
  nowMs: number,
  bucketMs: number,
  overlapBuckets: number,
): TimeWindow {
  if (!Number.isInteger(overlapBuckets) || overlapBuckets < 0) {
    throw new Error("overlapBuckets must be a non-negative integer");
  }
  const toMs = alignToBucket(nowMs, bucketMs);
  const fromMs = toMs - (overlapBuckets + 1) * bucketMs;
  return { fromMs, toMs };
}
