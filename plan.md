# Proemion → InfluxDB → Grafana

Pipeline: Proemion (source) → collector (TS, polls) → InfluxDB 3 Core (store) → Grafana (graphs + alerts).

```
Proemion API ──OAuth2 + POST /timeseries──> collector (TypeScript)
                                                  │ line protocol
                                                  ▼
                                           InfluxDB 3 Core :8181
                                                  ▲ SQL/FlightSQL
                                                  │
                                             Grafana :3000
```

Collector only Proemion client. Grafana never hits Proemion. Decouples load, enables history + alerting.

## 1. Proemion API

Spec: `openapi_proemion_26.7.0.json`. Data endpoints versioned in path: `https://dataportal.proemion.com/api/v26.7.0/...`. Current: **26.7.0**, supported until Jul 2027. Auth endpoint unversioned.

### Auth — OAuth2 client credentials

```
POST https://dataportal.proemion.com/api/auth/token
Content-Type: application/x-www-form-urlencoded

grant_type=client_credentials&client_id=<id>&client_secret=<secret>
```

Response: `{ "access_token": "...", "expires_in": 3600, "token_type": "bearer" }`. `expires_in` seconds.

Collector: cache token in memory, refresh 60s early. Creds from `PROEMION_CLIENT_ID` / `PROEMION_CLIENT_SECRET`.

### Machines / signals

- `GET /machines` → top-level JSON array: `id` (the `groupBy.id` in timeseries), `name`, `serial`, `vin`, `pin`, `organization`. Pagination `limit`/`offset`; `limit` without `offset` → HTTP 400. `GET /machines/count` → total.
- `GET /machines/{id}/signals` → `{key, label, type: numeric|string|null, format, minValue, maxValue, unit{key,label}, logicalType{counter|stateSignal}}`. `key` is ingest identifier. Also `GET /signals` global (no per-machine mapping).
- Output builds signal allowlist.

### POST /timeseries

Request:

```json
{
  "from": 1757654400000,
  "to": 1757658000000,
  "bucketSize": 60000,
  "limit": 10000,
  "queries": [
    {
      "signal": "value.clamp.30.voltage",
      "aggregationFunction": "average",
      "groupBy": { "type": "machine", "id": "ABC-1234" }
    }
  ]
}
```

- `from`/`to`: epoch ms.
- `bucketSize`: ms integer. ISO period strings (e.g. `P1D`) require `timeZone` — avoid, use ms. Max 25000 buckets between `from`/`to`.
- `limit`: max points per series. True total in `totalDatapoints`.
- `queries`: one entry per machine per signal. Max 350/request. `aggregationFunction`: `average|max|min|sum|std|raw|delta|count|avg_serial_diff|cumulative_sum`. `groupBy`: `{type:"machine", id}` (`id` = machine `id` from `/machines`). We use machine-scope only.

Response: array, one element per query:

```json
[
  {
    "type": "machine",
    "id": "ABC-1234",
    "signal": "value.clamp.30.voltage",
    "aggregationFunction": "average",
    "totalDatapoints": 2,
    "timeseries": [
      { "time": 1757654460000, "value": 13.8 },
      { "time": 1757654520000, "value": 13.9 }
    ]
  }
]
```

`timeseries[].{time,value}` is stored payload. `time` epoch ms.

## 2. Collector (TypeScript, Bun 1.2)

No build step (Bun runs TS directly). Installed deps: `@types/bun` only; `@influxdata/influxdb3-client` + `yaml` land in phase 3, `effect` in phase 7 (only when things work, if time remains). Test runner: `bun test`. Bun only auto-loads a cwd `.env`; root `.env` reaches the process via `bunfig.toml` preload (`src/load-dot-env.ts`), so no `--env-file` flag is needed.

### Loop (every tick)

1. Ensure valid Proemion token.
2. Compute aligned window (see below).
3. Build `/timeseries` request for all machines × allowed signals (chunk at 350 queries/request).
4. Parse response → points.
5. Write to InfluxDB.
6. Record last timestamp; sleep.

On failure: log, retry next tick. Never crash loop.

### Proemion client (`src/proemion.ts`) ✅

Types: `Organization`, `Machine`, `SignalType`, `SignalUnit`, `LogicalType`, `Signal`. Constructor `(baseUrl, tokenUrl, clientId, clientSecret)`.

