import { createLogger } from "../infra/logger.ts";
import { currentWindow, pollWindow, type PollDeps } from "./poll.ts";

const logger = createLogger("loop");

async function pollOnce(deps: PollDeps): Promise<void> {
  await pollWindow(deps, currentWindow(deps.collector, Date.now()));
}

export async function runLoop(deps: PollDeps): Promise<void> {
  while (true) {
    try {
      await pollOnce(deps);
    } catch (error) {
      logger.logError("poll failed", error);
    }
    await Bun.sleep(deps.collector.pollIntervalMs);
  }
}
