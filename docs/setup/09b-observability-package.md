# 09b · `@loadbearing/observability`

> The diagnostic stream. Closed event codes, levels decided by a catalog rather than by a call site, structured JSON to stdout — and a hard wall between it and the audit trail.

**Delivers:** `Logger` and `JsonLogger`, the closed `EVENT_CATALOG`, `EventShape`, `Redactor`, and `Correlation`.

**Prerequisite:** [09 · `@loadbearing/errors`](09-errors-package.md)

> [!NOTE]
> **Why `09b` and not `10`.** This package has to exist before [12](12-application-package.md), which
> forbids importing it and has `check-architecture.mjs` assertion 2 enforcing that ban — a reader
> walking the build order in sequence would otherwise meet the prohibition before the package. It is
> lettered rather than numbered because renumbering twenty-one documents would silently break every
> bare prose cross-reference in them ("see 24.11", "the ban in 05"), and a wrong reference in a
> document nobody re-reads is worse than a letter in a filename.

---

## Why this is its own package

**The diagnostic stream and the audit trail are two systems that look like one.** They differ on every property that matters, and the cost of conflating them is discovering the difference during an incident or an audit:

| | Diagnostic stream (this package) | Audit trail (`ActivityLogger`) |
|---|---|---|
| Question it answers | What is the system doing right now? | Who did what, to which record, when? |
| Retention | Thirty days | Years, and legally |
| Loss tolerance | Lossy by design — sampled, dropped under load | Never. It commits inside the caller's transaction |
| Store | stdout → a log platform | Postgres, partitioned monthly |
| Written by | Anything | Only a use-case, with a `Principal` |

`application` may write the second and **may not write the first**. That is the ban in [12](12-application-package.md), and the reason is that a use-case that logs has an opinion about operations — sampling, levels, a sink — which is the one thing a domain layer must not carry across a framework change. The transport layer and the worker log; the domain records activity and throws.

`errors` and `core` are this package's only dependencies. It is a leaf beside `permissions` and `errors`, which is why it belongs in Phase B.

```
packages/observability/
├── vitest.config.ts
└── src/
    ├── index.ts                    ← barrel
    ├── import.ts                   ← core + errors, nothing else
    ├── primitive/
    │   ├── log-level.ts            → LogLevel, LogLevels
    │   └── correlation.ts          → Correlation, TraceId
    ├── catalog/
    │   ├── index.ts                → EVENT_CATALOG, EventCode, EventMeta
    │   └── core.events.ts          → coreEvents  ← one fragment per slice
    ├── event/
    │   └── event-shape.ts          → EventShape, LogFields, LogEntry
    └── logger/
        ├── logger.ts               → Logger, ERROR_EVENT
        ├── json.logger.ts          → JsonLogger
        ├── silent.logger.ts        → SilentLogger
        └── redactor.ts             → Redactor, REDACTED
```

---

## Step 09b.1 — Four levels, closed

```ts
export type LogLevel = "debug" | "info" | "warn" | "error";
```

**No `trace` and no `fatal`.** A fifth level buys nothing except an argument about which one a given line deserves, and that argument is settled differently by every person who has it.

`LogLevels.is()` is the boundary that narrows `LOG_LEVEL` from the environment before it can configure a sink. `LogLevels.atLeast()` is the comparison, so the ordering lives in one table rather than in every `if`.

`LogLevels.fromSeverity()` is the first consumer `ErrorMeta.severity` has ever had, and it is what makes the split in [09](09-errors-package.md) pay for itself:

```ts
public static fromSeverity(severity: ErrorSeverity): LogLevel {
  return severity === "unexpected" ? "error" : "warn";
}
```

**`expected` is someone trying what they cannot do. `unexpected` is us being broken.** Only the second should page anybody. Without this mapping, every 403 the product serves arrives at `error`, and the alert that matters drowns in them.

---

## Step 09b.2 — The event catalog

Every log line names an event **code**, and the code decides the level:

```ts
export const coreEvents = {
  "process.started": { level: "info" },
  "http.request.completed": { level: "info", sample: 0.1 },
  "http.request.failed": { level: "warn" },
  "queue.job.failed": { level: "error" },
  …
} as const satisfies Record<string, EventMeta>;
```

Merged in `catalog/index.ts` from team-owned fragments — `...leadEvents` — exactly as the permission catalog and the error catalog are. One team, one file, no merge conflicts in a shared list.

**The catalog is a cardinality budget, not a convenience.** `event_code` becomes a label on every line in the log platform, and a label's cardinality is what a log platform bills and indexes on. Codes therefore stay coarse: one `queue.job.failed` carrying a `queue` field, never one code per queue. A closed union is what stops the second from happening gradually.

**The level is a property of the event, not of the call site.** Without the table, the same event is `info` in one file and `error` in another, and a dashboard filtering on level shows a number that means nothing.

**`sample` is on the entry, for the same reason.** One line per request is the highest-volume thing this system emits and 10% is enough to see a latency shift — but a failure is never sampled, because the one you dropped is the one you needed.

---

## Step 09b.3 — `EventShape`: the fields are typed too

