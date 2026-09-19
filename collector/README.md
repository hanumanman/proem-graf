# collector

Polls the Proemion API and writes measurements to InfluxDB 3 Core.

## Commands

```bash
bun install
bun run discover   # one-off: refresh discovery/machines.json and discovery/signals.csv
```

Secrets load from the repo-root `.env` through the `bunfig.toml` preload (`src/load-dot-env.ts`).
