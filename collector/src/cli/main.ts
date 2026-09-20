import { loadAppConfig } from "../config/load.ts";
import type { AppConfig } from "../config/config.ts";
import { installDotEnv } from "../config/dotenv.ts";
import { buildSeriesIndex } from "../domain/plan.ts";
import { InfluxWriter, StdoutWriter, type LineWriter } from "../influx/writer.ts";
import { ProemionClient } from "../proemion/client.ts";
import { TokenProvider } from "../proemion/token.ts";
import { runBackfill } from "../app/backfill.ts";
import { runLoop } from "../app/loop.ts";
import { currentWindow, pollWindow, type PollDeps } from "../app/poll.ts";
import { buildTargets } from "../app/targets.ts";

function parseEpochMs(isoText: string, argName: string): number {
  const epochMs = Date.parse(isoText);
  if (Number.isNaN(epochMs)) {
    throw new Error(`${argName} is not a valid date: ${isoText}`);
  }
  return epochMs;
}

interface CliArgs {
  dryRun: boolean;
  subcommand: string | undefined;
  backfillFrom: string | undefined;
  backfillTo: string | undefined;
}

function parseCliArgs(rawArgs: string[]): CliArgs {
  const dryRun = rawArgs.includes("--dry-run");
  const positional = rawArgs.filter((arg) => arg !== "--dry-run");
  return {
    dryRun,
    subcommand: positional[0],
    backfillFrom: positional[1],
    backfillTo: positional[2],
  };
}

async function buildDeps(config: AppConfig, writer: LineWriter): Promise<PollDeps> {
  const tokens = new TokenProvider(
    config.proemion.tokenUrl,
    config.proemion.clientId,
    config.proemion.clientSecret,
  );
  const client = new ProemionClient(config.proemion.baseUrl, tokens);
  const targets = await buildTargets(client, config);
  return {
    client,
    writer,
    collector: config.collector,
    targets,
    index: buildSeriesIndex(targets),
  };
}

async function runOnceDry(deps: PollDeps): Promise<void> {
  await pollWindow(deps, currentWindow(deps.collector, Date.now()));
}

async function runBackfillCommand(deps: PollDeps, args: CliArgs): Promise<void> {
  if (!args.backfillFrom || !args.backfillTo) {
    throw new Error("backfill requires <fromISO> <toISO>");
  }
  await runBackfill(
    deps,
    parseEpochMs(args.backfillFrom, "backfill from"),
    parseEpochMs(args.backfillTo, "backfill to"),
  );
}

async function main(): Promise<void> {
  await installDotEnv();
  const args = parseCliArgs(process.argv.slice(2));
  const config = await loadAppConfig();
  const writer: LineWriter = args.dryRun
    ? new StdoutWriter()
    : new InfluxWriter(config.influx);
  const deps = await buildDeps(config, writer);

  if (args.subcommand === "backfill") {
    await runBackfillCommand(deps, args);
  } else if (args.dryRun) {
    await runOnceDry(deps);
  } else {
    await runLoop(deps);
  }

  if (writer instanceof InfluxWriter) await writer.close();
}

await main();
