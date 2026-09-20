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

Secrets come from the environment. Local runs load repo-root `.env` via Bun's `--env-file=../.env` flag in the npm scripts. App code only reads `Bun.env` and fails fast on missing vars.

Poll settings and the machine/signal allowlist live in `config/collector.yaml`.
