---
title: "@loadbearing/observability"
description: One diagnostic stream — closed event codes, levels decided by a catalog, structured fields to stdout and on to Loki. The other half of the split that keeps errors free of prose.
---

# `@loadbearing/observability`

The audit trail answers *who did what*. This answers *what the system did*. They are two of the four
data streams, with different sinks, different audiences, different retention, and different tolerance
for loss — and the fastest way to ruin both is to write them through one object.

| | `ActivityLogger` | `Logger` |
| --- | --- | --- |
| **Sink** | Postgres, inside the transaction | stdout → Alloy → Loki |
| **Audience** | users, compliance | operators |
| **Retention** | 12–24 months of detail, partitioned monthly | 30 days |
| **Written by** | use-cases | adapters and edges |
| **Losing a line** | a bug | fine |

The other two streams are domain data and analytics; all four and the rule that separates them are
in [Data and scale](../../../docs/opinions/data-and-scale.md).

| | |
| --- | --- |
| **Package** | `@loadbearing/observability` (private, never published) |
| **Entrypoint** | `src/index.ts` |
| **Depends on** | `@loadbearing/core` (`Clock`, `Uuid`), `@loadbearing/errors` — nothing else, ever |
| **Used by** | `infrastructure`, `auth`, `composition`, `apps/*` — **never** `application` |
| **Environment** | isomorphic — server, browser, worker, and Tauri webview |
| **Build** | `tsup` → `dist/index.js` + `dist/index.d.ts` |

```
packages/observability/
├── vitest.config.ts
├── src/
│   ├── index.ts
│   ├── import.ts                ← Clock, SystemClock, Uuid, ERROR_CATALOG, ErrorNormalizer
│   ├── primitive/
│   │   ├── index.ts
│   │   ├── log-level.ts         → LogLevel, LogLevels
│   │   └── correlation.ts       → Correlation, TraceId
│   ├── catalog/                 ← one fragment per slice, team-owned
│   │   ├── index.ts             ←   EVENT_CATALOG, EventCode, EventMeta
│   │   └── core.events.ts
│   ├── event/
│   │   ├── index.ts
│   │   └── event-shape.ts       → EventShape, EventFields, LogFields, LogEntry
│   └── logger/
│       ├── index.ts
│       ├── logger.ts            → Logger        (abstract seam)
│       ├── json.logger.ts       → JsonLogger    ★ the one file allowed to call console
│       ├── silent.logger.ts     → SilentLogger
│       └── redactor.ts          → Redactor
└── tests/
    ├── primitive/ · catalog/
    └── logger/  ← incl. wire-contract.spec.ts, the shape Alloy parses
```

---

## The rule everything else follows from

**The domain layer does not log.** A use-case records a business fact through `ActivityLogger`, or it
throws a typed error. That is its entire vocabulary. Diagnostics are an adapter concern, and
`packages/application` does not depend on this package — `check-architecture.mjs` asserts it.

That one rule dissolves every hard problem at once:

- `application` keeps its three workspace dependencies and its sixteen ports.
- Nothing threads a third argument into `execute(actor, input)`.
- No `AsyncLocalStorage`, and no request-scoped state on the `Container`.
- A `ForbiddenError` is logged **once**, at the boundary that catches it, with its full structured
  context — rather than three times on the way up, each time with less of it.

Logging happens at the edges: the oRPC layer, the worker's consumers, the adapters in
`infrastructure`, and process boot and shutdown.

---

## Lines carry codes, not sentences

The same discipline `errors` applies to failures. A log line names an event from a closed union and
carries declared fields:

```ts
log.emit("queue.job.failed", { queue: "embedding", jobId: job.id, attempt: job.attemptsMade });
```

**The level is not at the call site.** `EVENT_CATALOG` says `queue.job.failed` is an `error`, so it
is an error everywhere — no adapter can quietly emit it at `info`. The call site says *what
happened*; the catalog says *how loudly*, and whether that code is sampled.

A typo is a compile error. So is a field the event does not declare. See
[catalog](reference/catalog.md).

---

## Reading the stream

One JSON object per line, fields flat at the top level. A nested `fields` object would need a parsing
rule per deployment; flat keys drop straight into Loki's `json` stage with no configuration.

```json
{"level":"error","time":"2026-01-01T00:00:00.000Z","event":"error.raised","traceId":"0195…","code":"INTERNAL","cause":"Error: relation \"users\" does not exist","stack":"…"}
```

**Four fields on that line are eligible to become labels**, and the pipeline reads all four out of
the body: `level`, `event`, and the `app` / `env` that `Container` binds onto every line. Everything
else — `traceId`, `code`, and any id a slice adds — stays in the body and is reached with `| json`.

Deriving `app` from a container name instead would give you pod names on Kubernetes and nothing at
all for a host-run `pnpm dev`. The application knows which application it is.

`traceId` is bound by `child()` at the request or job boundary, so every line for one request shares
it, and the same id is stamped onto the `ErrorEnvelope` the client receives. A user who says "it
broke" can read back a string that finds the exact line:

```logql
{app="web", level="error"} | json | traceId="0195…"
```

See [correlation](reference/correlation.md).

> [!WARNING]
> **Loki indexes labels, not fields.** The selector `{app="web", level="error"}` narrows the streams;
> the `| json` stage parses the body afterwards. Making `traceId` a label to "speed that up" creates
> one stream per request and is the single most common way a Loki deployment fails.
>
> The label set is closed: `app`, `env`, `level`, `event_code`. See
> [Data and scale](../../../docs/opinions/data-and-scale.md).
>
> `EVENT_CATALOG` is therefore the cardinality budget for `event_code` — plus `ERROR_EVENT`
> (`error.raised`), which is not a catalog entry. Every slice that adds a fragment spends the
> budget, so keep codes coarse.

---

## Nothing else may call `console`

Biome's `noConsole` is an error repo-wide, with an exemption list of four script contexts and
`json.logger.ts`. That file is the sink this rule exists to funnel everything into — the one place
allowed to call `console`, precisely so nothing else has to.

> [!NOTE]
> `console` is not declared under `lib: ["ES2024"]` either. It is reached as an optional property of
> `globalThis`, the same shape `ServerOnly` uses for `window` and `Uuid` uses for `crypto`. Third
> instance of that trap; expect a fourth.

---

## Testing

`JsonLogger` takes a `sink`, a `clock`, and a `random`, so a spec asserts on parsed lines with a
frozen timestamp and a deterministic sampling draw — no stdout capture, no fake timers. `TestContainer`
wires `SilentLogger`.

**`wire-contract.spec.ts` is the one test that exists for something outside the workspace.** The
Alloy pipeline in `upstream:infra/alloy.config.alloy` addresses `level` and `event` by bare name at the top
level of each line, and no compiler spans both files. That spec pins the shape: rename the field,
nest it under `fields`, or turn on pretty-printing, and it fails here rather than producing
unlabelled streams nobody notices until an incident.
