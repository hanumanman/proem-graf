# Proemion → InfluxDB → Grafana: the plan, explained slowly

This is written for someone with a web-development background and TypeScript experience who knows what a REST API is and has never touched Grafana or InfluxDB. I'll define every new term the first time it shows up. There's a glossary at the end.

## 0. What we're building, in one paragraph

Your machines send telemetry to Proemion's cloud. Proemion offers a REST API to read that telemetry. We're going to write a small TypeScript program that, on a timer, asks Proemion for the last minute of data for each machine, and stores it in a database on your machine called InfluxDB. Then we'll connect Grafana to that database, draw graphs from it, and set up rules that fire alerts when a reading crosses a threshold. That's the whole system. Four moving parts: Proemion (source), collector (TypeScript on Node, moves data), InfluxDB (stores it), Grafana (shows it and alerts).

## 1. The problem, and why three new tools

You already understand the source end: HTTP requests and JSON responses. The question is what sits between "Proemion has data" and "I can see a graph and get an alert."

### 1.1 Why not point Grafana straight at Proemion?

Grafana can do this. There's a plugin called Infinity that lets Grafana call any REST API and turn the JSON into a graph. No database, no collector. It's the least amount of machinery.

I'd avoid it here for two reasons. First, Grafana would hit Proemion's API every time someone opens or refreshes a dashboard, so your API usage depends on how often people look at graphs. Second, and more important for you: Infinity can draw graphs, but it can't store history and its alerting on a moving time window is limited. You told me you want Grafana alerting, and alerting wants a real data store underneath it. So we add the store.

Think of it this way: Infinity is a live telescope. What you want is a recording, so you can rewind and set tripwires.

### 1.2 Why a database, and specifically a time-series database

A normal database (Postgres, MySQL) stores rows. You could store telemetry in one. But nearly every question you'll ask has the same shape: "for machine X, signal Y, show me values over time, averaged into buckets." Time-series databases exist because that shape is so common they can make it the fast path.

InfluxDB is one such database. Its whole data model is "a value, with a timestamp, tagged by what it describes." Two things it gives us that matter:

