---
title: Logs
description: Bringing back Loki and Alloy, so logs from every server land in one searchable place — mostly infrastructure, because the app already writes the right format.
---

# Logs (Loki and Alloy)

**The limit.** Lite writes logs as one JSON line per event to stdout, and nothing collects them. With
one server that is fine. With several, finding one error means searching each machine.

**When.** You run more than one copy of any app, or need logs older than your host keeps.

**The fix.** Alloy collects every container's stdout and ships it to Loki, which stores and
searches it. The app does not change: `JsonLogger` already writes the fields Loki indexes
(`app`, `env`, `level`, `event_code`).

1. **Infrastructure:** copy `loki` and `alloy` (profile `observability`) from
   `upstream:infra/docker-compose.yml`, plus `upstream:infra/loki.config.yml` and
   `upstream:infra/alloy.config.alloy`. Set `LOKI_PORT` and `ALLOY_PORT`. Loki stores its data in
   the MinIO/S3 that already exists.
2. **Optional — reading logs back from code:** the big kit's container exposes `container.logs`, a
   `LogReader` backed by Loki. Nothing in the web app used it at the cut; port it only when
   something in lite needs to query logs:

```
upstream:packages/application/src/port/log.reader.ts
upstream:packages/infrastructure/src/loki/
upstream:packages/composition/src/fake/in-memory-log.reader.ts
```

   with `LOKI_URL` and `LOKI_TENANT_ID` in each `env.ts`, the `logs` block of `ContainerConfig`,
   `container.logs` / `hasLogs`, the `dependency.request.failed` event code, and the
   `LOKI_PORT` / `LOKI_URL` pair in `check-architecture.mjs`'s port list.
3. **What else lite removed in `LT2.4`:** the `observability` profile in `infra:up`,
   `infra:up:replica` and `compose-wait.mjs`; the `loki` bucket `minio-init` created; the
   `upstream:infra/logs/` folder Alloy tailed; and `LOKI_URL` in the CI `compose` job.

> [!NOTE]
> **A hosted log service works as well.** Any service that ingests JSON from stdout (your host's own
> log drain, Grafana Cloud, Better Stack) replaces step 1 with no code change.

Background: `upstream:docs/infra/reference/loki.md`, `upstream:docs/infra/reference/alloy.md`,
`upstream:packages/infrastructure/docs/reference/loki.md`.
