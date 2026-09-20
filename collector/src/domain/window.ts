export interface TimeWindow {
  fromMs: number;
  toMs: number;
}

export function alignToBucket(epochMs: number, bucketMs: number): number {
  if (!Number.isFinite(epochMs)) throw new Error("epochMs must be finite");
  if (!Number.isInteger(bucketMs) || bucketMs <= 0) {
    throw new Error("bucketMs must be a positive integer");
  }
  return Math.floor(epochMs / bucketMs) * bucketMs;
}

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