- **Fast queries over time ranges.** Asking "average voltage per machine over the last 24 hours" is the thing it's built to do.
- **Retention and downsampling.** You can tell it "keep raw data for 90 days" and it forgets old data automatically. (Downsampling — keeping hourly averages for a year while dropping raw seconds — is a v2 strength; in v3 it's a plugin. More on that later.)

### 1.3 Why a collector

Proemion doesn't push data to you. There's no webhook in your API spec — only endpoints you pull from. So something has to pull. That something is the collector: a TypeScript program that runs continuously, wakes on a schedule, calls Proemion, and writes the results into InfluxDB.

You can think of it as a translator. It speaks Proemion's dialect (OAuth tokens, POST with JSON, a particular response shape) on one side, and InfluxDB's dialect (line protocol, a token header, a write endpoint) on the other.

### 1.4 Why Grafana

Grafana is the face of the system. It doesn't store data; it queries databases and draws. It gives us three things:

- **Dashboards** — panels of graphs and tables, with dropdowns to pick a machine or signal.
- **Alerting** — rules that run on a schedule against the database and notify you when a condition holds.
- **One place** — if you later add another data source (say, a maintenance system), Grafana can show it side by side.

## 2. A shared vocabulary

You'll see these words everywhere. Learn them once here.

- **Time series** — a sequence of (timestamp, value) pairs, like voltage every minute. Plotting it gives a line.
- **Measurement / table** — a named collection of related points. Ours will be called `signal`.
- **Tag** — a label on a point, stored as a string, indexed (fast to filter on). Tags describe what the point is: `machine_id`, `signal`, `unit`.
- **Field** — the actual measured value, not indexed. Ours is `value`, a number.
- **Timestamp** — when the point happened. InfluxDB stores nanoseconds internally.
- **Point** — one tag set + one field set + one timestamp. The atomic unit.
- **Line protocol** — the text format used to write points to InfluxDB. One line per point.
- **Bucket / `bucketSize`** — not a database bucket here. In the Proemion API, `bucketSize` is the width of the time window that raw readings get averaged into before they're returned. E.g. a 60,000 ms bucket = "give me one average per minute."
- **Aggregation** — turning many raw readings into one number: average, max, min, delta.
- **Retention** — how long the database keeps data before discarding it.
- **Datasource** — in Grafana, a saved connection to a database.
- **Panel** — one graph or table on a dashboard.
- **Dashboard** — a page of panels.
- **Variable** — a dropdown on a dashboard that substitutes into queries, e.g. pick a machine.
- **Alert rule / condition / contact point** — a rule queries data on a schedule; a condition decides if it's bad; a contact point is where the notification goes.

## 3. The architecture, end to end

The life of one data point:

1. collector starts, asks Proemion for a token
2. collector POSTs `/timeseries`: "machines A..G, signal voltage, last minute, 1-min buckets"
3. Proemion returns JSON: per machine, a list of `{time, value}`
4. collector converts each value into a line-protocol line
5. collector POSTs those lines to InfluxDB `/api/v3/write_lp`
6. InfluxDB stores them
7. Grafana runs a SQL query when a dashboard is opened or an alert rule is evaluated
8. Grafana draws a graph / checks the threshold / notifies you

Steps 1–5 repeat on a timer. Steps 7–8 are driven by Grafana, independently.

Here's the box diagram:

```
Proemion API ──OAuth2 + POST /timeseries──> collector (TypeScript)
                                                  │ line protocol
                                                  ▼
                                           InfluxDB 3 Core :8181
                                                  ▲ SQL/FlightSQL
                                                  │
                                             Grafana :3000
                                       dashboards + unified alerting
```

Notice the collector is the only thing that talks to Proemion. Grafana never does. That's the point of the store: Grafana's load and Proemion's load are decoupled.

## 4. Piece 1: The Proemion API

Three things about the API matter to us. I'm reading from the current spec, `openapi_proemion_26.7.0.json`.

Proemion versions the API **per endpoint** under a global version number in the URL path (`https://dataportal.proemion.com/api/v26.7.0/...`). Versions are released twice a year (February and July) and supported for at least a year. The current version is **26.7.0**, supported until July 2027. Always call data endpoints with the version in the path; the auth token endpoint is unversioned.

### 4.1 Authentication — OAuth2 client credentials

The API uses OAuth2. You don't send your client ID and secret with every data request. Instead:

1. You POST your credentials once to a token endpoint.
2. Proemion hands you a temporary `access_token` that expires (say, in an hour).
3. You include that token as `Authorization: Bearer <token>` on every other request.
4. When it expires, you get a new one.

This is called the **client credentials grant** — it's the machine-to-machine flavor of OAuth2, no human login involved. Your `.env` already holds the two credentials under `PROEMION_CLIENT_ID` and `PROEMION_CLIENT_SECRET`.

The token request, from the spec (section `/auth/token`):

```
POST https://dataportal.proemion.com/api/auth/token
Content-Type: application/x-www-form-urlencoded

grant_type=client_credentials
&client_id=<your client id>
&client_secret=<your client secret>
```

The response:

```json
{
  "access_token": "dfjldf93lkj4398df.kf9834ldfo3.j43fdkd83ldeld",
  "expires_in": 3600,
  "token_type": "bearer"
}
```

`expires_in` is seconds. The collector will cache the token and refresh it a little before it expires, so we're not re-authenticating on every poll.

### 4.2 Listing machines and signals

Before we can ask for data, we need to know what to ask for. Two areas of the API:

- **Which machines exist.** `GET /machines` returns a top-level JSON array of machines, so discovery is one unparameterized call. (Caveat: if you pass `limit` you must also pass `offset`, or the API returns HTTP 400.)
- **Which signals a machine has.** `GET /machines/{id}/signals` returns a list of signals with their `key` (the identifier we'll use), `label` (human name), `type` (numeric or string), `unit`, and `logicalType` (is it a counter? a state signal?). There's also a global `GET /signals` endpoint. We'll use these to build our allowlist — the short list of signals worth storing.

### 4.3 The `/timeseries` endpoint, field by field

This is the workhorse. It's a POST (you send a JSON body) even though you're "getting" data. Request fields:

- `from` / `to` — the time window, as epoch milliseconds. (Epoch ms = milliseconds since 1970-01-01 UTC. Grafana and this API both use it. One less conversion to worry about.)
- `bucketSize` — the averaging window width. An integer = milliseconds. Or an ISO period string like `"P1D"` (one calendar day) — but if you use those, you must also send `timeZone`. We'll use plain milliseconds.
- `limit` — max points returned per series. The response also tells you the true total in `totalDatapoints`.
- `queries` — a list of what to fetch. Each entry is:
  - `signal` — the signal key, e.g. `"value.clamp.30.voltage"`.
  - `aggregationFunction` — `average`, `max`, `min`, `sum`, `std`, `raw`, `delta` (for counters), etc.
  - `groupBy` — `{"type": "machine", "id": "ABC-1234"}`, or `type: "model"` to aggregate across all machines of a model. One query entry = one machine (for us).

A concrete body, asking for one minute of voltage data for one machine, averaged into 60-second buckets:

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

For 7 machines you'd have 7 entries in `queries`. The spec allows up to 350 queries per request, so even a couple of dozen signals × 7 machines fits in one call.

### 4.4 The response, field by field

The response is an array, one element per query you sent:

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

- `id` tells you which machine this series belongs to.
- `signal` echoes what you asked for.
- `timeseries` is the actual payload: a list of `{time, value}`. This is what we store.
- `totalDatapoints` is how many points existed before `limit` trimmed them.

Notice `time` is epoch milliseconds — the same unit InfluxDB can accept, which is convenient.

## 5. Piece 2: The collector (TypeScript)

### 5.1 What it is

A TypeScript program running on Node with no user interface. You start it, it loops forever, and it writes a log line now and then. It's the only custom code in the project, and it should be small — a few hundred lines across a handful of files.

We chose TypeScript because that's where you're most productive, and because Node 26 runs `.ts` files directly (type stripping), so there's no build step to fight. InfluxData ships an official TypeScript client for InfluxDB 3, so nothing is second-class here.

### 5.2 The main loop

In plain English, on every tick:

1. Make sure we have a valid Proemion token.
2. Decide the time window to fetch (covered below).
3. Build the `/timeseries` request for all machines and all allowed signals.
4. Parse the response into points.
5. Write the points to InfluxDB.
6. Remember the last successful timestamp; sleep until the next tick.

If anything fails — network blip, 500 from Proemion, InfluxDB down — log it and retry next tick rather than crashing. A collector that dies at 3 a.m. and stays dead is worse than one that logs an error and recovers.

### 5.3 Getting a token and keeping it

The collector keeps the token in memory along with the time it expires. Before each request it checks: is the token missing, or about to expire? If so, fetch a new one. Otherwise reuse it. This is the whole reason we use the token endpoint rather than sending credentials everywhere — fewer secrets in flight and less auth load.

A simplified sketch (not the final code):

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
      return this.token; // still valid, refresh 60s early
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
    const body = (await res.json()) as { access_token: string; expires_in: number };
    this.token = body.access_token;
    this.expiresAt = Date.now() + body.expires_in * 1000;
    return this.token;
  }

  async timeseries(fromMs: number, toMs: number, bucketMs: number, queries: unknown[]) {
    const token = await this.ensureToken();
    const res = await fetch(`${this.baseUrl}/timeseries`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ from: fromMs, to: toMs, bucketSize: bucketMs, queries }),
    });
    if (!res.ok) throw new Error(`timeseries failed: HTTP ${res.status}`);
    return res.json();
  }
}
```

Every new thing there is standard TypeScript: a class to hold state, a method that checks a condition, and `fetch` for HTTP. If you've written a fetch call in a browser or a Node service, this will look familiar.

### 5.4 Bucket alignment — the subtle part

This is the one design detail that's easy to get wrong, so I'll explain it carefully.

Proemion returns, for each bucket, one value at the start of the bucket. If your `from` is 10:00:37 and your bucket is 60 seconds, the buckets are 10:00:37–10:01:37, 10:01:37–10:02:37, and so on. Their timestamps are 10:00:37, 10:01:37…

Now suppose the next poll runs at 10:01:10 and sends `from = 10:00:10`. The buckets are now 10:00:10, 10:01:10 — different timestamps for what is basically the same data. You'd store near-duplicate points that don't line up. Graphs get jagged, and you can't safely re-fetch a window.

The fix: always compute `from` and `to` by rounding down to a fixed grid tied to the bucket size. If the bucket is 60,000 ms, every `from` must be a multiple of 60,000 ms on the epoch clock. Then a re-fetch of the same window produces byte-identical timestamps, and buckets always start at the same instants.

That leads directly to the next idea.

### 5.5 Idempotency and backfill

**Idempotent** means "running it twice has the same effect as running it once." That's a property you want in a data pipeline, because retries and restarts happen.

InfluxDB gives us this for free: if you write a point with the same timestamp, same tags, and same field, it overwrites the old one instead of adding a duplicate. So if the collector re-fetches a window it already wrote (which it should, deliberately — see below), the result is the same data in the same place, not doubling.

Why re-fetch a window at all? Late data. Readings can arrive at Proemion slightly after they happen. If we only ever ask for "the last minute," we might ask before a reading lands and miss it forever. So each poll deliberately reaches back a little further than the last one — an overlap of one or two buckets — trusting idempotency to keep it clean.

**Backfill** is the same machinery pointed at the past: a command that says "fetch January through March and store it." Because the writes are idempotent and grid-aligned, backfilling is safe and repeatable.

### 5.6 The files

Under `collector/`:

- `src/config.ts` — reads settings from environment variables and `config/collector.yaml` (machines, signal allowlist, poll interval, aggregation per signal).
- `src/proemion.ts` — the API client: token handling, `/timeseries`, machine/signal listing.
- `src/influx.ts` — writes points to InfluxDB using the `@influxdata/influxdb3-client` Point API.
- `src/window.ts` — pure bucket-alignment math, no I/O.
- `src/main.ts` — the loop, plus the `discover`, `backfill`, and `--dry-run` commands.
- `src/discover.ts` — the one-off discovery tool from phase 2.
- `test/` — small tests for the two things worth testing: bucket alignment and point building.

Separating these keeps each file doing one job. Coming from a web background, you'll find `proemion.ts` and `main.ts` readable in isolation, which is the point. `package.json` holds the dependencies: `@influxdata/influxdb3-client`, `yaml`, `typescript`, and `vitest`, with `effect` added during phase 3b.

A dry run mode is worth calling out: it exercises everything but prints the line protocol to your terminal instead of writing to InfluxDB. Before we trust the collector, we'll run it dry and read the output ourselves.

### 5.7 Turning a response into a line

Given Proemion's `{time, value}` and the tags we want, one point becomes one line of text:

```
signal,machine_id=ABC-1234,machine_name=Excavator\ 1,signal_key=value.clamp.30.voltage,unit=V value=13.8 1757654460000000000
```

Read it as four parts separated by spaces:

1. `signal` — the measurement (table) name.
2. `machine_id=ABC-1234,machine_name=Excavator\ 1,signal_key=...,unit=V` — the tags. (Spaces inside tag values are escaped with a backslash, which is why `Excavator\ 1` has one.)
3. `value=13.8` — the field.
4. `1757654460000000000` — the timestamp in nanoseconds. Note Proemion gives milliseconds, so we multiply by 1,000,000.

That string, many lines at a time, is what we POST to InfluxDB.

### 5.8 Introducing Effect gradually

We're writing the collector in plain TypeScript first, then adopting [Effect](https://effect.website) in three deliberate steps. The reason is simple: you'd otherwise be learning Effect while also learning Grafana, InfluxDB, and the Proemion API, and when something breaks you wouldn't know which of the three to blame.

Gradual adoption works because Effect and plain `async`/`await` convert in both directions:

- **Plain → Effect:** `Effect.tryPromise` / `Effect.promise` / `Effect.sync` wrap a promise or thunk.
- **Effect → Plain:** `Effect.runPromise(effect)` unwraps one at the edge.

So each module can move over independently. The one rule that keeps the mix clean: **keep pure logic pure.** Bucket alignment and point building are arithmetic — they stay ordinary functions forever. Effect is for I/O, typed errors, scheduling, and wiring. Not everything should become an `Effect`.

The migration ladder, in order:

**Step 1 — typed errors, and wrap one call.** Start with error types, then wrap the fetch. The rest of the module stays plain.

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
// src/proemion.ts — the boundary now returns an Effect
import { Effect } from "effect";
import { ProemionError } from "./errors";

export const fetchTimeseries = (
  from: number, to: number, bucketSize: number, queries: unknown[],
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
          headers: { authorization: `Bearer ${bearer}`, "content-type": "application/json" },
          body: JSON.stringify({ from, to, bucketSize, queries }),
        }),
      catch: (cause) => new ProemionError({ message: "request failed", cause }),
    });

    if (!res.ok) {
      // Tagged errors are "yieldable" — yielding one is like Effect.fail
      return yield* new ProemionError({ message: `HTTP ${res.status}` });
    }

    return yield* Effect.tryPromise({
      try: () => res.json() as Promise<Series[]>,
      catch: (cause) => new ProemionError({ message: "invalid JSON", cause }),
    });
  });
```