Implemented: private `ensureValidAccessToken()` (cache, refresh 60s early) and `fetchJson<T>(path)` (Bearer GET, throw on non-2xx); public `fetchMachineCount()`, `fetchMachines(limit, offset)`, `fetchMachineSignals(machineId)`.

`timeseries(from, to, bucketSize, queries)` lands in phase 3.

```ts
private async ensureValidAccessToken(): Promise<string> {
  if (this.cachedAccessToken && Date.now() < this.accessTokenExpiresAtMs - 60_000) {
    return this.cachedAccessToken;
  }
  const authHttpResponse = await fetch(this.tokenUrl, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: this.clientId,
      client_secret: this.clientSecret,
    }),
  });
  if (!authHttpResponse.ok) throw new Error(`auth failed: HTTP ${authHttpResponse.status}`);
  const tokenBody = (await authHttpResponse.json()) as ProemionTokenResponse;
  this.cachedAccessToken = tokenBody.access_token;
  this.accessTokenExpiresAtMs = Date.now() + tokenBody.expires_in * 1000;
  return this.cachedAccessToken;
}
```

### Bucket alignment

Proemion returns 0 or 1 points per bucket. Buckets are half-open
`[from + k*bucketSize, from + (k+1)*bucketSize)` — `from` anchors the grid.
Two requests with different `from` put the same raw readings into different
buckets, under different timestamps.

Example: `bucketSize=60000`, tick 1 `from=12:00:37.123` → buckets `:37`,
`:37+60s`, … Tick 2 `from=12:05:00.000` → buckets `:00`, `:01`, …
Same event lands twice at different times in InfluxDB. Result: duplicate
series, stair-steps at poll boundaries, re-fetch never byte-identical.

Rules:

- Integer ms `bucketSize` only. Never ISO period strings (`P1D` needs
  `timeZone`, DST shifts boundaries, not re-fetch stable).
- Grid anchored at epoch 0: `alignDown(t) = floor(t / bucketMs) * bucketMs`.
  Deterministic across restarts, processes, backfills. For `bucketMs`
  dividing 60s (60s, 300s, …) this equals wall-clock alignment (`:00`).
- Align both bounds. `to` exclusive, `from` inclusive.
- Never query the in-progress bucket:
  `to = alignDown(now)`, `from = alignDown(now - spanMs - overlapMs)`.
  Derive both from a single `now = Date.now()` per tick (no skew).
- Steady-state size trivially under caps: e.g. 5min span + 2min overlap at
  60s buckets = 7 buckets (spec: keep < 100 for perf, hard cap 25000;
  backfill chunks to ≤ 1000, see below).
- `src/window.ts` is pure math, no I/O, no `Date.now()` inside:
  `alignDown(t, bucketMs)`, `alignedWindow(now, bucketMs, spanMs,
  overlapBuckets) → {from, to}`. Tests: `from % bucket == 0`,
  `to % bucket == 0`, `to - from == span + overlap`, idempotent
  `alignDown(alignDown(t)) == alignDown(t)`, unaligned `now` still lands
  on grid.

### Idempotency / backfill / overlap

InfluxDB upserts: same measurement + tagset + timestamp + field key
overwrites, never duplicates. Identity here:

- measurement `signal`, tags
  `{machine_id, machine_name, signal_key, unit}`, timestamp = Proemion
  `time * 1e6` (ns, exact, never client `now`), field `value` always float.

Re-write same window → same state. Collector is at-least-once by design:
crash between Proemion fetch and Influx write just re-fetches next tick.

Conditions to keep it true:

- Tags stable. `machine_name` is denormalized: a rename forks a new series,
  old points orphan (accepted, documented). Never put volatile data in tags.
- Field type stable: always write `value` as float, one field only.
- Timestamp exact: `ms * 1e6`, no rounding, no re-alignment on write.
  Alignment applies to request `from`/`to` only, never to returned `time`.

Overlap (late data):

- Why: machines buffer offline (cellular gaps), Proemion aggregation lands
  late, and the previous tick's trailing bucket was partial when read.
- Each tick re-fetches `overlapBuckets` (default 2, config `overlapBuckets`)
  before the last successful `to`: `nextFrom = lastTo - overlap*bucketMs`.
  First tick (no state): `from = alignDown(now - span - overlap)`.
  Cost: 2 extra buckets × 1201 series — negligible. Benefit: late points
  self-heal, partial trailing bucket converges to full average on next tick
  with no special-case code.

