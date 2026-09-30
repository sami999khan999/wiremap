---
title: Tests to run
description: Every test run the lite kit build still owes, by plan item, with the commands, so the build can go ahead on typecheck alone and the runs can be done in one pass.
---

# Tests to run

From `LT2.6` on, the build goes ahead on typecheck and `check:architecture` alone, and the owner
runs the tests. This page lists every run still owed. Tick a row when it has passed; if it fails,
add a line under it saying what failed.

**Last full pass:** `d7ba5b3` (`LT2.5`), 2026-10-01. Every package's suite, `pnpm smoke` and
`boot-smoke.mjs` for all three apps were green. The only red `check:architecture` assertion is the
partition allowlist, which `LT2.8` clears.

## The standard pass

Run the whole block after any item below, and again once at the end.

```bash
pnpm install
node tooling/scripts/compose.mjs up -d --remove-orphans   # five containers
pnpm build:packages
pnpm --filter @loadbearing/web build
pnpm db:migrate && pnpm db:seed
pnpm -r --no-bail run typecheck
pnpm lint
pnpm -r --no-bail run test          # not `pnpm test`: that stops at the first red package
CI= node tooling/scripts/check-architecture.mjs
pnpm check:contrast && pnpm deps:check && pnpm repo:check
pnpm smoke                          # needs the containers
pnpm --filter @loadbearing/worker build && pnpm --filter @loadbearing/realtime build
for app in worker web realtime; do node --env-file=.env tooling/scripts/boot-smoke.mjs $app; done
```

The local `.env` needs a real `AUTH_SECRET` (`openssl rand -hex 32`); the template's `change-me` makes
the web app answer 500.

## Owed, by item

| Item | What to run | Status |
|---|---|---|
| `LT2.6` env | The standard pass. No code changed, so this only confirms nothing regressed. | [ ] |
| `LT2.7` worker | The standard pass. `apps/worker` tests and `boot-smoke.mjs worker` matter most: a consumer or schedule removed there shows up only when the process boots. | [ ] |
| `LT2.8` baseline | `pnpm infra:reset` (or drop the `pgdata` volume), then `pnpm db:migrate && pnpm db:seed` on the new `0000_lite_baseline.sql`. Diff `pg_dump --schema-only` of that database against one from before the cut, minus the cut tables. `check-architecture` must then pass all 30. The infrastructure suite runs against the new schema. | [ ] |
| `LT1.6` docs | `CI= node tooling/scripts/check-architecture.mjs`, since §15 checks every path the docs name. Then `grep -ri "messag\|widget\|zone\|clickhouse"` should find only notification transport and back-port notes. | [ ] |
| `LT3` owner audience | The standard pass, plus `packages/application/tests/doc/doc-access.spec.ts`. The manual check with alice, bob and a signed-out visitor is below. | [ ] |
| `LT4` search | The standard pass, plus the three specs in the plan's proof table. The manual check in all three modes is below; it needs real Gemini and OpenAI keys. | [ ] |
| `LT5` tooling and CI | Push, then confirm CI is green on the first run. That is the plan's exit, and nothing local proves it. | [ ] |

## Manual checks, at the end

From the plan's verification section. Users alice, bob and carol (`Correct-Horse-9`), web on
port 23000, mail in Mailpit on 28025, with the worker running.

- [ ] Sign up and verify through Mailpit, which shows that the worker's mail path works.
- [ ] Invite a user to an org and grant a role. Enable 2FA and create an API key.
- [ ] Toggle a flag and an entitlement in platform admin.
- [ ] As a platform admin, export a tenant, then delete one on the accounts page. After a delete, its
      `cold/` objects stay for 30 days and `pnpm db:partitions --sweep <id>` removes them early.
- [ ] The dashboard shows the module nav and the member count, and the bell only for members who
      hold `notification.inbox.read`.
- [ ] The docs audience matrix from `LT3`.
- [ ] AI search in all three modes from `LT4`. With `none` there are no outbound calls.
- [ ] A notification arrives in realtime.