The plain loop still consumes it with one unwrap:

```ts
const series = await Effect.runPromise(fetchTimeseries(from, to, BUCKET_MS, buildQueries()));
```

**Step 2 — move the loop into Effect.** This is where `Schedule` replaces the hand-rolled retry and sleep. The `while` / `try` / `setTimeout` disappears:

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
  // retry a failed poll: 1s, 2s, 4s, up to 3 attempts
  Effect.retry(Schedule.exponential("1 second").pipe(Schedule.intersect(Schedule.recurs(3)))),
  // a poll that still fails after retries logs and doesn't kill the loop
  Effect.catchAll((err) => Effect.logError(`poll failed: ${err._tag}`, err)),
  // then wait 60s and do it again
  Effect.repeat(Schedule.spaced("60 seconds")),
);

await Effect.runPromise(program);
```

**Step 3 — Layer/Context wiring.** Last, so it doesn't slow you down early. Services become injected instead of imported singletons.

```ts
import { Context, Effect, Layer } from "effect";

class Proemion extends Context.Tag("Proemion")<
  Proemion,
  { readonly fetchTimeseries: typeof fetchTimeseries }
>() {}

const ProemionLive = Layer.effect(
  Proemion,
  Effect.gen(function* () {
    const config = yield* AppConfig; // the YAML/env config, itself a service
    return { fetchTimeseries: makeFetchTimeseries(config) };
  }),
);