Backfill (same path, past range):

- Same `fetch → points → write` code as live poll, only `from`/`to` differ.
  Uses: initial history, downtime gap wider than overlap, new signal added
  to allowlist needing history.
- CLI `backfill <fromISO> <toISO>`: align both bounds down to grid, split
  into chunks of ≤ 1000 buckets (well under 25000-bucket cap and
  `limit:10000` per series), sequential chunks overlapping 1 bucket so no
  boundary loss. Each chunk fans out to ≤ 350 queries/request (4 requests
  per chunk at current 1201 series). Re-runnable: same input range → same
  points (grid + upsert), safe to resume by re-running the full range.
- `limit` guard: send `limit:10000`; after each response, if
  `totalDatapoints > timeseries.length`, the range was truncated (only
  possible with `raw`) → abort loudly, never silently store a gap. With
  aggregation this never fires; the check stays as invariant.

Failure semantics:

- Proemion 5xx or Influx write fail → log, do not advance `lastTo`, retry
  next tick with same overlap. Gap closes automatically.
- Never advance `lastTo` past an unwritten range. No gaps by construction,
  duplicates by design but harmless (upsert).

### Files (`collector/`)

- `src/config.ts` ✅ — env + `config/collector.yaml` (machines, allowlist, interval, aggregation, bucket, overlap).
- `src/proemion.ts` ✅ — token cache + machine/signal listing + `/timeseries`.
- `src/window.ts` ✅ — pure alignment math, no I/O.
- `src/points.ts` ✅ — series → line protocol (tags, escaping, ns timestamp).
- `src/influx.ts` ✅ — writes line protocol via `@influxdata/influxdb3-client` (`useV2Api: false`, Bearer).
- `src/main.ts` ✅ — loop + `backfill <from> <to>`, `--dry-run`.
- `src/discover.ts` ✅ — phase 2 one-off.
- `src/load-dot-env.ts` ✅ — preload; loads repo-root `.env` (wired in `bunfig.toml`).
- `test/` ✅ — alignment + point building.

`--dry-run`: print line protocol, no write.

### Point format

```
signal,machine_id=209233,machine_name=CANlink\ 10000,signal_key=value.Anti-Cavitation.Pressure,unit=predefined.unit.NUMBER value=13.8 1757654460000000000
```

`signal` = table. Tags: `machine_id,machine_name,signal_key,unit`. Field: `value`. Timestamp: ns (ms × 1e6). Escape spaces/commas/`=` in tag values. `machine_id` is the numeric `id` string from `/machines`; `unit` is the signal's `unit.key`.

### Effect migration (phase 7, deferred)

Deferred until pipeline works and time remains. Pure logic (`window.ts`, escaping) stays plain forever. Effect only for I/O, typed errors, scheduling, wiring. Details live under Phase 7 below.

## 3. InfluxDB 3 Core

Port **8181** (8086 = v2). Docker. DB: `proemion` (created explicitly).

Tags indexed, fields not. `machine_id`/`signal_key` must be tags.

### Schema — table `signal` (numeric)

| Part      | Name           | Example                      |
| --------- | -------------- | ---------------------------- |
| tag       | `machine_id`   | `ABC-1234`                   |
| tag       | `machine_name` | `Excavator 1` (denormalized) |
| tag       | `signal_key`   | `value.clamp.30.voltage`     |
| tag       | `unit`         | `V`                          |
| field     | `value`        | `13.8`                       |
| timestamp | `time`         | ns                           |

Second table `signal_state` for string/state signals only if discovery justifies. Numeric first.

Line protocol: escape spaces/commas/`=` in tag values. Send ns explicitly.

### Auth

First start: admin endpoint unauthenticated until operator token created. Bind to `127.0.0.1` during bootstrap. Create operator token via CLI → `.env`. Use operator token for collector writes + Grafana reads initially; split to read/write-scoped tokens in phase 6.

### Retention

Set at DB creation, **immutable** in Core. Default infinite. Min `1h`. Start infinite (7 machines = tiny volume). To change: create new DB + repoint, or Enterprise.

### Query file limit and memory

Core caps each query at `--query-file-limit` Parquet files (default `432`). At the default `gen1-duration` of 10 minutes that is ~3 days; a wider query fails with `Query would scan N Parquet files, exceeding the file limit`. Core has no compactor, so files accrue at up to 144/day (one per 10-minute bucket).

