---
title: alloy.config.alloy
description: The log pipeline component by component — two sources, six stages, four labels, and the three leaks that only a running system reveals.
---

# `alloy.config.alloy`

The agent that turns container stdout into Loki streams. **This file is where the label rule stops
being a convention.**

| | |
| --- | --- |
| **Image** | `grafana/alloy:v1.5.1` |
| **Inside the network** | `alloy:12345` (its own UI and metrics) |
| **Reads** | `/var/run/docker.sock` (ro), `/var/log/app/*.log` (ro) |
| **Writes to** | `loki:3100` |

Alloy's config is a dataflow graph, not a script: each block is a **component** with a name, and
components reference each other's outputs by identifier. Nothing runs in file order.

```
discovery.docker.compose
   └→ discovery.relabel.compose
        └→ loki.source.docker.compose ─┐
                                       ├→ loki.process.stream → loki.write.default → loki:3100
local.file_match.dev                   │
   └→ loki.source.file.dev ────────────┘
```

---

## Source 1 — container stdout

```alloy
discovery.docker "compose" {
  host             = "unix:///var/run/docker.sock"
  refresh_interval = "15s"

  filter {
    name   = "label"
    values = ["com.docker.compose.project=ratchet"]
  }
}
```

Asks the Docker daemon what containers exist. **The filter is not optional:** without it,
`discovery.docker` finds every container on the machine and Alloy ingests whatever unrelated projects
a developer happens to have running.

It filters on the label Compose stamps on everything it creates, so it must match `name: ratchet` in
the compose file — see [compose](compose.md).

**`refresh_interval = "15s"`** is how long a newly started container waits before its logs appear.
The default is a minute, long enough that a developer restarting one service concludes the pipeline
is broken.

```alloy
discovery.relabel "compose" {
  targets = discovery.docker.compose.targets
  rule {
    source_labels = ["__meta_docker_container_label_com_docker_compose_service"]
    target_label  = "app"
  }
}
```

Discovery attaches metadata as `__meta_*` labels. **Anything beginning with a double underscore is
internal and dropped** before a target becomes a stream — so this rule copies the Compose service
name into a real label, `app`.

This is the **fallback** `app`, used by containers that do not emit our JSON. Our own applications
overwrite it from the log body downstream.

```alloy
loki.source.docker "compose" {
  host       = "unix:///var/run/docker.sock"
  targets    = discovery.relabel.compose.output
  forward_to = [loki.process.stream.receiver]
}
```

Actually reads the logs. The socket is mounted read-only, and this is the only reason anything in the
stack touches it.

---

## Source 2 — the host

```alloy
local.file_match "dev" {
  path_targets = [{ __path__ = "/var/log/app/*.log", app = "dev" }]
}

loki.source.file "dev" {
  targets    = local.file_match.dev.targets
  forward_to = [loki.process.stream.receiver]
}
```

**`pnpm dev` runs the apps on the host, not in containers**, so nothing Docker-based can see them.
This tails `infra/logs/` — mounted at `/var/log/app` — instead:

```bash
pnpm dev | tee infra/logs/dev.log
```

Optional. `LOG_PRETTY=true` and reading the terminal is the normal loop; pipe only when you want to
exercise the pipeline itself. `app = "dev"` is again a fallback the JSON stage overwrites.

---

## The pipeline

```alloy
loki.process "stream" {
  forward_to = [loki.write.default.receiver]
```

**One pipeline for both sources.** A stage that cannot parse a line extracts nothing and falls
through to the next, so the stages compose rather than needing a branch per service.

### `stage.json` — our own lines

```alloy
  stage.json {
    expressions = {
      app        = "app",
      env        = "env",
      level      = "level",
      event_code = "event",
    }
  }
```

Reads four fields out of the JSON body into the **extracted map** — a per-line scratch space that
later stages read. Nothing is a label yet.

`app` and `env` are bound onto every line by `Container`
([17](../../setup/17-composition-container.md)); `level` and `event` come from
`EVENT_CATALOG`. That contract is asserted in
`packages/observability/tests/logger/wire-contract.spec.ts`, because no compiler spans this file and
`JsonLogger`.

> **Reading `app` from the body rather than the container name is a deliberate reversal.** Deriving
> it from Docker works locally and stops working the moment the topology changes: on Kubernetes a
> container name is a pod name, so `web-7d4f9` and `web-2a1c8` become two values of what should be
> one label, and a host-run `pnpm dev` has no container at all. The application knows what it is.

### `stage.match` and `stage.logfmt` — third-party lines

