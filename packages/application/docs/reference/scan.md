---
title: Scans
description: A scan's states and triggers, the runner protocol's use-cases, how completion records counts and findings, and where the graph lives.
---

# Scans

A scan is one build of a project's graph. Postgres keeps the scan row, its counts and the
project's open findings. **The graph itself is a file in storage**
(`graphs/<org>/<project>/<scan>.json.gz`).

`scans` is partitioned by tenant, then by month. `scan_findings` is partitioned by tenant only.
Both are routed: each lives on its tenant's node.

## States

```
queued → running → succeeded
   ↘        ↘
    failed ← failed
```

A transition names the states it moves from (`ScanRepository.start`, `succeed`, `fail`), so a
late or replayed callback cannot move a finished scan.

## Triggers

| Trigger | From | Use-case |
|---|---|---|
| `manual` | "Scan now" (`scan.run`, `project.scan.run`) | `RunScanUseCase` → `QueueScanUseCase` |
| `push` | `/api/github/webhook`, a push to a branch the project tracks | `HandleGithubWebhookUseCase` names the targets; `TriggerScanUseCase` queues each on its tenant's node |
| `schedule` | The hourly `scan-schedule` job. `ProjectRepository.claimScheduled` claims and marks due projects in one statement | `TriggerScanUseCase` |
| `upload` | `wiremap upload` / `wiremap scan` (`scan.createUpload`, an API key holding `project.scan.run`) | `CreateScanUploadUseCase` makes a running scan and a presigned PUT |

**One queued or running scan per project.** A second trigger gets the first scan back
(`ScanRepository.active`).

## Completion

`CompleteScanUseCase` reads the graph back through `GraphArchive`. The archive checks the size,
then the gzip, then the schema. **What Postgres records is what the file says, not what the runner
claims.**

It then does three things:
- records counts: files, imports, the resolved and total coverage, routes, cycles, unguarded
  routes and unused files;
- diffs the findings, cycles keyed by sorted members and unguarded routes by id, against the
  project's open ones;
- publishes `scan.succeeded` and one `finding.created` per new finding, up to 50, through the
  outbox.

A refused graph fails the scan with the reason.

## Reading a graph

`scan.graph` (`project.graph.read`) returns a five-minute presigned GET for the latest succeeded
scan, or for one scan by id. The browser fetches it directly and caches it by scan id, since a
graph never changes. The bucket must allow the app's origin in its CORS rules; MinIO allows any
origin by default.

The protocol, the token and the runner are in [scan runner](../../../../docs/infra/scan-runner.md).