// the program now declares its dependencies in the type: Effect<A, E, Proemion | Influx>
await Effect.runPromise(program.pipe(Effect.provide(MainLive)));
```

The migration map, at a glance:

| Plain TypeScript | Effect | When |
| --- | --- | --- |
| `async function` returning a value | `Effect.gen` | only if callers need typed errors or deps |
| `throw new Error` | `Data.TaggedError` + `yield*` | step 1, cheapest win |
| `try` / `catch` around I/O | `Effect.tryPromise` | step 1 |
| `await` | `yield*` | step 1 |
| `while (true)` + `setTimeout` | `Effect.repeat(Schedule.spaced(...))` | step 2 |
| hand-written retry loop | `Effect.retry(Schedule...)` | step 2 |
| module-level singleton clients | `Context.Tag` + `Layer` | step 3, last |
| pure math (`alignedWindow`, escaping) | **stays plain, forever** | never |

Rules to keep the mix clean: unwrap an Effect to a promise only at the outer edge (`runPromise`), never call `runPromise` inside an Effect, and keep pure functions as ordinary functions. Effect has a stable v3 line and a v4 in the docs; we'll pin to whichever is current stable when we add the dependency and adjust these snippets to match exactly.

## 6. Piece 3: InfluxDB 3 Core

### 6.1 What a time-series database is

You already know the concept from section 1.2: it's a database optimized for (timestamp, value) data grouped by labels. The mental model that matters: **tags are indexed, fields are not.** Filtering and grouping by `machine_id` or `signal` is fast because those are tags. If you made `machine_id` a field instead, every query would scan everything. So the choice of "tag vs field" is a real design decision, and it's the main thing to get right.

### 6.2 Our schema

One table for numeric signals:

| Part      | Name           | Example                  | Role                                       |
| --------- | -------------- | ------------------------ | ------------------------------------------ |
| table     | `signal`       | —                        | the measurement                            |
| tag       | `machine_id`   | `ABC-1234`               | which machine                              |
| tag       | `machine_name` | `Excavator 1`            | human label (denormalized for convenience) |
| tag       | `signal_key`   | `value.clamp.30.voltage` | which signal                               |
| tag       | `unit`         | `V`                      | display unit                               |
| field     | `value`        | `13.8`                   | the number                                 |
| timestamp | `time`         | `1757654460000000000`    | when, in ns                                |

**Denormalized** means we store the machine's name on every point rather than looking it up elsewhere. That's normal and good in time-series databases — it makes queries simpler and self-contained. With 7 machines, the extra storage is nothing.

We'll add a second table (`signal_state`) for string/state signals later, only if discovery shows they matter. Alerts care about numbers, so numeric first.

### 6.3 Line protocol

That's the format shown in 5.7. Two rules that trip people up: spaces, commas, and equals signs inside tag values must be escaped; and the timestamp must match the precision you tell InfluxDB about. We'll send nanoseconds explicitly so there's no ambiguity.

### 6.4 How you run it, and auth

InfluxDB 3 Core listens on port **8181** (not 8086 — that's the older v2 port, a common source of confusion). You run it in Docker. On first start, before any token exists, its admin endpoint accepts unauthenticated requests — meaning anyone who can reach the port could claim it. So we start it bound to `127.0.0.1` only, create the operator token with the CLI, and then expose it.

The **operator token** is the master credential. We'll create it once, put it in `.env`, and use it both for the collector's writes and Grafana's reads (in a real deployment you'd make a limited read-only token for Grafana and a write-only token for the collector — worth doing, but not required to get started).

Databases are created explicitly, e.g. `proemion`. That's our table namespace.

### 6.5 Retention

Retention is how long data sticks around. In v3 Core, retention is set when you create the database and **cannot be changed afterward** — that's a real caveat. Default is infinite (keep forever). The minimum meaningful value is `1h`.

For 7 machines, the data volume is tiny, so my default is to start with infinite retention and revisit once we know the actual write rate. If we later want a 90-day window, the correct move is to create a new database with that retention and point everything at it — or move to Enterprise, which allows changing it. Not urgent, but good to know it's a one-way door.

### 6.6 Querying

v3 Core speaks SQL (via a query engine called DataFusion) and InfluxQL. Not Flux — Flux is the older v2 language and InfluxData has deprecated it.

A Grafana panel query looks like this:

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

- `date_bin(INTERVAL '1 minute', time)` groups timestamps into minute buckets — this is where downsampling happens at query time.
- `$__timeFilter(time)` is a Grafana macro that expands to a time range matching the dashboard's selected range. You don't write the bounds; Grafana fills them in.
- `GROUP BY 1, 2` groups by the first two selected columns (the bucket and the machine name), so each machine becomes its own line.

### 6.7 v3 Core vs v2.7, briefly

I recommended v3 Core for you. The honest trade-offs:

- **v3 wins on:** being current, SQL (familiar, lots of transferable knowledge), InfluxData's recommendation, and no pending migration.
- **v2 wins on:** more tutorials and Stack Overflow answers, Flux alerting examples everywhere, mutable retention, and native downsampling via "tasks."
- **v3's costs:** younger stack, immutable retention, and SQL in Grafana uses a protocol (FlightSQL over gRPC) that needs HTTP/2 and Grafana 12.2+. Both are fine in our local Docker setup, where Grafana talks to InfluxDB directly.

Given 7 machines and a fresh start, v2's advantages mostly don't apply to you. That's why I lean v3.

## 7. Piece 4: Grafana

### 7.1 The pieces

- **Datasource** — a saved connection to InfluxDB: URL, database name, token, query language. You configure it once.
- **Dashboard** — a page. Contains panels.
- **Panel** — one visualization (a line chart, a table, a big number) plus its query.
- **Variable** — a dropdown at the top of a dashboard that plugs into panel queries.
- **Alert rule** — a saved query + condition that Grafana runs on a schedule, independent of anyone looking at a dashboard.
- **Contact point** — where an alert's notification is delivered (webhook, email, Slack).

### 7.2 The datasource config

We'll write it as a YAML file that Grafana provisions on startup (reads automatically), rather than clicking through the UI. Conceptually:

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
      insecureGrpc: true # because we're not using TLS locally
    secureJsonData:
      token: ${INFLUX_ADMIN_TOKEN}
```

