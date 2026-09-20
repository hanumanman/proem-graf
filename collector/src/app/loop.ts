import { logError } from "../infra/logger.ts";
import { currentWindow, pollWindow, type PollDeps } from "./poll.ts";

async function pollOnce(deps: PollDeps): Promise<void> {
  await pollWindow(deps, currentWindow(deps.collector, Date.now()));
}

export async function runLoop(deps: PollDeps): Promise<void> {
  while (true) {
    try {
      await pollOnce(deps);
    } catch (error) {
      logError("poll failed", error);
    }
    await Bun.sleep(deps.collector.pollIntervalMs);
  }
}
