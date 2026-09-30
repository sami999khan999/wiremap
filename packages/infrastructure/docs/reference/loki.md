---
title: Loki
description: The read side of the diagnostic stream — one file, one HTTP API, and a port shaped so a label cannot be misused.
---

# Loki

The one class in the repository that knows Loki exists. **Nothing writes to it from here.**

That asymmetry is the whole design. `JsonLogger` writes structured JSON to stdout and has never heard
of a log platform; Alloy is a separate process that tails stdout and pushes. There is no client on the
write path because there is no dependency on the write path — which is what makes swapping the log
platform a config change rather than a migration, and what keeps `JsonLogger` a
[Tier 0](../../../../docs/opinions/dependencies.md) dependency.

| | |
| --- | --- |
| **Folder** | `packages/infrastructure/src/loki/` |
| **Port** | `LogReader` — read-only |
| **Config** | `logs` on `ContainerConfig`; `LOKI_URL`, `LOKI_TENANT_ID` |
| **Container** | `container.logs`, `container.hasLogs` |
| **Compose** | `--profile observability`, on by default |
| **Dependency** | none — `fetch` against `/loki/api/v1/query_range` |

---

## Why a reader exists at all

For a long time the answer to "what reads the logs back?" was *nothing does*, and that was a
deliberate gap: Grafana was in this stack and was removed because two consoles for one operator is
worse than one, and the query that actually matters — *these logs, for this tenant, joined to that
tenant's audit rows* — was the one a generic console could not express.

`LogReader` is the seam for the surface that **can** express it: the super-admin dashboard, which
already knows what an organization is. Until that ships, the port has one honest consumer — the smoke
check — and reading logs is `docker compose logs` or curl.

**Both of those remain the break-glass path afterwards.** A log query that needs the application
running is no use during the incident where the application is down.

---

## The port refuses to offer a bad query

```ts
interface LogQuery {
  from: Date; to: Date;
  app?: string; env?: string; level?: string; eventCode?: string;   // labels
  contains?: string;                                                // line body
  limit?: number;
}
```

Four optional label filters and one substring filter, and the list is closed.

**A label creates one stream per distinct value.** `user_id` at 100k users means 100k streams and Loki
falls over. It is the most common way a Loki deployment fails, it is entirely avoidable, and the
avoidance is not a convention here — `LogQuery` has no field that could produce one.

High-cardinality fields go in `contains`, which becomes a line filter applied *after* the selector has
narrowed the streams:

```logql
{app="web", level="error"} |= "abc123" | json
```

`| json` comes after the selector for the same reason: the parse cost is paid only on the streams that
survived it.

`EVENT_CATALOG` is `event_code`'s cardinality budget, which is why event codes stay coarse — one code
carrying a `queue` field, never one code per queue.

---

## Four things `LokiLogReader` gets right that are easy to get wrong

**Timestamps are nanoseconds since the epoch.** Milliseconds are accepted and then interpreted as
nanoseconds, which silently returns an empty window somewhere in 1970. Coming back the other way,
`Number` on the whole nanosecond string loses precision above 2^53, so the division happens on
`BigInt`.

**`direction=backward`.** Loki's own default is `forward`, and the difference is invisible until the
window is wider than `limit` — at which point the page shows the *oldest* lines in it, which is never
what an operator opening a log view wanted.

**`limit` is capped at 5,000.** Loki's ceiling. Asking for more is a 400, not a truncation.

**A line that is not our JSON keeps its raw text as the message.** Postgres and MinIO do not emit our
format; they are still diagnostics. The four labels come off the stream, everything else comes out of
the parsed body, and an unparseable body yields an empty `fields` rather than an exception.

**A failed query logs Loki's body and throws only the status.** The body echoes the LogQL Loki
rejected, which is a selector over another tenant's labels; it goes to `dependency.request.failed` at
**warn**, truncated at 300 characters, and the caller gets `UnavailableError("loki", status)`. The
error context reaches the client, so nothing vendor-shaped may ride on it.

---

## The tenant header

`LOKI_TENANT_ID` becomes `X-Scope-OrgID`. Unset for the local single-tenant stack; set on Grafana
Cloud, which runs the identical thing.

That is the point of the row: **Grafana Cloud is a config change, not a migration** — one of the four
reasons Loki was chosen over technically-better alternatives, alongside the ecosystem, the
CNCF-default position, and years of answers already written down.

If search latency ever becomes a real complaint during an actual incident — the only moment the
difference is felt — the alternatives are VictoriaLogs, OpenObserve, and SigNoz. Adopting any of them
replaces this one file and one Alloy config line. Elasticsearch is not on that list.

---

## Health is deliberately not in `Container.healthy()`

`LokiLogReader.healthy()` exists and pings `/ready`. `Container.healthy()` does not call it.

Loki being down loses diagnostics and nothing else. Failing a readiness probe over it takes the
application down in order to protect its logs, which is the wrong trade in every deployment — and
exactly backwards during the incident where the logs matter most.

ClickHouse *is* in that list, because a dashboard reading from a store that is not answering is a
user-visible failure. The asymmetry is the point.