We raise the limit to `9000`. A **fixed-length** window has a bounded file count (`days × 144`), so 58 days ≤ 8352 files always fits — it does not decay as total data grows. Observed density ~136 files/day. The cost is memory: the file cap becomes an **OOM ceiling** that depends on query shape, not just range. Measured on a 58-day copy under a 2 GiB cap:

| Query shape (58d, 7899 files) | Peak | Result |
| ----------------------------- | ---- | ------ |
| `count(value)`                | 447 MiB | ok |
| `date_bin(...) + GROUP BY`    | ~1.9 GiB | ok, 93% of cap |
| `SELECT *`                    | — | OOM, exit 137 |

Aggregations survive; raw/wide materialization does not. Grafana fires several panels at once, so spikes add up.

Consequences:

- Every query must carry a time bound. Unbounded queries (`SELECT min(time)`, the old variable queries) scan all files and grow without limit.
- Keep dashboards within ~58 days. Default range stays `now-72h`.
- `mem_limit: 4g` on the Influx service so an OOM is a contained restart, not an 8 GiB VM-wide squeeze.

Proper fix is compaction: InfluxDB 3 **Enterprise** merges gen1 files; Core cannot. See config-options `#query-file-limit` and `#gen1-duration`.

### Query (SQL via DataFusion; no Flux — deprecated)

```sql
SELECT
  date_bin(INTERVAL '1 minute', time) AS time,
  machine_name,
  avg(value) AS value
FROM signal
WHERE $__timeFilter(time)
  AND signal_key = 'value.clamp.30.voltage'
GROUP BY 1, 2
ORDER BY 1
```

`date_bin` = query-time downsampling. `$__timeFilter` = Grafana macro for dashboard range. `GROUP BY 1,2` = one line per machine.

SQL in Grafana uses FlightSQL/gRPC → needs HTTP/2 + Grafana 12.2+. Running 13.2.1 — OK for local Docker (direct container link).

## 4. Grafana

### Datasource (provisioned YAML)

```yaml
apiVersion: 1
datasources:
  - name: InfluxDB-Proemion
    type: influxdb
    access: proxy
    url: http://influxdb3-core:8181
    jsonData:
      version: SQL
      dbName: proemion
      insecureGrpc: true # no TLS locally
    secureJsonData:
      token: ${INFLUX_ADMIN_TOKEN}
```

`influxdb3-core` = Compose service name.

### Dashboard — fleet overview (provisioned JSON)

- Variables: `machine` (distinct `machine_name`), `signal` (distinct `signal_key`). Panels filter by these.
- Time-series panel: §3 query parameterized by variables.
- Latest-value table: current reading per machine.

### Alerting

Unified alerting, runs headless on schedule (no dashboard open). Per rule: query → condition (e.g. last < 20) → pending period (e.g. 5m) → contact point.

Use **multi-dimensional rules**: one rule per signal, `GROUP BY machine_id`, fans out per machine.

Alert queries cannot use dashboard variables. Pin `signal_key` literally in rule query; machine stays a GROUP BY dimension.

Thresholds: domain input, defined post-discovery (phase 5).

## 5. Docker Compose

Services: `influxdb3-core` (:8181), `grafana` (:3000), `collector`. Shared network → address by service name. Persisted volumes for InfluxDB + Grafana.

## 6. Phases

### Phase 1 — Stand up stack ✅

`compose.yaml`, `.env.example`, `.gitignore`. Pins: `influxdb:3.11.2-core` (Docker `latest` now tracks 3 Core since Sep 15), `grafana/grafana:13.2.1` (note: `grafana-oss` repo stopped at 13.0.2). InfluxDB bound `127.0.0.1:8181`, operator token via `docker exec … influxdb3 create token --admin`, DB `proemion`, Grafana provisions SQL datasource (FlightSQL, `insecureGrpc`). Write endpoint: `/api/v3/write_lp?db=proemion`.

Verify: curl write + SQL read-back ✅, datasource health ✅.

### Phase 2 — Discovery ✅

Auth + machine/signal listing via `bun run discover` (`collector/src/discover.ts`, one-off). Paginate `/machines`, per-machine `/signals`. Emit `discovery/machines.json`, `discovery/signals.csv` (key,label,type,unit,logicalType,machines).

Findings: 9 machines, 153 unique signals, 1201 machine×signal series. All signals numeric. `logicalType` is `counter:increasing` for every signal, so it cannot discriminate. 103 signals exist on all 9 machines. At the 350-query cap, a full poll is 4 `/timeseries` requests.

