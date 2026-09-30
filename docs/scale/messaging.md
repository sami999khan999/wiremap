---
title: Messaging
description: Bringing back direct and group messages — a product feature left out of lite, which rides on the realtime app lite already runs.
---

# Messaging

**Not a scale limit** — a product feature lite left out. Conversations, messages, typing
indicators, edits and deletes. It uses the realtime app and outbox that lite already runs, so no new
infrastructure is needed.

## What to copy

One whole slice, every layer:

```
upstream:packages/permissions/src/{catalog,gate,route}/messaging.*
upstream:packages/contracts/src/messaging/
upstream:packages/contracts/src/catalog/   (the messaging entries)
upstream:packages/infrastructure/src/pg/schema/   (the conversation and message schema)
upstream:packages/infrastructure/src/pg/repository/   (the conversation and message repositories)
upstream:packages/application/src/messaging/
upstream:packages/query/src/messaging/
upstream:packages/content/src/message/{en,bn}/   (the messaging namespaces)
upstream:packages/feature/src/messaging/
upstream:apps/web/src/server/orpc/   (the messaging routers)
upstream:apps/web/src/route/(app)/_authenticated/messages/
```

Bring the tests along from each package's `tests/messaging/`.

**Migrations to read:** `0018_messaging_grants`, `0033_conversation_keyset`,
`0037_conversation_fk_drop`, `0041_conversation_created_at_ms`, plus the message tables in the
earlier migrations. Regenerate the tables from the schema file; hand-port only the grants.

**Check** that notifications for new messages still flow through the outbox, and that the feature's
error codes have copy in both locales.
