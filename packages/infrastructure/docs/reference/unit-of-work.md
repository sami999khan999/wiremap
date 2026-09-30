---
title: Unit of work
description: Why AsyncLocalStorage rather than a tx parameter, how nesting behaves, and the five-line test that is the only proof the transaction is real.
---

# `PgUnitOfWork` and `TransactionScope`

```ts
public override async run<T>(work: () => Promise<T>): Promise<T> {
  return this.database.client.transaction((tx) => this.scope.within(tx, work));
}
```

Two classes, and the important one is the three-line `TransactionScope`.

## Why not a `tx` parameter

The obvious design is `save(task, tx?)` on every repository method. It works, and it puts a database
concept into `packages/application` — the one thing this architecture spends all its effort keeping
out. A port with a transaction handle in its signature is a port that describes Postgres.

`AsyncLocalStorage` is a Node built-in, costs effectively nothing, and keeps the transaction invisible
above this package. `BaseRepository` is the only reader:

```ts
protected get db() {
  return this.scope.current() ?? this.database.client;
}
```

**This is the one place ambient context is acceptable, and the reasons are specific.** The value is
scoped to a single `run()` call rather than to a request, it is written in exactly one place, and
nothing outside `BaseRepository` reads it. That is a different thing from a request-scoped container,
which [17](../../../../docs/setup/17-composition-container.md) still bans — and the difference is
lifetime, not mechanism.

## One `TransactionScope` per container, not per call

`PgUnitOfWork` and every repository must receive **the same instance**. Two scopes means two answers to
"am I in a transaction", and the repository holding the wrong one writes outside the transaction while
reading as though it is inside. Nothing fails; the audit row is simply not covered by the rollback.

This is a wiring mistake that no type catches, so it is worth checking in `container.ts` by eye.

## Nesting joins, it does not open a second connection

```ts
public override async run<T>(work: () => Promise<T>): Promise<T> {
  return this.db.transaction((tx) => this.scope.within(tx, work));
}

private get db(): DrizzleClient {
  return this.scope.current() ?? this.database.client;
}
```

**`this.db`, never `this.database.client`.** That accessor is the same one `BaseRepository` exposes:
the open transaction handle when there is one, the pool otherwise. Inside an open transaction,
drizzle's `tx.transaction()` issues a `SAVEPOINT` on the same connection, so a `run()` inside a
`run()` is one atomic unit — which is what anyone reading `run()` expects.

Off the pool it would be a **second connection and a second independent transaction**, and the
symptoms are worth naming because none of them looks like a transaction bug:

- the inner unit commits when the outer rolls back, so a failed operation leaves half its writes;
- the two can deadlock on rows the outer has already locked, and the deadlock is timing-dependent;
- every test that exercises one level passes.

That was the shipped behaviour until it was fixed, and
`tests/transaction/pg-unit-of-work.spec.ts` now pins both directions.

The consequence to know: **an inner failure that propagates rolls back the outer work too.** That is
correct, and it is why a use-case should not wrap an optional side effect in `run()` — put it after
the commit, or publish an event. An inner failure the outer callback *catches* rolls back to the
savepoint and leaves the outer work intact, which is the other assertion in that spec.

`PgOrganizationFounder.found` reaches for the same accessor for the same reason: called inside the
personal enroller's transaction it is a savepoint, called standalone it is a transaction of its own.

## What this makes true

`PgActivityLogger` writes through the same scope, so a state change and its audit row commit together
or neither does. That is the whole reason the audit trail lives in Postgres rather than in the log
stream: no external store can join a transaction it has never heard of.

It is also why the audit row doubles as a **transactional outbox**. The domain event published after
commit is a latency optimisation, not a durability mechanism — if the publish is lost, the row is still
in `activity_log`, reconciliation finds the gap, and a replay closes it. Publishing *inside* the
transaction is the tempting mistake: it holds the transaction open across a network call and reintroduces
the two-store atomicity problem the queue hop exists to avoid. The outbox drain made it until `CP4.2`,
relaying inside its claim; it claims with a lease now and relays with nothing open.

## The test is the only proof

An assertion, not a code review. `tests/transaction/pg-unit-of-work.spec.ts` runs all four
directions — commit, rollback, nesting, and the savepoint — against the local stack:

```ts
await expect(
  uow.run(async () => {
    await logger.record(actor, action, { probe: true });
    throw new Error("boom");
  }),
).rejects.toThrow("boom");

const found = await database.client
  .select({ action: activityLog.action })
  .from(activityLog)
  .where(eq(activityLog.action, action));

expect(found).toEqual([]);
```

**Test the commit case too.** A `run()` that rolls back everything — including on success — passes the
rollback assertion perfectly.

## The query-count assertion needs a seam

`DatabaseConfig` takes an optional drizzle `logger`, and that exists so "four queries" can be an
assertion rather than a claim:

```ts
counter.count = 0;
await repository.resolveFor(organizationId, userId);
expect(counter.count).toBe(4);
```

`PgCapabilityRepository.resolveFor` is the hottest query in the system. "Four queries" decays silently
— someone adds a lookup inside the loop and it becomes 4 + N, invisible at ten users and fatal at five
thousand. Without the logger seam there is no way to notice.

## The statement timeout is set here, not on the connection

`PgUnitOfWork` takes an optional `statementTimeoutMs`, and when it is set `run()` issues
`set local statement_timeout = <ms>` as the first statement of the transaction. The worker passes
120 000; the web app passes 30 000, which is already the role floor, so the statement is a no-op
there and costs one round trip per transaction.

**`SET LOCAL`, never `SET`.** This is the whole reason the knob lives here rather than on the pool.
`pg` can send `statement_timeout` as a startup parameter, and that works on a direct connection —
but through pgBouncer in transaction mode the parameter is dropped, and `SHOW statement_timeout`
reads `0`. Unlimited, on every application connection. Migration `0022` puts a floor back with
`ALTER ROLE`, and `SET LOCAL` is how a transaction raises it above that floor for work that needs
longer, because it dies with the transaction and cannot follow the server connection to the next
client.

A plain `SET` would do the opposite of what it looks like. In transaction mode pgBouncer does not
run `server_reset_query` at all, so a session-level `SET` on a pooled connection is inherited by
every client that later gets handed that connection. Measured: one client setting `7s` was followed
by twenty-five fresh clients all reading `7s`. **Nothing in this repository may issue a
session-level `SET`.**

**A nested `run()` sets nothing.** The inner call is a savepoint on the same transaction, and
`SET LOCAL` inside a savepoint outlives a rollback to it — the outer transaction would silently keep
the inner call's ceiling. `applyStatementTimeout` returns early when a transaction is already in
scope.

The spec asserts both directions with two values that are neither the default: 25 s on the pool,
90 s inside `run()`, and 25 s again on the pool afterwards. A `SET LOCAL` that never ran and one
that leaked both fail it.
