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

No build step (Bun runs TS directly). Deps: `@influxdata/influxdb3-client`, `yaml`, `effect` (phase 3b). Test runner: `bun test`. `.env` lives at repo root; Bun loads cwd-only, so scripts run with `--env-file=../.env`.

### Loop (every tick)

1. Ensure valid Proemion token.
2. Compute aligned window (see below).
3. Build `/timeseries` request for all machines × allowed signals.
4. Parse response → points.
5. Write to InfluxDB.
6. Record last timestamp; sleep.

On failure: log, retry next tick. Never crash loop.

### Token

```ts
export class ProemionClient {
  private token: string | null = null;
  private expiresAt = 0;

  constructor(
    private readonly baseUrl: string,
    private readonly clientId: string,
    private readonly clientSecret: string,
    private readonly tokenUrl: string,
  ) {}

  private async ensureToken(): Promise<string> {
    if (this.token && Date.now() < this.expiresAt - 60_000) {
      return this.token;
    }
    const res = await fetch(this.tokenUrl, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        client_id: this.clientId,
        client_secret: this.clientSecret,
      }),
    });
    if (!res.ok) throw new Error(`auth failed: HTTP ${res.status}`);
    const body = (await res.json()) as {
      access_token: string;
      expires_in: number;
    };
    this.token = body.access_token;
    this.expiresAt = Date.now() + body.expires_in * 1000;
    return this.token;
  }

  async timeseries(
    fromMs: number,
    toMs: number,
    bucketMs: number,
    queries: unknown[],
  ) {
    const token = await this.ensureToken();
    const res = await fetch(`${this.baseUrl}/timeseries`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        from: fromMs,
        to: toMs,
        bucketSize: bucketMs,
        queries,
      }),
    });
    if (!res.ok) throw new Error(`timeseries failed: HTTP ${res.status}`);
    return res.json();
  }
}
```

### Bucket alignment

Buckets anchor at `from`. Unaligned `from` → shifted timestamps → duplicates, jagged graphs, unsafe re-fetch.

Rule: `from`/`to` = floor(epochMs / bucketMs) * bucketMs. Grid-aligned, re-fetch byte-identical.

### Idempotency / backfill / overlap

InfluxDB upserts on same timestamp + tags + field. Safe to re-write.

Each poll overlaps 1–2 buckets to catch late data. Backfill = same path pointed at past range.

### Files (`collector/`)

- `src/config.ts` — env + `config/collector.yaml` (machines, allowlist, interval, aggregation/signal).
- `src/proemion.ts` — token, `/timeseries`, machine/signal listing.
- `src/influx.ts` — writes via `@influxdata/influxdb3-client` Point API.
- `src/window.ts` — pure alignment math, no I/O.
- `src/main.ts` — loop + `discover`, `backfill`, `--dry-run`.
- `src/discover.ts` — phase 2 one-off.
- `test/` — alignment + point building.

`--dry-run`: print line protocol, no write.

### Point format

```
signal,machine_id=ABC-1234,machine_name=Excavator\ 1,signal_key=value.clamp.30.voltage,unit=V value=13.8 1757654460000000000
```

`signal` = table. Tags: `machine_id,machine_name,signal_key,unit`. Field: `value`. Timestamp: ns (ms × 1e6). Escape spaces/commas/`=` in tag values.

### Effect migration (phase 3b)

Pure logic (`window.ts`, escaping) stays plain forever. Effect only for I/O, typed errors, scheduling, wiring. Unwrap only at edge via `runPromise`, never inside Effect.

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

### Phase 2 — Discovery

Auth + machine/signal listing via `bun run discover` (`collector/src/discover.ts`, one-off). Paginate `/machines`, per-machine `/signals`. Emit `discovery/machines.json`, `discovery/signals.csv` (key,label,type,unit,logicalType,machines).

Verify: review CSV, pick ingest signals.

### Phase 3a — Collector core (plain TS)

Config, OAuth, `/timeseries`, point building, alignment, overlap, idempotent writes, backfill, dry-run. Tests: alignment + point building.

Verify: dry-run lines correct; live run lands at right timestamps.

### Phase 3b — Effect

Typed errors → `Schedule` loop → `Layer/Context`. Behavior unchanged.

Verify: same points/timestamps; forced failure logs typed error, recovers next tick.

### Phase 4 — Dashboards

Fleet overview + variables + time-series + latest-value table, provisioned from files.

Verify: switch machines, graph moves.

### Phase 5 — Alerting

Contact point (TBD) + multi-dimensional rules per signal, `machine_id` dimension.

Verify: force/lower threshold, notification arrives.

### Phase 6 — Harden

Retention decision (post-volume), healthchecks, restart policy, logging tidy, scoped tokens.

Verify: full restart, zero manual steps.

## 7. Secrets

- `.env` holds real Proemion secret + Influx token placeholder → real operator token. `.gitignore` `.env` before `git init`.
- Bootstrap window unauthenticated → `127.0.0.1` bind.
- Phase 6: split to Grafana read-only + collector write-only tokens.

## 8. Decisions

Resolved: InfluxDB 3 Core + SQL; TS on Bun, no build; Effect gradual (plain first); machine IDs + signal scope via phase-2 discovery.

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
