---
title: Storage access
description: Presigned bucket links or links through the web app — what S3_ACCESS changes, how a proxied link is signed and checked, and what the route refuses.
---

# Storage access

The browser downloads graphs, and the CLI and the scan runner upload them, through
time-limited links. `StorageGateway.presignDownload` and `presignUpload` issue them. Who
serves those links is a deployment choice, set by `S3_ACCESS`.

| `S3_ACCESS` | A link points at | When |
|---|---|---|
| `presigned` (default) | the bucket itself, signed by S3 | The cloud deploy: B2 or S3 has a public endpoint, and the browser talks to it directly |
| `proxied` | the web app, `/api/storage/<key>?exp=&sig=` | The single container: the bucket has no address outside it, and one port serves everything |

## How a proxied link works

`ProxiedStorageGateway` wraps the bucket's gateway and replaces only the two `presign*` methods.
Everything else passes straight through. A link signs three things with HMAC-SHA256 under
`STORAGE_URL_SECRET`:

```
<METHOD>\n<key>\n<expiry in unix seconds>
```

So a link opens **one key, for one method, until it expires**. A download link cannot write,
an upload link cannot read, and changing the key or stretching the expiry breaks the
signature. Verification compares in constant time. The expiry is whatever the use-case
already asked for, so no use-case knows which mode is running.

`STORAGE_URL_SECRET` is its own key, not `AUTH_SECRET`. The worker issues links too (exports)
and deliberately carries no auth secret. Setting `S3_ACCESS=proxied` without the secret stops
both apps at startup, rather than quietly falling back to links nobody can reach.

## What the route does

`apps/web/src/server/storage.server.ts`, mounted at `/api/storage/`:

- **Path:** decoded segment by segment. An empty, `.` or `..` segment is refused, because a
  link signs one object, and a path that walks names another.
- **GET:** reads the first chunk before answering, so a missing object is a 404, not a 200 that
  fails partway. Then it streams the rest.
- **PUT:** streams the body into the bucket, and refuses with 413 once it passes 25 MB, the
  graph cap. Any partial object is deleted.
- **Refusals:** a wrong or expired signature is 403. When the container runs `presigned`, the
  route answers 404 to everything.

**In development:** right after a 413, Vite's dev server can answer the next request with a 500
error page. It has just cut the oversized upload's connection. A second later the same request
is a normal 404. The production server does not do this.