```alloy
  stage.match {
    selector = "{app=~\"loki|alloy\"}"

    stage.logfmt {
      mapping = { level = "" }
    }
  }
```

Loki and Alloy emit logfmt with a `level` key. It writes the **same extracted key** as
`stage.json`, so whichever stage understood the line is the one that wins — no coalescing logic
needed.

**Gated by a selector, unlike `stage.json`, and the asymmetry is not stylistic.** A JSON stage that
cannot parse a line fails silently; `stage.logfmt` logs an error for every line it does not
understand. Alloy collects its own stdout, so ungated it spends the whole pipeline reporting that
Postgres does not speak logfmt — and those errors are themselves shipped, generating more.

### `stage.static_labels` — the floor

```alloy
  stage.static_labels {
    values = { env = "development" }
  }
```

Every line gets `env`, including third-party containers whose format carries no such field. **Set
before `stage.labels`**, so an application line carrying its own `env` still overrides it.

Without this, a failed `stage.json` left third-party lines with no `env` at all, and
`{env="development"}` silently excluded half the stack.

### `stage.labels` — promotion

```alloy
  stage.labels {
    values = {
      app        = "",
      env        = "",
      level      = "",
      event_code = "",
    }
  }
```

**This is the line that decides what a label is.** An empty value means "use the extracted key of the
same name". A key nothing extracted is *left unset* rather than blanked — which is what preserves the
fallback `app` from the relabel rule.

Adding an entry here is the one edit that can quietly make Loki miserable. It should be as hard to do
casually as adding a row to a catalog.

### `stage.label_drop` — the leak

```alloy
  stage.label_drop {
    values = ["filename"]
  }
```

`loki.source.file` attaches `filename` to every stream it creates. That is a fifth label and one
stream per rotated file, growing forever. **Nothing in this config asked for it** — which is exactly
why the check below queries the live label set rather than trusting a reading of this file.

---

## The sink

```alloy
loki.write "default" {
  endpoint {
    url = "http://loki:3100/loki/api/v1/push"
  }
}
```

Service name on the bridge network, container port. Alloy buffers and retries with backoff when Loki
is unreachable, which is why an outage does not amplify into a log storm.

---

## What each service ends up with

| Service | `app` | `env` | `level` | `event_code` | Parsed as |
|---|---|---|---|---|---|
| `web`, `worker`, `dev` | body | body | body | ✅ | our JSON |
| `loki`, `alloy` | service name | static | body | — | logfmt |
| `postgres`, `redis-*`, `minio`, `clickhouse` | service name | static | — | — | plain text |

**Only our own applications get all four.** `event_code` exists because we have a closed catalog, and
Postgres does not.

**Third-party services get no `level`.** Their severities are four bespoke formats; normalising each
into our label is a regex per vendor that breaks on their next release, in exchange for a query —
`{app="postgres"} |= "ERROR"` — that Loki is already good at.

---

## Three leaks a config review cannot find

All three were found by running the stack and querying Loki. **None appears anywhere in this file.**

1. **`service_name`, invented by Loki 3.x.** Fixed in [loki.config.yml](loki.md) with
   `discover_service_name: []` and `discover_log_levels: false`.
2. **`filename`, attached by `loki.source.file`.** Fixed by `stage.label_drop` above.
3. **`stage.logfmt` error spam**, fixed by the `stage.match` gate above.

---

## Checking it

```bash
curl -s -G http://localhost:23100/loki/api/v1/series \
  --data-urlencode "start=$(($(date +%s)-60))000000000" \
  --data-urlencode 'match[]={app=~".+"}'
```

Every stream in that fresh window must carry only the four. **The global `/labels` endpoint includes
streams from before any config change** and shows ghosts long after the cause is fixed.

```bash
curl -s -G http://localhost:23100/loki/api/v1/label/app/values | jq -r '.data[]' | sort
```

One entry per compose service. A missing value means that container has logged nothing yet, not that
it is being skipped; a value that is not in the compose file means the project filter is wrong.

Alloy's own UI is at `http://localhost:12345`, showing the component graph and each component's
health — the fastest way to see which stage is dropping something.

> **`LOG_PRETTY=true` makes the pipeline blind.** The human format is not JSON, `stage.json` drops
> what it cannot parse, and lines arrive with no labels beyond the target's. Correct in a terminal,
> wrong anywhere Alloy is reading.

> **Alloy's healthcheck is `bash`'s `/dev/tcp`** — the image ships neither `wget` nor `curl`. It
> proves Alloy is listening, not that every component loaded. The label checks above are the real
> test.