Verify: CSV reviewed ✅. Ingest allowlist still open (see §8).

### Phase 3 — Collector core (plain TS) ✅

Order:

1. `config/collector.yaml` + `src/config.ts` — machine ids/names, 153-signal allowlist, interval, aggregation, bucket size, overlap.
2. `src/window.ts` — pure alignment + overlap, no I/O.
3. `src/points.ts` — series → point: tags, escaping, ns timestamp.
4. `src/influx.ts` — `@influxdata/influxdb3-client` write.
5. `src/main.ts` — loop, `--dry-run`, `backfill <from> <to>`. Chunk queries at 350/request.
6. `bun test` — alignment + point building.

Implementation notes: `from = floor(now/bucket)*bucket - (overlap+1)*bucket`, `to = floor(now/bucket)*bucket` (current incomplete bucket excluded). Per-machine signal lists fetched once at startup; allowlist filters them, and `unit` comes from the API signal (`unit.key`), not the YAML. Backfill steps in 1440-bucket chunks (stays under the 25000-bucket cap).

Verify: `bun test` 12 pass ✅; dry-run tags/ns/grid-aligned ✅; live backfill 13 datapoints ✅; re-run same window stays 13 (idempotent) ✅.

### Phase 4 — Dashboards ✅

Fleet overview provisioned from `grafana/provisioning/dashboards/`. Variables: `machine` (multi, All) and `signal` (single, default `value.Boom.Angle`). Time-series: `$__dateBin` + `avg(value)`, one line per `machine_name`. Latest table: `selector_last` over stored points, not the dashboard range. Default range `now-72h`; variable and Latest queries are bounded to 72h (see §3, query file limit). Machine filter is `machine_name ~ '^${machine}$'` because the Influx SQL plugin interpolates multi-values as a regex alternation, not a SQL `IN` list. Datasource uid stays generated (`PD260F78FC8D02CC3`); setting `uid` in the datasource YAML makes Grafana 13.2.1 exit.

Verify: provisioned uid `fleet-overview` ✅; FlightSQL series + latest for `value.Boom.Angle` / `TCB - 2615 - Jed` ✅. Human-readable labels: `signal` is a custom variable (text = API `label` from `discovery/signals.csv`, value = key; panel title `${signal:text}`), hidden `unit_sym` query variable maps raw `unit` keys to API `unit.label` symbols via SQL `CASE` (`m/s`, `°C`, …; `NUMBER` → `–`), same `CASE` in the Latest table. Static list: regen options from `signals.csv` when signals change; no collector/Influx change, series identity untouched.

### Phase 5 — Alerting

Contact point (TBD) + multi-dimensional rules per signal, `machine_id` dimension.

Verify: force/lower threshold, notification arrives.

### Phase 6 — Harden

Retention decision (post-volume), healthchecks, restart policy, logging tidy, scoped tokens.

Verify: full restart, zero manual steps.

### Phase 7 — Effect (deferred, only when things work and time remains)

Typed errors → `Schedule` loop → `Layer/Context`. Behavior unchanged. Unwrap only at edge via `runPromise`, never inside Effect.

Step 1 — typed errors + wrap fetch:

```ts
// src/errors.ts
import { Data } from "effect";

export class ProemionError extends Data.TaggedError("ProemionError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

export class InfluxError extends Data.TaggedError("InfluxError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}
```

```ts
import { Effect } from "effect";
import { ProemionError } from "./errors";

export const fetchTimeseries = (
  from: number,
  to: number,
  bucketSize: number,
  queries: unknown[],
): Effect.Effect<Series[], ProemionError> =>
  Effect.gen(function* () {
    const bearer = yield* Effect.tryPromise({
      try: () => token(),
      catch: (cause) => new ProemionError({ message: "auth failed", cause }),
    });

    const res = yield* Effect.tryPromise({
      try: (signal) =>
        fetch(`${BASE}/timeseries`, {
          method: "POST",
          signal,
          headers: {
            authorization: `Bearer ${bearer}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({ from, to, bucketSize, queries }),
        }),
      catch: (cause) => new ProemionError({ message: "request failed", cause }),
    });

    if (!res.ok) {
      return yield* new ProemionError({ message: `HTTP ${res.status}` });
    }

    return yield* Effect.tryPromise({
      try: () => res.json() as Promise<Series[]>,
      catch: (cause) => new ProemionError({ message: "invalid JSON", cause }),
    });
  });
