---
title: Keyset pagination
description: Why the newer lists page by cursor rather than offset, why the page carries no total, and what the cursor actually encodes.
---

# Keyset pagination

`Pagination` — `limit` and `offset` — still serves the lists that are bounded by the tenant: roles,
members, invitations. An organization has tens of roles, not tens of thousands, so the cost of
`OFFSET` there is nothing.

`Keyset` is for the ones that grow with activity: notifications, conversations, messages. **`OFFSET
40000` reads forty thousand rows in order to discard them**, and it does it on a partitioned table
where those rows are spread across months. The cost is not the page — it is every page before it.

## The page has no `total`, and that is the point

A count per page over a partitioned append-only table is precisely the cost keyset pagination exists
to avoid: an exact `count(*)` reads the same rows the `OFFSET` would have.

So the envelope is `{ items, nextCursor }`. **Null means the last page**, and it is not the same as
an empty page — a full page can still be the last one, and a client that inferred otherwise would
fetch once more every time. That is why the field exists at all rather than being derived from
`items.length < limit`.

No screen in this system shows "page 7 of 412". The ones that page this way are infinite lists.

## The query is `{ limit, cursor }`

`limit` caps at 100 and defaults to 50. The cap is in the schema rather than in a handler, so the
worker and any offline caller inherit it too.

`cursor` is absent for the first page and **opaque to the client** — it echoes back the `nextCursor`
it was handed. That is what leaves the encoding ours to change without a version field, and it is
bounded at 256 characters so it cannot become a payload.

## What the cursor encodes

`KeysetCursor` in `packages/infrastructure/src/pg/primitive/keyset-cursor.ts` is base64url over
`<iso>|<uuid>`: the sort column and the tie-break, and nothing else.

**Both halves are load-bearing.** Two rows can share a `created_at`, so the id breaks the tie; and
the timestamp keeps milliseconds, because truncating them puts rows in the same instant and a page
boundary then starts repeating or skipping one.

The query shape it pairs with is:

```sql
WHERE organization_id = $1 AND (created_at, id) < ($2, $3)
ORDER BY created_at DESC, id DESC
LIMIT $4 + 1
```

The row-constructor comparison is what makes the composite index usable — `created_at < $2 OR
(created_at = $2 AND id < $3)` is the same predicate and Postgres does not plan it as well. The
`+ 1` is how the repository knows there is another page without counting.

**A malformed cursor is a `ValidationError`, never a silent first page.** A client that reset to the
top on every corrupt token would loop through the same rows forever, and nobody would see an error
to explain why.
