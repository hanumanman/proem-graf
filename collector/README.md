# collector

Polls the Proemion API and writes measurements to InfluxDB 3 Core.

## Commands

```bash
bun install
bun run discover                     # one-off: refresh discovery/machines.json and discovery/signals.csv
bun run test                         # window alignment + point building
bun run dry-run                      # poll once, print line protocol, no write
bun run start                        # poll loop, write to InfluxDB
bun run backfill <fromIso> <toIso>   # fetch + write a past range
```

Secrets load from repo-root `.env` via `installDotEnv()` in `src/config/dotenv.ts`, called explicitly from `src/cli/main.ts` and `src/cli/discover.ts`.

Poll settings and the machine/signal allowlist live in `config/collector.yaml`.
