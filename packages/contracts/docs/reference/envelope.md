---
title: envelope
description: One list shape for the whole product, and why the pagination cap lives in the schema.
---

# `Envelope` and `Pagination`

```ts
export class Envelope {
  public static paginated<T extends z.ZodType>(item: T): z.ZodObject<{
    items: z.ZodArray<T>;
    total: z.ZodNumber;
    limit: z.ZodNumber;
    offset: z.ZodNumber;
  }>;

  public static readonly acknowledged: z.ZodObject<{ ok: z.ZodLiteral<true> }>;
}

export class Pagination {
  public static readonly query: z.ZodObject<{
    limit: z.ZodDefault<z.ZodNumber>;
    offset: z.ZodDefault<z.ZodNumber>;
  }>;
}
```

---

## Decide the list shape once

Every list procedure in the product returns `{ items, total, limit, offset }`. Not because that
shape is uniquely correct, but because *one* shape is worth far more than the best shape:

- `@loadbearing/query` writes one `useList` and one cache-invalidation rule instead of one per
  feature.
- `@loadbearing/ui` writes one empty state, one "showing 25 of 340", one pager.
- A partner integrating over REST learns the pagination protocol once.

Left to each feature, one returns `{ data, meta }`, the next `{ results, nextCursor }`, and the
third an array. Now the query layer has a special case per feature and the UI has a different empty
state per feature, forever.

## `max(100)` is a denial-of-service guard in a schema

```ts
limit: z.number().int().positive().max(100).default(25),
```

Putting the cap here rather than in a handler means it also applies to the worker, to the desktop
app's offline queue, and to any future NestJS implementation of the same contract — every consumer
of the contract, not just the one HTTP route someone remembered to guard.

`.default(25)` means a caller may omit both fields entirely and still get a bounded query. The
common case needs no ceremony; the dangerous case is impossible.

## `paginated` is a function, not a schema

It takes the item schema and returns the envelope around it, so `total` / `limit` / `offset` are
declared once and the item type flows through to the inferred output. The alternative — a
hand-written envelope per resource — drifts the moment someone adds a `hasMore` to one of them.

The generic is `T extends z.ZodType`, Zod 4's base schema type. `z.ZodTypeAny` is the Zod 3 spelling
and is deprecated; it still resolves, which is exactly why it is worth not writing.

## `acknowledged` is a closed literal

```ts
z.object({ ok: z.literal(true) })
```

`z.literal(true)`, not `z.boolean()`. A procedure that returns this returns success or it throws —
there is no `{ ok: false }` to branch on, because a failure is an `AppError` with a code, not a
falsy field a caller can forget to check. See [errors](../../../errors/docs/index.md).
