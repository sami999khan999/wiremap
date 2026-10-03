---
title: REST API
description: The read-only public API at /api/v1 — authentication, the endpoints, limits, and the OpenAPI document.
---

# REST API

`https://<your wiremap>/api/v1`. It is read-only, and it takes an API key in either header:

```bash
curl -H "Authorization: Bearer $WIREMAP_API_KEY" https://wiremap.example/api/v1/projects
curl -H "x-api-key: $WIREMAP_API_KEY"            https://wiremap.example/api/v1/projects
```

A browser session does not work here: cookies are dropped before the request is handled.

| Method and path | Returns |
|---|---|
| `GET /projects?limit=&offset=` | The projects the key can read |
| `GET /projects/by-slug/{slug}` | One project, by its URL name |
| `GET /projects/{projectId}/scans` | Its scans, newest first |
| `GET /projects/{projectId}/graph?scanId=` | A five-minute link to the gzipped graph |
| `GET /projects/{projectId}/routes?scanId=` | Every HTTP route, with file and line |
| `GET /projects/{projectId}/insights?scanId=` | Coverage, cycles, unused files, unguarded routes |
| `GET /projects/{projectId}/impact?path=&scanId=` | A file's dependents by distance, and the routes among them |

`scanId` is optional everywhere: without it, the latest scan that succeeded is read.

The full schema is `GET /api/v1/openapi.json` (OpenAPI 3.1), which needs no key. It is
generated from the same contracts the web app uses, so it cannot drift from them.

**Limits.** 120 requests a minute per key. Above that, the answer is `429` with
`{"code":"RATE_LIMITED"}`. A project the key cannot read is `404`, the same as one that
does not exist.

The handler is `apps/web/src/server/orpc/public-api.ts`.