```

Consume: `await Effect.runPromise(fetchTimeseries(from, to, BUCKET_MS, buildQueries()))`.

Step 2 — loop via `Schedule`:

```ts
import { Effect, Schedule } from "effect";

const pollOnce = Effect.gen(function* () {
  const { from, to } = alignedWindow(Date.now(), BUCKET_MS, 1);
  const series = yield* fetchTimeseries(from, to, BUCKET_MS, buildQueries());
  yield* Effect.tryPromise({
    try: () => writeSeries(series),
    catch: (cause) => new InfluxError({ message: "write failed", cause }),
  });
});

const program = pollOnce.pipe(
  Effect.retry(
    Schedule.exponential("1 second").pipe(
      Schedule.intersect(Schedule.recurs(3)),
    ),
  ),
  Effect.catchAll((err) => Effect.logError(`poll failed: ${err._tag}`, err)),
  Effect.repeat(Schedule.spaced("60 seconds")),
);

await Effect.runPromise(program);
```

Step 3 — `Layer`/`Context` wiring last:

```ts
import { Context, Effect, Layer } from "effect";

class Proemion extends Context.Tag("Proemion")<
  Proemion,
  { readonly fetchTimeseries: typeof fetchTimeseries }
>() {}

const ProemionLive = Layer.effect(
  Proemion,
  Effect.gen(function* () {
    const config = yield* AppConfig;
    return { fetchTimeseries: makeFetchTimeseries(config) };
  }),
);

await Effect.runPromise(program.pipe(Effect.provide(MainLive)));
```

| Plain              | Effect                                | When                             |
| ------------------ | ------------------------------------- | -------------------------------- |
| `async function`   | `Effect.gen`                          | only if typed errors/deps needed |
| `throw`            | `Data.TaggedError` + `yield*`         | step 1                           |
| `try/catch` I/O    | `Effect.tryPromise`                   | step 1                           |
| `await`            | `yield*`                              | step 1                           |
| `while+setTimeout` | `Effect.repeat(Schedule.spaced(...))` | step 2                           |
| retry loop         | `Effect.retry(Schedule...)`           | step 2                           |
| singletons         | `Context.Tag` + `Layer`               | step 3                           |
| pure math          | stays plain                           | never                            |

Pin Effect to current stable (v3 vs v4) at dep-add time; adjust snippets to match.

Verify: same points/timestamps; forced failure logs typed error, recovers next tick.

## 7. Secrets

- `.env` holds real Proemion secret + Influx token placeholder → real operator token. `.gitignore` `.env` before `git init`.
- Bootstrap window unauthenticated → `127.0.0.1` bind.
- Phase 6: split to Grafana read-only + collector write-only tokens.

## 8. Decisions

Resolved: InfluxDB 3 Core + SQL; TS on Bun, no build; Effect deferred to phase 7 (plain first, only when things work); machine IDs + signal scope via phase-2 discovery; ingest allowlist = all 153 signals (1201 series, 4 requests/poll); bucket/interval 60s, overlap 1, `average`.

Open: alert destination (phase 5).

## 9. Glossary

- Aggregation — many readings → one number (avg, max).
- Backfill — fetch + store past range.
- BucketSize — Proemion averaging window, ms.
- Client credentials — machine OAuth2, no login.
- Collector — TS poller Proemion → InfluxDB.
- Contact point — alert destination.
- Dashboard — Grafana page of panels.
- Datasource — Grafana saved DB connection.
- Denormalized — repeat value (machine_name) per point.
- Dry run — poll + print, no write.
- Effect — TS lib for typed side effects.
- Epoch ms — ms since 1970-01-01 UTC.
- Field — non-indexed value (`value`).
- Flux — v2 query lang, deprecated.
- Idempotent — re-run = same state.
- Layer — Effect DI wiring.
- Line protocol — InfluxDB text write format.
- Operator token — InfluxDB 3 master credential.
- Panel — one graph/table.
- Point — tags + fields + timestamp.
- Retention — how long DB keeps data.
- Schedule — Effect retry/repeat policy.
- FlightSQL — gRPC protocol Grafana uses for v3 SQL.
- Tag — indexed label (`machine_id`, `signal_key`).
- Time series — (timestamp, value) sequence.
- Variable — dashboard dropdown injected into queries.
