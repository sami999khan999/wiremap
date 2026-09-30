-- Hand-written: drizzle-kit writes DDL, and this is a role setting. It is the timeout
-- floor that survives a transaction pooler, and without it a pooled deployment has none.
--
-- `pg` sends statement_timeout as a *startup parameter*. pgBouncer in transaction mode
-- must be told to ignore it (IGNORE_STARTUP_PARAMETERS) or it refuses the connection
-- outright -- and once ignored the parameter is not weakened, it is gone: `SHOW
-- statement_timeout` through the pooler reads `0`, unlimited, on every application
-- connection. These three settings are the server-side replacement.
--
-- CURRENT_USER, because the role name is the deployment's and not the repository's. That
-- makes one thing load-bearing: the role running this migration must be the role the
-- application connects as. A deployment that separates them lands the floor on the
-- migrator and leaves the application at `0`. See docs/infra/reference/pgbouncer.md.
--
-- Applies to new sessions only. A pgBouncer server connection already open when this
-- lands keeps its old value until it is closed, so the deploy step is RECONNECT on the
-- pgBouncer console -- never a restart, which drops client sockets and exits the worker.
--
-- 30s matches DATABASE_STATEMENT_TIMEOUT_MS for the web app. The worker's longer budget
-- is a SET LOCAL inside PgUnitOfWork.run, which is transaction-scoped and pooler-safe.
ALTER ROLE CURRENT_USER SET statement_timeout = '30s';--> statement-breakpoint
-- The forgotten-`await` guard: a transaction left open holds a pooler server slot as
-- well as a connection, so the cost of one is paid by every other client.
ALTER ROLE CURRENT_USER SET idle_in_transaction_session_timeout = '60s';--> statement-breakpoint
-- Short on purpose. Partition DDL takes ACCESS EXCLUSIVE on the parent table, so a drop
-- that waits is a drop with every reader of that table queued behind it.
ALTER ROLE CURRENT_USER SET lock_timeout = '10s';
