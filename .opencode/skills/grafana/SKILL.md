---
name: grafana
description: Work with Grafana dashboards, datasource, and InfluxDB SQL queries in this project. Use when provisioning dashboards, editing fleet-overview.json, writing panel SQL, verifying queries, or restarting the Grafana container.
---

# Grafana in proem-graf

## Which Grafana

Compose container `grafana` on `:3000` is source of truth. Provisioned from
`grafana/provisioning/`, no click-ops.

If the container fails to bind `:3000`, something else owns that port.
Stop that process and re-run. Do not assume what it is.

## Datasource

Name `InfluxDB-Proemion`, type `influxdb`. File:
`grafana/provisioning/datasources/influxdb.yaml`.

Leave `uid` unset. Grafana 13.2.1 derives it from the name
(`sha256("InfluxDB-Proemion")[:8]`, `P` prefix) in
`pkg/services/provisioning/datasources/types.go` `safeUIDFromName`.
That value is `PD260F78FC8D02CC3`. A new volume gets the same uid as long
as the name stays `InfluxDB-Proemion`. Pinning a uid that is not already
stored makes Grafana exit with `Datasource provisioning error: data source
not found`. Dashboard JSON binds this derived uid. Do not rename the
datasource.

## Dashboards

Provider `grafana/provisioning/dashboards/default.yaml` reads classic-model
JSON from `grafana/provisioning/dashboards/json/` (30s poll, no UI edits).
Fleet dashboard: `json/fleet-overview.json`, uid `fleet-overview`,
schemaVersion 39. Classic JSON loads fine under 13.2.1 file provisioning;
never use the v2 export format from the GUI.

After changing the datasource YAML, restart the container
(`docker restart grafana`). Dashboard JSON edits apply via the 30s poll.

## Panel SQL (InfluxDB 3 Core, FlightSQL)

Target shape:

```json
{
  "refId": "A",
  "datasource": { "type": "influxdb", "uid": "PD260F78FC8D02CC3" },
  "editorMode": "code",
  "format": "time_series",
  "rawQuery": true,
  "rawSql": "SELECT ..."
}
```

Table: same shape with `"format": "table"`. Schema is table `signal`, tags
`machine_id, machine_name, signal_key, unit`, field `value`, time `time`.

Patterns:

- Series: `SELECT $__dateBin(time) AS time, machine_name, avg(value) AS value
  FROM signal WHERE $__timeFilter(time) AND signal_key = '${signal}'
  AND machine_name ~ '^${machine}$' GROUP BY 1, 2 ORDER BY 1`.
- Latest table: `selector_last(value, time)['value']` /
  `selector_last(value, time)['time']`, grouped by machine, no time filter
  (reads stored points, not the dashboard range).
- Multi-value variables interpolate as a regex alternation `(a|b)`, not a SQL
  list. Always filter with `col ~ '^${var}$'`, never `IN ($var)`.
- Variables: `machine` multi + All (`SELECT DISTINCT machine_name FROM signal
  ORDER BY machine_name`), `signal` single, refresh on load. `signal` is
  chained on `machine`.
- Timeseries legend: displayName override `${__field.labels.machine_name}`.

## Verify

Source `.env` for `GF_SECURITY_ADMIN_PASSWORD` and
`INFLUX_ADMIN_TOKEN`. Never print them.

- Grafana query path: `POST 127.0.0.1:3000/api/ds/query`, Basic auth
  `admin:<password>`, body `{from, to, queries: [target]}`. Assert frames,
  field names, and labels, not just HTTP 200.
- Influx direct: `GET 127.0.0.1:8181/api/v3/query_sql?db=proemion` with
  Bearer token. Use to validate SQL before putting it in a panel.
- Dashboard provisioned: `GET /api/dashboards/uid/fleet-overview`
  shows `"provisioned": true`.

## Data fixes

InfluxDB 3 Core rejects row deletes (`DML not supported: Delete`). To remove
a bad row: `SELECT` the good rows to a file, `influxdb3 delete table -d
proemion signal -y` in the container, rewrite via
`/api/v3/write_lp?db=proemion&precision=ns`, then diff dump-before vs
dump-after. Timestamps are minute-aligned; assert zero sub-second part when
rebuilding line protocol.