Two notes for a beginner: `influxdb3-core` is the service name in Docker Compose — containers find each other by name, not IP. And `insecureGrpc: true` just means "don't require TLS," which is fine when both containers are on the same machine.

### 7.3 A dashboard, panel by panel

Phase 4 builds a "fleet overview":

- **Variables:** a machine dropdown (query: distinct `machine_name` values from InfluxDB) and a signal dropdown. Panels filter using these.
- **Time-series panel:** one line per machine, of the selected signal, over the dashboard's time range. This is the SQL query from 6.6, parameterized by the variables.
- **Latest-value table:** current reading per machine, to see status at a glance.

Dashboards can also be provisioned from JSON files, so the dashboard is version-controllable rather than trapped in Grafana's database.

### 7.4 Alerting, explained

Grafana's unified alerting works like this:

1. A rule contains one or more queries that return time-series data.
2. Grafana evaluates the rule on a schedule (say, every minute).
3. A condition inspects the query result — e.g. "the last value is below 20" or "the average is above 90."
4. If the condition is true for a set **pending** period (e.g. "for 5 minutes"), the alert fires.
5. A contact point delivers the notification, optionally with grouping and routing rules.

Crucially, Grafana runs alert rules on its own, without any dashboard open. They're not tied to the dashboard where you built the query. That's why they're reliable.

