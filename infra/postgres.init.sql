CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
-- The measurement that answers "which query" before any scaling move. Needs
-- `shared_preload_libraries=pg_stat_statements`, which the compose `command` sets.
--
-- This file is a docker-entrypoint-initdb.d script, so it runs on a **first boot only**.
-- A machine with an existing pgdata volume needs this statement by hand, or the flag is
-- on and the view is absent. See docs/scale/pgbouncer.md.
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;
