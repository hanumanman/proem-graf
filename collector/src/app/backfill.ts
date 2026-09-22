import { alignToBucket } from "../domain/window.ts";
import { type PollDeps, pollWindow } from "./poll.ts";

const BACKFILL_CHUNK_BUCKETS = 1440;

export function alignBackfillRange(
  fromMs: number,
  toMs: number,
  bucketSizeMs: number,
): { alignedFromMs: number; alignedToMs: number } {
  const alignedFromMs = alignToBucket(fromMs, bucketSizeMs);
  const alignedToMs =
    toMs % bucketSizeMs === 0
      ? toMs
      : alignToBucket(toMs, bucketSizeMs) + bucketSizeMs;
  return { alignedFromMs, alignedToMs };
}

export async function runBackfill(
  deps: PollDeps,
  fromMs: number,
  toMs: number,
): Promise<void> {
  const bucketSizeMs = deps.collector.bucketSizeMs;
  const chunkSpanMs = BACKFILL_CHUNK_BUCKETS * bucketSizeMs;
  const { alignedFromMs, alignedToMs } = alignBackfillRange(
    fromMs,
    toMs,
    bucketSizeMs,
  );
  for (
    let cursorMs = alignedFromMs;
    cursorMs < alignedToMs;
    cursorMs += chunkSpanMs
  ) {
    const chunkToMs = Math.min(cursorMs + chunkSpanMs, alignedToMs);
    await pollWindow(deps, { fromMs: cursorMs, toMs: chunkToMs });
  }
}