For a 7-machine fleet, the good pattern is a **multi-dimensional rule**: one rule for a given signal, whose query returns a row per machine, so Grafana tracks each machine separately and can alert on just the one that's bad. That's why we put `machine_id` in the `GROUP BY`.

### 7.5 Why alerts can't use variables

This surprises people: alert queries cannot use dashboard template variables. Variables only exist when a human is looking at a dashboard; an alert runs with no dashboard context, so `${machine}` means nothing to it.

The consequence: each alert rule must pin a signal explicitly in its query (e.g. `WHERE signal_key = 'value.clamp.30.voltage'`), and let the machine be a dimension the rule fans out over, not a variable. It's a small constraint that shapes how we write the queries.

Alert thresholds are domain knowledge — I don't know whether your battery's dangerous state is 10% or 30%. We'll define those together after discovery, but the plumbing goes in during phase 5.

## 8. Docker Compose, so the boxes make sense

You have Docker. Docker Compose lets you describe several containers in one file and start them together with one command. Ours will have three services:

- `influxdb3-core` — the database, port 8181.
- `grafana` — the UI, port 3000.
- `collector` — our TypeScript program.

Two things Compose gives us that matter: the containers share a network, so they address each other by service name (`http://influxdb3-core:8181`); and configuration is declarative, so the whole system comes up reproducibly instead of relying on someone's memory of commands. Data volumes get mounted so a database restart doesn't wipe your data.

