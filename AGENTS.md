# AGENTS.md

## Commands (run in `collector/`)

- Install: `bun install`
- Test: `bun test` (full) or `bun test <filter>` (targeted, prefer this)
- Typecheck: `bun x tsc --noEmit`
- Discover: `bun run discover`
- Dry run: `bun run dry-run` (poll once, print line protocol, no write)
- Live: `bun run start`
- Backfill: `bun run backfill <fromISO> <toISO>`
- Influx query (run in root, `.env` loaded): `docker exec -e INFLUXDB3_AUTH_TOKEN=$INFLUX_ADMIN_TOKEN -i influxdb3-core influxdb3 query --database proemion "<SQL>"` (bare query 401s)

## Directory structure

- `collector/src/domain/` — pure math, no I/O. No `Date.now`, `Bun`, `process.env`, `fetch`. Only `import type` may cross out. Guard: `test/domain/purity.test.ts`.
- `collector/src/infra/` — I/O primitives: `http.ts` (retry), `clock.ts`, `logger.ts`. Single-use helpers live at their use site, not here.
- `collector/src/app/` — wiring: `poll.ts`, `loop.ts`, `backfill.ts`, `targets.ts`.
- `collector/src/cli/` — thin edges: `main.ts` (dispatch only), `discover.ts`.
- `collector/src/proemion/`, `src/influx/`, `src/config/`, `src/discover/` — adapters.
- `test/` mirrors `src/`.
- `grafana/provisioning/` — datasource + dashboards as files. No click-ops.
- Full spec: `plan.md`.

## Invariants (do not break)

- Grid anchored at epoch 0: `from`/`to` always `% bucketMs == 0`. `to` exclusive, never the in-progress bucket. One `Date.now()` per tick at the edge, passed down as `nowMs`.
- Upsert identity: measurement `signal`, tags `{machine_id, machine_name, signal_key, unit}`, timestamp `ms * 1e6` exact, field `value` always float. Re-write same window = same state.
- Never put volatile data in tags. Never re-align returned `time`.
- Caps: 350 queries/request, 25000 buckets/request, `limit: 10000`, backfill chunks of 1440 buckets (well under 25000).
- Truncated range (`totalDatapoints > timeseries.length`) aborts loudly, never stores a gap.
- Failure: log, do not advance `lastTo`, retry next tick. Loop never crashes.
- Logs: `createLogger(scope)` per module (`loop`, `poll`, `targets`, `discover`). No bare `console.*` in `src/` except `StdoutWriter` (dry-run output path, not logging).
- Time: edge reads `Date.now()` once per tick, passes `nowMs` down into pure functions. `Clock` is injected only where a test swaps it (`TokenProvider`, pinned by the 60s-early refresh test). No other time seams.
- Never commit `.env`. Secrets via env only.