```ts
export interface EventShape {
  readonly "process.started": { readonly service: string; readonly consumers?: number };
  readonly "queue.job.failed": {
    readonly queue: string;
    readonly jobId: string;
    readonly attempt: number;
  };
}
```

Type-only, so the file adds nothing to any bundle — the same trick `content` uses to derive `MessageKey`.

Three things fall out of declaring the fields:

1. **A misspelled field name is a compile error**, so a dashboard keys on a name that cannot drift.
2. **`logger.emit("queue.job.failed", { queue })` does not compile** with `jobId` missing. A line that omits the field the query filters on is a line nobody finds.
3. **A token cannot be logged unless somebody wrote a field for it here**, in a file a reviewer reads — which is the actual defence against secrets in logs. `Redactor` below is the backstop.

---

## Step 09b.4 — `Redactor`, the backstop

```ts
const DENIED = ["authorization", "apikey", "cookie", "password", "secret", "token", …];
```

Substring match on the lowercased field **name**, never on the value. A prefix list misses `userToken`; an exact list misses `x-api-key`. The comparison strips non-letters first, so `X-API-Key` and `api_key` both hit.

It runs on every line, inside `Logger.record()`, after bound fields are merged — which is the only place that can catch what a `child()` binding dragged in, where the type is a bare `LogFields` rather than a declared `EventShape` entry.

**It returns the original object when nothing matched.** This is on the hot path of every line the process emits, and a copy per line is a copy per line.

---

## Step 09b.5 — `Correlation`

```ts
public static readonly HEADER = "x-request-id";

public static fromHeaders(headers: { get(name: string): string | null }): TraceId {
  return Correlation.sanitise(headers.get(Correlation.HEADER)) ?? Correlation.mint();
}
```

**Adopt an upstream id where a proxy set one**, so their access log and ours describe the same request. Mint a `Uuid.v7()` otherwise, so a trace id sorts by time like every other id here.

**`sanitise` is not optional.** The value arrives from the network and then rides every log line for the life of the request. It is trimmed to 128 characters and matched against `^[\w.:-]+$`; anything else is discarded and a fresh id minted. An unbounded, uncharacter-checked string on every line is a log-injection hole and a cardinality bomb at once.

`TraceId` is a plain string rather than a branded id, deliberately: `contracts` refuses to own "a UUID that is genuinely just a UUID", and a diagnostic handle that must survive arriving from a proxy in whatever shape is exactly that.

---

## Step 09b.6 — `Logger` and its two sinks

`Logger` is abstract and owns everything a sink must not decide: level filtering, sampling, bound fields, and redaction. A sink implements one method.

```ts
protected abstract write(entry: LogEntry): void;
public abstract child(bound: LogFields): Logger;
```

`child()` is how a trace id rides a request with no ambient state anywhere — `container.logger.child({ traceId })` in the oRPC correlation middleware, and every line that middleware's chain emits carries it.

**`failure()` is the one line whose level is decided by the thing being logged.** It normalises anything thrown, reads `ERROR_CATALOG[code].severity`, and maps it through `LogLevels.fromSeverity`. It also reads the non-enumerable `cause` that `toJSON()` cannot — the one thing a logger may see and the wire may not — and attaches a stack **only** for `unexpected`, because an expected failure is the system working and its stack is noise on every 403.

`JsonLogger` writes one JSON object per line, fields spread flat rather than nested under `fields`: every aggregator indexes top-level keys, and a nested object needs a parsing rule per deployment. `pretty` is for a terminal and never for production.

**`json.logger.ts` is the one file in the repository allowed to call `console`**, and the `noConsole` exemption in [05](05-lint-and-format.md) names exactly it. That is the whole point of the rule: a stray `console.log` elsewhere is a line nobody can filter, level, sample, or redact.

`SilentLogger` drops everything. `TestContainer` uses it so a use-case spec that logs needs no stubbing and nothing reaches stdout to pollute a run.

---

## Where it is consumed

- **`Container`** builds the `JsonLogger` first, so a failure in anything below it has somewhere to be recorded ([17](17-composition-container.md)).
- **`apps/web`** builds a request-scoped child in `correlationMiddleware`, and `ErrorInterceptor` is the one place every server-side failure is logged ([24](24-web-app.md)).
- **`apps/worker`** logs consumer lifecycle events and its own process-level handlers ([25](25-worker-app.md)).
- **`packages/application`** consumes none of it, and `check-architecture.mjs` fails the build on a single import.

---

## ✅ Gate

- `pnpm --filter @loadbearing/observability test` passes.
- `grep -rn "@loadbearing/observability" packages/application/src` returns nothing, and `pnpm check:architecture` reports `✓ \`application\` does not log`.
- `grep -rn "console\." packages --include=*.ts | grep -v json.logger.ts | grep -vE "src/(smoke|seed|migrate|tables)/"` returns nothing.
- `new JsonLogger({ sink }).emit("process.started", { service: "x" })` produces one line whose `level` is `info` — from the catalog, not from the call.
- A field named `authorization` comes out as `[redacted]`.
- `Correlation.sanitise("a b")` returns `null`; `Correlation.fromHeaders(new Headers())` returns a v7 uuid.

---

[← `@loadbearing/errors`](09-errors-package.md) · [`@loadbearing/contracts` →](10-contracts-package.md)