## 9. The plan, phase by phase

Each phase ends with something you can actually verify.

### Phase 1 — Stand up the stack

Write `compose.yaml`, `.env.example`, `.gitignore`. Pin image versions (important: Docker's `latest` tag flips to InfluxDB 3 Core on Sep 15, 2026, and pinned tags prevent surprise upgrades). Start InfluxDB bound to localhost, generate the operator token, create the `proemion` database, start Grafana, provision the datasource.

**Verify:** run a manual line-protocol write with `curl`, then query it back with SQL and see the row.

### Phase 2 — Discovery

Build auth plus the machine/signal listing. Run it and produce `discovery/machines.json` and `discovery/signals.csv` (signal key, label, type, unit, logicalType, which machines have it).

**Verify:** you review the CSV and pick the signals to ingest. This is a decision point — ingestion scope comes from real output, not guesswork.

### Phase 3a — Collector core (plain TypeScript)

Config, OAuth, `/timeseries`, point building via `@influxdata/influxdb3-client`, grid alignment, overlap, idempotent writes, backfill, dry-run. Plus tests for alignment and point building.

**Verify:** run dry and read the lines; then run for real and confirm points appear in InfluxDB at the right timestamps.

### Phase 3b — Introduce Effect

Adopt Effect incrementally in the order from section 5.8: typed errors and wrapped I/O first, then the loop with `Schedule`, then `Layer`/`Context` wiring. Behavior stays identical; only the structure changes.

**Verify:** the collector still writes the same points at the same timestamps, and a forced failure now logs a typed error and recovers on the next tick.

### Phase 4 — Dashboards

Fleet-overview dashboard with machine and signal variables, a time-series panel, a latest-value table. Provisioned from files.

**Verify:** open Grafana, switch machines, see the graph move.

### Phase 5 — Alerting

Contact point (destination TBD — you said decide later), then multi-dimensional rules per signal with `machine_id` as the dimension.

**Verify:** force a threshold (or temporarily lower it) and confirm a notification arrives.

### Phase 6 — Harden

Decide retention now that we know write volume, add container healthchecks and restart policy, tidy logging.

**Verify:** restart everything and confirm it comes back without manual steps.

## 10. Secrets and security

- Your `.env` currently contains a real Proemion client secret and a placeholder Influx token. The placeholder will be replaced when InfluxDB mints its operator token. Add a `.gitignore` with `.env` in it before any `git init` — you do not want that client secret in version control.
- The InfluxDB bootstrap window (before the first token exists) is unauthenticated; binding to `127.0.0.1` during setup closes it.
- Longer term, InfluxDB 3 supports scoped tokens: a read-only token for Grafana, a write-only token for the collector. It's the right end state; we can do it in phase 6.

## 11. Resolved decisions and open questions

Resolved:

1. **Database** — InfluxDB 3 Core, queried from Grafana with SQL.
2. **Collector language** — TypeScript on Node 26, no build step (Node runs `.ts` directly).
3. **Effect** — adopted gradually: plain TypeScript first (phase 3a), then the incremental refactor (phase 3b).
4. **Machine IDs** — resolved by discovery in phase 2; no IDs need to be supplied by hand.
5. **Signal scope** — resolved by phase 2 output; you'll pick from the real list.

Still open:

1. **Alert destination** — deferred. The rules get built in phase 5; the contact point can be added whenever you decide.

## 12. Glossary

- **Aggregation** — combining many readings into one number (average, max, …).
- **Alert rule** — a saved query + condition Grafana evaluates on a schedule.
- **Backfill** — fetching and storing historical data after the fact.
- **Bucket (Proemion)** — the time window raw readings are averaged into.
- **Client credentials** — the OAuth2 flow for machine-to-machine auth, no user login.
- **Collector** — our TypeScript program that moves data from Proemion to InfluxDB.
- **Contact point** — the destination for alert notifications.
- **Dashboard** — a Grafana page of panels.
- **Datasource** — a saved database connection in Grafana.
- **Datasource provisioning** — configuring Grafana from files at startup instead of clicking.
- **Denormalize** — store a value repeatedly (like a machine name on every point) for simpler queries.
- **Dry run** — execute everything but write nothing, for inspection.
- **Effect** — a TypeScript library for describing side effects as typed, composable values; introduced gradually in phase 3b.
- **Epoch milliseconds** — milliseconds since 1970-01-01 UTC.
- **Field** — a non-indexed value on a point.
- **Flux** — InfluxDB v2's query language; deprecated.
- **Idempotent** — running twice has the same effect as running once.
- **InfluxQL** — a SQL-like query language supported across InfluxDB versions.
- **Layer** — Effect's mechanism for building and providing service implementations (dependency injection).
- **Line protocol** — InfluxDB's text write format.
- **Measurement / table** — a named collection of points.
- **Node** — the JavaScript/TypeScript runtime the collector runs on.
- **Operator token** — InfluxDB 3's master admin token.
- **Panel** — one graph or table.
- **Point** — tags + fields + timestamp; the atomic unit.
- **Provisioning** — see datasource provisioning.
- **Retention** — how long data is kept.
- **Schedule** — Effect's declarative description of when to repeat or retry an effect.
- **SQL / FlightSQL** — v3's query language and the protocol Grafana uses to speak it.
- **Tag** — an indexed label on a point; fast to filter and group by.
- **Tagged error** — an error class with a `_tag` discriminant, so callers can handle it by type.
- **Time series** — a sequence of timestamped values.
- **Unified alerting** — Grafana's alerting system, independent of dashboards.
- **Variable** — a dashboard dropdown that substitutes into panel queries.

That's the plan and the reasoning behind every piece. The stack is settled: TypeScript on Node, InfluxDB 3 Core, Grafana, and Effect introduced gradually. The first build step is phase 1 — stand up the stack.
