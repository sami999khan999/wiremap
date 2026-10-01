# 26 · Hygiene and CI

> Hooks that catch mistakes before they leave your machine, and a pipeline that catches the ones that get past them.

**Delivers:** Pre-commit formatting, conventional commits scoped to real packages, and a CI job that enforces the three architectural rules a type checker cannot see.

**Prerequisite:** [25 · `apps/worker`](25-worker-app.md)

---

## Step 26.1 — Hooks

```bash
pnpm add -Dw husky lint-staged @commitlint/cli @commitlint/config-conventional
pnpm exec husky init
```

**`.husky/pre-commit`**

```sh
pnpm exec lint-staged
```

**`.husky/commit-msg`**

```sh
pnpm exec commitlint --edit "$1"
```

**`.lintstagedrc.json`**

```json
{
  "*.{js,jsx,ts,tsx,json,jsonc,css}": ["biome check --write --no-errors-on-unmatched"]
}
```

> [!CAUTION]
> **Do not add a `*.{md,yml,yaml}` entry for Biome.** Biome does not format Markdown or YAML —
> verified on 2.5.7, where `biome format` on a `.md` or `.yaml` file reports
> `Checked 0 files`. Combined with `--no-errors-on-unmatched`, such an entry is a **silent
> no-op**: the hook reports success and formats nothing.
>
> Dropping Prettier therefore left Markdown and YAML formatted by no tool at all. That is fine
> for hand-wrapped prose — it is why `docs/` was excluded from Prettier in the first place — but
> know that it is the situation rather than discovering it from an inconsistent diff. If you
> want them formatted, add a dedicated formatter (`prettier --write "**/*.{md,yml,yaml}"` as a
> separate devDependency scoped to those extensions only) and give it its own lint-staged entry.

**`lint-staged` runs on staged files only**, so a commit touching two files takes a second rather than linting 14 packages. Do not add `tsc --noEmit` here — type checking is inherently whole-project and would make every commit take a minute. That belongs in CI.

**Biome only in the hook — no ESLint.** Biome finishes in milliseconds; ESLint's typed rules need a whole program and would put ten seconds on every commit. A hook that slow gets disabled, and a check that runs is worth more than a thorough check that doesn't.

**`--no-errors-on-unmatched`** stops the hook failing when a staged file is one Biome does not handle.

**`.husky/pre-push`** is where the slow pass goes:

```sh
pnpm lint:fast
pnpm exec eslint .
pnpm check:architecture
pnpm check:contrast
```

ESLint's six architecture rules still block a merge — they run here and in CI, not on every commit.

**The two `check:*` scripts belong here rather than in `lint-staged`**, for the reason above
inverted: both read the *whole* repository, so a staged-file hook cannot express them, and both
finish in about a second, so a push hook can. Between them they catch a comment block over two
lines, a framework import in the domain, and a palette that fails AA — none of which ESLint sees.

**`typecheck` and `test` stay in CI.** Both are minutes, and a hook people learn to `--no-verify`
past checks nothing at all.

> [!NOTE]
> ESLint 9 resolves flat config from the **working directory** rather than per file. With a single root config ([05](05-lint-and-format.md)) that is a non-issue: both this hook and CI run `eslint .` from the repo root, so there is exactly one config and one rule set.

---

> [!IMPORTANT]
> **`.lintstagedrc.js` chunks the file list, and the limit is Windows', not Biome's.**
> lint-staged passes every staged path to one command; Windows caps a command line at 8191
> characters, which paths this long reach at around sixty files. The commit then fails with
> `The command line is too long` **after** lint-staged has stashed — so the working tree is
> restored, nothing names path length as the cause, and committing per layer hides it, which is
> why it went unnoticed. Forty paths per invocation is roughly a quarter of the limit.
>
> The glob carries `mjs` and `cjs` as well. Every script in `tooling/scripts/` is `.mjs`, so
> without them `pnpm lint` caught their formatting and the hook never did.

## Step 26.2 — Commit scopes

**`commitlint.config.js`**

```js
export default {
  extends: ["@commitlint/config-conventional"],
  rules: {
    "scope-enum": [
      2,
      "always",
      [
        "errors", "core", "permissions", "observability", "contracts", "application",
        "infrastructure", "auth", "composition", "asset", "content", "api-client",
        "query", "ui", "feature", "web", "worker", "desktop",
        "tooling", "infra", "docs", "deps", "repo",
      ],
    ],
    "scope-empty": [2, "never"],
  },
};
```

```
feat(permissions): add goal-scoped intersect
fix(infrastructure): index capability lookup by user_id
chore(deps): bump drizzle-orm
```

**A closed scope list is the point.** It forces a decision — *which package does this change belong to?* — at commit time. A commit that genuinely spans six packages usually wants splitting, and the enum is what surfaces that. It also makes `git log --grep "(permissions)"` a usable ownership tool, which pairs directly with the team ownership model: one team, one glob, one scope.

**Update this list whenever you add a package.** A rejected commit is the reminder.

---

## Step 26.3 — The pipeline

**`.github/workflows/ci.yml`**, less the `compose` job ([26.3b](#step-263b--the-compose-job)):

```yaml
name: ci
on:
  push: { branches: [main] }
  pull_request:

jobs:
  verify:
    runs-on: ubuntu-latest
    services:
      # pgvector, not stock postgres:17 — 0001's `vector(1536)` column and its hnsw
      # index will not apply otherwise. The image ships the extension available; the
      # "extensions" step below is what actually creates it.
      postgres:
        image: pgvector/pgvector:pg17
        env:
          POSTGRES_USER: ratchet
          POSTGRES_PASSWORD: ratchet
          # `ratchet`, not `ratchet_test`: packages/infrastructure/tests/support/database.ts
          # pins the local scratch URL, so a differently-named database fails every
          # infrastructure spec with a connection error rather than an assertion.
          POSTGRES_DB: ratchet
        ports: ["5432:5432"]
        options: >-
          --health-cmd "pg_isready -U ratchet"
          --health-interval 5s --health-timeout 5s --health-retries 10
      # One instance, as in the lite stack: the cache and the queue share it by URL.
      redis:
        image: redis:7-alpine
        ports: ["6379:6379"]
        options: >-
          --health-cmd "redis-cli ping"
          --health-interval 5s --health-timeout 5s --health-retries 10

    env:
      DATABASE_URL: postgres://ratchet:ratchet@localhost:5432/ratchet
      REDIS_CACHE_URL: redis://localhost:6379
      REDIS_QUEUE_URL: redis://localhost:6379
      # Read by every `env.ts` like any other config, so a missing one is a startup
      # crash.
      APP: ci
      ENV: test
      PGPASSWORD: ratchet
      # Required by both `env.ts` schemas, and no container answers them: nothing in
      # this job sends a message. A shape that parses is the whole requirement.
      SMTP_URL: smtp://localhost:1025
      EMAIL_FROM: ci@localhost
      APP_BASE_URL: http://localhost:3000

      # Every remaining key both `env.ts` schemas require. Without them the job passed
      # only because nothing ever evaluated `Env` — the boot smoke below does, so a
      # key missing here is now a failure rather than a deploy-time surprise.
      # Like SMTP_URL above, no container answers these: every S3 path in this job's
      # suite runs against a fake, and the smoke suite that does reach one is excluded
      # from `pnpm test` and runs in `compose`. A shape that parses is the requirement.
      S3_ENDPOINT: http://localhost:9000
      S3_REGION: us-east-1
      S3_BUCKET: ratchet
      S3_ACCESS_KEY: ratchet
      S3_SECRET_KEY: ratchetsecret
      S3_FORCE_PATH_STYLE: "true"

      # Thirty-two characters because the schema demands it, and obviously disposable
      # because this is a public workflow file.
      AUTH_SECRET: ci-secret-not-a-real-key-000000000000
      AUTH_URL: http://localhost:3000
      AUTH_TRUSTED_ORIGINS: http://localhost:3000
      AUTH_SESSION_MAX_AGE_SECONDS: "604800"
      AUTH_COOKIE_CACHE_MAX_AGE_SECONDS: "60"

      EMBEDDING_MODEL: text-embedding-3-small
      EMBEDDING_DIMENSIONS: "1536"

      REALTIME_MAX_STREAMS_PER_USER: "8"
      REALTIME_STREAM_MAX_AGE_SECONDS: "1800"

    steps:
      - uses: actions/checkout@v4
        with: { fetch-depth: 0 }

      # Reads the root manifest's `packageManager` field and nothing else — a root that
      # declares only `devEngines.packageManager` fails here in seconds, before a single
      # check runs. Assertion 16 keeps the two in step.
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version-file: .nvmrc
          cache: pnpm

      - run: pnpm install --frozen-lockfile

      # Compose mounts this as an initdb script; a `services:` container starts before
      # checkout, so there is nothing to mount and it has to be applied by hand.
      - name: Create Postgres extensions
        run: psql -h localhost -U ratchet -d ratchet -f infra/postgres.init.sql

      # Before the build, because both are pure file reads and both fail in seconds.
      # syncpack catches one dependency on two version lines across packages; sherif
      # catches a workspace directory with no `package.json` and a package with no
      # version. Neither is caught by anything else in this job, and dependency drift
      # that nothing checks is dependency drift nobody finds until an install breaks.
      - run: pnpm deps:check
      - run: pnpm repo:check

      - run: pnpm build:packages

      # Before `typecheck`, and that is not an optimisation. `apps/web/src/route-tree.gen.ts`
      # is generated by the TanStack plugin and gitignored, so a clean checkout has no
      # route tree and every `createFileRoute` call in the app fails to typecheck — 48
      # errors, all cascading from one missing module. This build is what writes it.
      - run: pnpm --filter @loadbearing/web build

      - run: pnpm typecheck
      - run: pnpm lint

      # packages/infrastructure's specs are integration tests against a real Postgres,
      # and they read the seeded organization rather than creating one. Without both
      # steps every one of them fails on "run `pnpm db:seed` first". The URL they use
      # is pinned in packages/infrastructure/tests/support/database.ts.
      - run: pnpm db:migrate
      - run: pnpm db:seed

      - run: pnpm test

      # The node apps, because `tsc -p` is the only thing that compiles each and
      # `pnpm build:packages` filters to ./packages/*.
      - run: pnpm --filter @loadbearing/worker build
      - run: pnpm --filter @loadbearing/realtime build

      # The two steps that start a process. Everything above them runs against source and
      # cannot tell that a variable is missing, because `env.ts` parses at module load.
      # The web one also proves a request completes: `T-032` was a bundle that built,
      # imported, listened, and answered 500 on every page.
      - run: node tooling/scripts/boot-smoke.mjs worker
      - run: node tooling/scripts/boot-smoke.mjs web
      - run: node tooling/scripts/boot-smoke.mjs realtime

      # The web build above is also what makes this pass rather than skip:
      # `check:architecture`'s bundle assertion greps the built client output, and
      # `build:packages` filters to ./packages/*. Under `CI=true` a skip fails the run.
      - run: pnpm check:architecture
      # Every palette against every text pairing — 117 of them across five themes and
      # both modes. With one theme this is judgement; with five it is the only thing
      # between a contributor and an unreadable one.
      - run: pnpm check:contrast

  # Deliberately its own job, and deliberately not required. Blocking a merge on a
  # transitive advisory nobody can fix today is how people learn to ignore a red build —
  # and once they do, the advisories that *are* actionable are ignored with them.
  # Advisories are filtered by GHSA id in pnpm 11 (`auditConfig.ignoreGhsas`), not CVE.
  audit:
    runs-on: ubuntu-latest

    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version-file: .nvmrc
          cache: pnpm

      - run: pnpm install --frozen-lockfile

      # `continue-on-error` on the *step*, not the job. At job level the conclusion is
      # always `success`, so the result is unreadable from the checks list and from any
      # branch rule — the job cannot signal at all. Here the step is allowed to fail and
      # the summary below says what it found.
      - id: audit
        continue-on-error: true
        run: pnpm audit --audit-level high | tee audit.txt

      # Where the result becomes readable. A failed step with no summary is a green job
      # and a line nobody scrolls to.
      - name: Summarise
        if: always()
        run: |
          {
            echo "## pnpm audit"
            if [ "${{ steps.audit.outcome }}" = success ]; then
              echo "No advisories at high or above."
            else
              echo "Advisories at high or above. Not blocking a merge."
              echo "Silence one deliberately with auditConfig.ignoreGhsas in package.json."
              sed 's/^/    /' audit.txt
            fi
          } >> "$GITHUB_STEP_SUMMARY"
```

> **CI needs `APP` and `ENV`.** They are read by `env.ts` like any other config — a missing one is a startup crash, and finding that out in CI is the entire point. `SMTP_URL` and `EMAIL_FROM` are there for the same reason and no container answers them: nothing in the job sends a message, so a shape that parses is the whole requirement.

> [!CAUTION]
> **`pnpm/action-setup@v4` reads the root manifest's `packageManager` field and nothing else.** A
> root that declares only `devEngines.packageManager` — the newer field, and the one
> [03](03-workspace-and-catalogs.md) writes — makes the action fail in seconds with *"No pnpm
> version is specified"*, before a single check has run. Declare **both** — which this repository now
> does, with assertion 16 keeping them in step. The failure is easy to miss precisely because it is
> not a check failing: the job is red twenty seconds in, every time, on every branch, and the checks
> below it never ran at all. It was, here, for weeks.

> [!IMPORTANT]
> **Four steps here look like padding and each one closes a specific hole.** The extensions step
> exists because compose mounts `infra/postgres.init.sql` as an initdb script and a `services:`
> container starts *before* checkout, so there is nothing to mount. `db:migrate` and `db:seed` run
> because `packages/infrastructure`'s specs are integration tests that read the seeded organization
> rather than creating one. `deps:check` and `repo:check` run **before** the build because both are
> pure file reads that fail in seconds, and neither is caught by anything else in the job. And the
> web build runs before `check:architecture` because the bundle assertion greps the built client
> output — without it the assertion reports `○ skipped`, not a pass.
>
> **`POSTGRES_DB` is `ratchet`, not `ratchet_test`.** `packages/infrastructure/tests/support/database.ts`
> pins the scratch URL, so a differently-named database fails every infrastructure spec with a
> connection error rather than an assertion — which reads as infrastructure being down.
> `packages/composition/tests/support/config.ts` pins the same one, plus both Redis URLs: a
> `Container` opens a cache client and a queue client in its constructor. In lite both URLs name
> the one `redis` service, as they do in the local stack. Splitting them is
> [Split Redis](../scale/split-redis.md).

> [!CAUTION]
> **That web build is not optional.** `check:architecture`'s third assertion greps the built *client* output for server-only fingerprints. `build:packages` filters to `./packages/*` and never builds `apps/web`, so without this step the grep runs over a directory that does not exist — it passes silently and gives you permanent false confidence that no server code is reaching the browser.
>
> This is exactly the failure the note in Step 26.4 warns about, and the pipeline is where it actually bites. Make the script fail when it finds zero asset files, so a missing build is loud rather than green.

**Services, not Docker Compose.** GitHub's `services` block gives health-checked containers on localhost with no compose file to keep in sync. The `pgvector` image is required — the vector migration will not apply on stock `postgres:17`.

**`fetch-depth: 0`** gives you full history. Shallow clones break any future `--filter` or changed-files logic, and debugging that in CI is miserable.

**`--frozen-lockfile`** fails the build if `pnpm-lock.yaml` does not match `package.json`. That is the whole reason to commit a lockfile.

**pnpm 11 has a `pnpm ci` command** (`pnpm clean` followed by a frozen install). It is the better choice on a runner with a persistent workspace; on GitHub's ephemeral runners there is nothing to clean, so the explicit form above costs nothing and reads more clearly.

**`pnpm/action-setup` still installs pnpm**, and the version it installs barely matters — pnpm resolves the pinned version from the lockfile on first invocation. Leave the action's `version` input unset, but **the root must declare `packageManager` as well as `devEngines.packageManager`**: the action reads only the former, and with only the latter it fails before installing anything. That is not a hypothetical — it is what the CAUTION above describes, and this paragraph used to say the opposite. Assertion 16 in `check:architecture` now fails if the two disagree or either is missing.

**Order matters.** Build before typecheck, because packages consuming `dist/` types need them to exist. Lint before test, because a lint error is a two-second answer and a failing test suite is a two-minute one.

**And the web build comes before typecheck, not after.** `apps/web/src/route-tree.gen.ts` is written by the TanStack plugin and gitignored, so a clean checkout has no route tree — every `createFileRoute` call then fails to typecheck, 48 errors cascading from one missing module. This is not hypothetical: it is what the first CI run that got past `pnpm/action-setup` reported, and it means the repository had never been typecheckable from a clean clone. The same build is what stops `check:architecture`'s bundle assertion reporting `○ skipped`.

---

## Step 26.4 — The thirty-one architectural assertions

Types cannot express "this package must not import that one across a bundle boundary". Twenty-nine greps can.

**`tooling/scripts/check-architecture.mjs`** — add `"check:architecture": "node tooling/scripts/check-architecture.mjs"` to the root scripts. Zero dependencies, plain Node, and it prints one line per assertion:

```
✓ `application` imports no framework
✓ every `@orpc/*` entry is on one version line
✓ comments are `//`, never a block
○ no server code in the client bundle — skipped: apps/web has no client build
```

> [!IMPORTANT]
> **A skipped assertion prints `○`, never `✓`.** Two of these depend on artefacts that may not exist yet — a built `dist/`, a built client bundle — and an assertion that quietly passes when it did not run is worse than no assertion, because it converts an unknown into a false guarantee. The same reason the bundle check fails rather than passes when it finds zero asset files.
>
> **Write the failing case before you trust any of them.** Every runnable assertion here was verified by introducing its violation and watching it fail: a `drizzle-orm` import in `application`, a `process.env` read outside `env.ts`, `@orpc/server` skewed back to `^1.13.7`, a block comment in `src/`, a top-level `await` appended to a built barrel. A grep nobody has seen fail is a grep nobody should believe.

### 1 — `application` imports no framework

```js
// fail if packages/application/src/** imports any of these
const FRAMEWORKS = [
  "@orpc/", "@tanstack/", "@nestjs/", "drizzle-orm", "ioredis", "bullmq",
  "@aws-sdk/", "better-auth", "pg", "express", "fastify", "hono",
];
```

`application` defines ports and use-cases. The moment it imports `drizzle-orm`, the dependency inversion is decorative — you can no longer test a use-case without a database, and swapping an adapter means editing the domain.

**ESLint's boundary rules already cover this**, but a grep is independent of ESLint config, cannot be disabled with an inline comment, and keeps working if someone reorganises the lint setup.

### 2 — `application` does not log

```js
// fail if packages/application/src/** imports @loadbearing/observability
```

The domain layer records business facts through `ActivityLogger` and throws typed errors; diagnostics belong to the adapters ([12](12-application-package.md)). This is the grep that keeps a `logger.emit` from appearing inside a use-case under deadline, and with it the request context that would have to be threaded there to make it useful.

### 3 — Only `env.ts` reads `process.env`

```js
// fail on any process.env outside apps/*/src/env.ts
```

Every other `process.env` read is an unvalidated string that becomes `undefined` in production. This rule is what makes the `Env` classes trustworthy — it is not a style preference, it is the enforcement of a single validated boundary.

> [!IMPORTANT]
> **This exemption list and Biome's `noProcessEnv` overrides must stay in step.** They are two
> statements of the same rule in two tools, and a path exempted in one and not the other is either a
> gate that passes while the rule is broken, or a build that fails for no reason. The set is:
> `apps/*/src/env.ts`, any `*.config.*`, and the four runnable scripts above `src/` —
> `infrastructure/{migrate,seed,smoke}.ts` and `auth/tables.ts`, the last being schema inspection
> run by hand against a throwaway URL
> ([16](16-auth-package.md)), which had a Biome exemption and no matching one here.

> [!NOTE]
> **The `*.config.*` exemption is anchored, not a bare glob.** `**/*.config.ts` also matched
> `composition/src/container/container.config.ts` and `auth/src/factory/auth.config.ts` — runtime
> code carrying a role suffix, exempted from a security-shaped rule by an accident of naming. The
> pattern now matches a config at the repository root, a package root or an app root and nowhere
> else, and `biome-config/src/base.json` carries the same three shapes: a path exempted in one and
> not the other is either a gate that passes while the rule is broken, or a build that fails for no
> reason.
>
> **Comments are stripped before the test**, because a line explaining that `process.env` is banned
> in a file is not a read of it — and this assertion used to fail on its own documentation.

### 4 — Every `@orpc/*` entry is on one version line

```js
// fail if the @orpc/* entries in pnpm-workspace.yaml carry more than one range
```

**Each `@orpc/*` package pins `@orpc/shared` to its own exact version** in its own manifest — `@orpc/server@1.15.0` depends on `@orpc/shared@1.15.0`, not `^1.15.0`. There is no catalog entry for it and there should not be: the pinning is upstream's, which is exactly why a skew between our four catalog ranges puts two copies of `@orpc/shared` in the tree rather than resolving to one. `syncpack lint` cannot see this: it checks that one dependency carries the same range across packages, and has no concept of a group that must move together. The catalog's tiering ([03](03-workspace-and-catalogs.md)) deliberately splits these entries across two tiers for portability reasons, which makes an automated check the only thing holding them level.

Worth writing because it already happened: the catalog shipped `@orpc/server` at `^1.13.7` under a comment reading *"pin all four together"*, and every check in the repository passed.

### 5 — Comments are `//`, never a block

```js
// fail on any line in {packages,apps}/*/{src,tests} whose trimmed form starts with /* or {/*
```

[Opinions · Comments](../opinions/comments.md) bans block comments outright, and neither Biome nor ESLint ships a rule that expresses it. Anchoring to the start of a trimmed line is what makes this safe: Biome always formats a block comment onto its own line, so a glob like `"**/dist/**"` inside a string cannot be mistaken for one.

**It walks `apps/*` as well as `packages/*`, and it matches the JSX form.** Both were gaps rather than decisions: an assertion about how source is written has no reason to stop at `packages/`, and `{/* … */}` is the form a React file reaches for — twenty-two of them were invisible to this check until it named the shape. The JSX replacement is an expression container holding `//` lines.

Generated files are skipped by name (`*.gen.ts`, `*.gen.tsx`). `apps/web/src/route-tree.gen.ts` asks in its own header to be excluded from every checker pointed at it, and it is written by the route generator rather than by anyone.

### 6 — No top-level `await` in a built barrel

```js
// fail on /^(await |(var|let|const) \w+ = await )/ in any packages/*/dist/index.js
```

The default NestJS and Express scaffold is CommonJS, and a CJS consumer reaches an ESM package through `require(esm)` — unflagged on Node 22.12+, which this repo's `engines` floor guarantees. It refuses any module graph containing a top-level `await`.

So a TLA in a package barrel breaks every CJS consumer, with an error naming the wrong thing. Nothing today has one; this is what keeps it that way. **Skips when no `dist/` exists**, so run it after `build:packages`.

> [!NOTE]
> **Depth, not column zero.** The original test anchored `await` to the start of a line, which is
> what an unwrapped `tsup` barrel happens to emit and nothing guarantees: a bundler that indents a
> wrapped module, or any minified output, walks straight past it. It now tracks bracket depth
> through strings and comments and reports the first `await` at depth zero — so an `await` inside a
> function is still fine, which is the distinction the anchor was standing in for.

### 7 — `"use client"` only in `ui`, `query`, `feature`

```js
// fail on /^\s*["']use client["']/m in any other package's src/
```

The dangerous direction is not a missing directive — that fails loudly at the consumer's build. It is a directive added to an isomorphic package to make one import stop complaining, which silently breaks SSR of translated copy and authorization inside a Server Component ([06](06-package-anatomy.md)).

### 8 — No server code in the client bundle

```bash
pnpm --filter @loadbearing/web build
# then grep the client output for server-only fingerprints
```

```js
// Absent from the WHOLE client output.
const FINGERPRINTS = ["drizzle-orm", "pg-pool", "@aws-sdk/client-s3", "ioredis", "bullmq"];

// Absent from the ENTRY chunk. A locale string in a lazily-loaded chunk is correct.
const ENTRY_FINGERPRINTS = ["সংরক্ষণ"];

// Absent from the whole client output, like the server list above.
const EMAIL_FINGERPRINTS = [
  "email.digest.", "email.verify.", "email.reset.", "email.change.", "email.otp.",
  "email.invitation.", "email.notification.",
];

// Field names from the `env.ts` schemas. Also absent from the whole client output.
const ENV_FINGERPRINTS = [
  "REDIS_QUEUE_URL",
  "S3_FORCE_PATH_STYLE",
  "AUTH_COOKIE_CACHE_MAX_AGE_SECONDS",
  // The OAuth client secret. It reaches `Env` and nothing else — the sign-in page
  // learns whether Google is configured from the session snapshot, not this schema.
  "GOOGLE_CLIENT_SECRET",
  "AUTH_ENROLMENT_MODE",
  // Enforced in the subscriber adapter, so a client that knew it could only work around it.
  "REALTIME_MAX_STREAMS_PER_USER",
];
```

**This is the third defence** from [05](05-lint-and-format.md) and the only one that inspects reality. ESLint catches direct imports; `ServerOnly.assert()` catches execution; this catches the case where a transitive re-export drags Drizzle into a component chunk. Grep the client assets only — the SSR bundle contains all of these legitimately.

> [!CAUTION]
> **`ENV_FINGERPRINTS` was added after this assertion passed a build that shipped the entire server
> configuration schema to the browser.** `apps/web/src/env.ts` imports **no** server-only package —
> just `zod` — so every fingerprint above was legitimately absent while `DATABASE_URL`,
> `AUTH_SECRET` and `S3_SECRET_KEY` sat in the entry chunk, followed by a `Schema.parse({})` that
> threw before the app could hydrate ([24](24-web-app.md) Step 24.2).
>
> **A file can be server-only without importing anything server-only.** Fingerprinting the
> *dependencies* only catches a leak that drags a dependency with it; the names of the fields are
> what identify the file itself.
>
> The real fix is upstream — `env.ts` carries `import "@tanstack/react-start/server-only"`, so Start's
> import-protection plugin now **fails the build** and names the file and line. This grep is the
> backstop for anything that gets around the marker, which is why it belongs here anyway.

> [!IMPORTANT]
> **Two greps, not one, because "absent" means different things.** A server fingerprint must not
> appear anywhere in the client output. A **locale** fingerprint is different: a Bengali string
> inside a lazily-loaded chunk is the split working exactly as designed
> ([20](20-content-package.md)) — it is only a failure in the **entry** chunk, because that is
> what "not a static import" means in practice. Assert against the entry chunk specifically, and
> have the script fail if it cannot identify one, for the same reason the note below says to
> fail on zero asset files.
>
> `email.*` goes back in the strict list. No client chunk, eager or lazy, has any business
> carrying the worker's copy — the ESLint ban in [05](05-lint-and-format.md) Step 5.3 should
> have stopped it, and this is what catches a transitive path around the ban.

Shipping database driver code to the browser is not just a 400KB regression. It means your connection string's *shape* and your full schema are readable in devtools.

> **Point the grep at the client output directory for your Vite version.** The path differs between Start versions; confirm it once and assert on the correct directory — a grep over an empty folder passes silently and gives you false confidence forever. Have the script fail if it finds zero asset files.

### 9 — Every domain table declares `organization_id`

```js
// fail on any pgTable(...) in packages/infrastructure/src/pg/schema/** whose body has no organization_id,
// unless its table name is on the exemption list
const TENANT_EXEMPT = new Set([
  "organizations",                                   // it is the tenant
  // Better Auth's, and global by nature: one person has one login and may belong
  // to several organizations, so the tenant lives on `memberships`. These are the
  // `modelName` values doc 16 chose — Better Auth's own defaults are singular.
  "users", "accounts", "verifications", "two_factors",
  // Which tenant the session is pointed at, rather than which owns the row — the same
  // distinction that keeps `users` off this list despite `last_active_organization_id`.
  "sessions",
  "platform_policy",                                 // global: a deployment-wide switch has no tenant
  "shard_assignments",                               // the directory: read before any shard is known
  "__drizzle_migrations",
]);
```

`organization_id` is the sharding key and the tenant boundary ([13](13-infrastructure-postgres.md)). A table that ships without it is not a style problem — it is a table that has to be migrated under load later, and a query that cannot be scoped to a tenant in the meantime.

**The exemption list is the point of the check, not a weakness in it.** Every entry is a decision someone had to write down: Better Auth's tables are exempt because a login is global, and `organizations` is exempt because it *is* the tenant. Adding another entry means arguing for it in review, which is exactly the conversation that should happen before a global table exists.

> [!WARNING]
> **Names on this list are the `modelName` values, not Better Auth's defaults.** [16](16-auth-package.md) renames all five to this repository's plural convention, and a list still reading `user`/`session`/`account` exempts *nothing* — the assertion silently passes on tables it was never checking. Verify the list the way every assertion here is verified: add a table with no `organization_id`, watch it fail, remove it.
>
> `sessions` is on the list and `users` is not, and the two look alike. A session carries `active_organization_id` — which tenant it is *pointed at* — and a user carries `last_active_organization_id`. Neither is the tenant that owns the row, and neither table has one; the difference is only that §9 stopped matching the column as a substring, which is what surfaced `sessions` as never having been checked.
>
> **`partition_archive` is not on it.** It leads with `organization_id`, which the cold-storage index does because one tenant's months have to be readable, sweepable and countable without touching another's ([cold storage](../../packages/infrastructure/docs/reference/cold-storage.md)). `activity_archive` was the other, and the big kit dropped it (`upstream:packages/infrastructure/migrations/0034_activity_archive_drop.sql`).

Note this cannot be a type-level rule. Drizzle table definitions are data, `pgTable` returns the same type whichever columns you pass, and there is no compile error available — which is precisely the category of rule this file exists for.

**It shares its parser with 17 and 18, and that fixed two silent holes.** The original regex closed on `\n});` at column zero, so a table Biome wrapped differently was skipped without a word; and it tested for `organization_id` as a *substring*, which is how `sessions` passed for its whole life on the strength of `active_organization_id`. That column is which tenant a session points at, not which owns the row — the same distinction that keeps `users` off the list despite `last_active_organization_id` — so `sessions` is now exempt by name, with the reason, rather than by accident.

> [!NOTE]
> **It refuses to run against a stale bundle.** This is a grep over an artefact, so it is worth
> exactly as much as the artefact is current — and a green run against an `.output` built before the
> edit under review is how the client boundary was last reported clean while it was not. If anything
> under `apps/web/src` is newer than the newest asset, the assertion fails and says to rebuild
> rather than reporting on a build nobody made.
>
> It compares against `apps/web/src` only. A change in a package that reaches the bundle is not
> caught, on the grounds that such a change needs `build:packages` before the web build can see it
> anyway — the case this exists for is editing a route and re-running the checks.

### 10 — The audit port is `ActivityLogger`

```js
// fail on the identifier AuditTrail anywhere in packages/** or apps/**
```

Cheap, and it exists because the name drifted once already: the observability docs said the wrong one while eleven other files said `ActivityLogger`, and nothing caught it because both are prose in Markdown until the class exists.

**It walks `docs/` as well as `packages/` and `apps/`**, which it did not originally — so for its whole life it could not see the category of drift it was written for. Two pages are exempt by name: this one and `docs/opinions/index.md`, which state the ban and therefore have to spell the banned name. Anywhere else, it is the drift.

Two names for the audit port is worse than an ugly name. The whole point of [Data and scale](../opinions/data-and-scale.md) §1 is that a business fact and a diagnostic go to different places for different reasons, and a reader who sees two names reasonably assumes there are two things.

### 11 — The schema barrel names every `*.schema.ts`

```js
// fail if packages/infrastructure/src/pg/schema/index.ts omits any sibling *.schema.ts
```

**An incomplete barrel passes typecheck, lint, build, and every test.** `import * as schema` from a module that re-exports nothing is legal and yields `{}`. The only tool that notices is drizzle-kit, and it notices by generating `DROP TABLE` for every table it can no longer see. That happened once; this is the guard.

It is the one assertion whose failure mode is a destructive migration rather than a broken build, which is why it greps the barrel rather than trusting the [`noReExportAll` exemption](../opinions/imports.md) that makes the star export legal there in the first place.

### 12 — The rule files route to every opinions page

```js
// fail if a docs/opinions/*.md page is cited by no file in docs/ai/rules/,
// if a rule file is routed to from none of AGENTS.md, docs/ai/index.md or
//   docs/ai/rules/index.md,
// if CLAUDE.md does not @-import a rule file,
// or if any of them routes to a path that does not exist
```

[`docs/ai/rules/`](../ai/rules/index.md) is a digest of [`docs/opinions/`](../opinions/index.md) — the rules an agent must know *unprompted*, one file per topic, none over ~900 tokens. `AGENTS.md` at the repository root is the brief every non-Claude tool loads unprompted, and it routes into [`docs/ai/index.md`](../ai/index.md), which is the task table: one row per thing you might be about to do.

A digest is a second copy of every rule it states, and the failure is not that it is wrong the day it is written. It is that a tenth opinions page lands months later, no rule file mentions it, and every agent works from a rulebook missing a chapter while nothing says so. Citing the path is the cheapest thing that cannot be forgotten silently.

**Three links, all checked.** A page nothing cites is the missing chapter. A rule file nothing routes to is the same failure from the other end — it exists, it is correct, and no agent will ever open it. And a route to a renamed page sends a reader nowhere.

**Plus a fourth, which is the one the routers cannot see.** `CLAUDE.md` `@`-imports every rule file, and that is what makes the rulebook load at the start of a session rather than when an agent thinks to go looking. A rule that is routed to correctly and never imported is the same silent gap one layer up, so the assertion checks the import list too — and checks that each `@` target exists, because Claude Code inlines nothing and says nothing when one does not. The clause is skipped when `CLAUDE.md` is absent: it is Claude Code's file, and deleting it is a supported choice that leaves the routers as the only path in.

> [!WARNING]
> **Match Markdown link targets, not just backticked paths.** The first version of this assertion greped only for `` `docs/…md` `` and a deleted rule file passed clean: `AGENTS.md` links its rule files as Markdown targets rather than backticked paths, which that pattern never saw, and a second file citing the same opinions page hid the gap. Verified against six break shapes — an uncited page, an orphaned file, a renamed target, a deleted rule file, a root file that stops pointing, and a broken relative link inside a rule file.

**This is [Simplicity](../opinions/simplicity.md) applied to documentation.** The split is a real cost — twelve files to keep in step instead of one — and it is paid so that nothing loads what a task does not need. What is *not* negotiable is that the copy stays in step, and "stays in step" is a promise no reviewer reliably keeps.

It does **not** check that a rule file's summary of its page is still *accurate*. That is why every file in `rules/` ends with the line saying `docs/opinions/` wins any disagreement.

### 13 — Every folder under `docs/` has an `index.md`

```js
// fail if a folder under docs/ holds Markdown pages and no index.md
```

The same rule as `index.ts` one level down, for the same reason. A folder with no index can only be navigated by listing it, and a reader who lands in one has to guess which file is the entry point. The index is also what lets a page move within a folder without every link *to* the folder breaking — the identical argument [Folders](../opinions/folders.md) makes about barrels.

**The `reference/` folders are exempt, and the exemption is a decision rather than an oversight.** `packages/<name>/docs/reference/` and `docs/infra/reference/` are reached from their parent `index.md`, which names every page in them, with `meta.json` carrying the order. An index inside would restate the parent and rot the first time a page landed in one and not the other. The exemption is **by folder name**, not by location — `docs/infra/reference/` sits inside `docs/` and earns it for the identical reason. A folder holding no Markdown is skipped too; there is nothing for an index to name.

Cheap, and it caught three gaps the moment it was written: `docs/` itself, `docs/ai/skills/`, and `docs/setup/`, which had thirty-one numbered documents and no contents page.

### 14 — No comment block over two lines

```js
// fail on three or more consecutive lines whose trimmed form starts with //
```

The other half of [Opinions · Comments](../opinions/comments.md), and the half nothing checked. The two-line ceiling was a convention for as long as it was unenforced, and the tree answered accordingly: 524 blocks over it across seventeen packages, one of them twenty-four blocks in a single file.

**A run ends rather than extends at anything carrying no prose** — a `// ──` separator, and a `// biome-ignore`, `// eslint-disable` or `// @ts-` pragma. That is what lets an `import.ts` keep a one-line header above each of its separators without the whole file reading as one enormous block, and it is why the exemption is a property of the *line* rather than a per-file opt-out. There is no way to silence this assertion from inside a file, which is the point.

Scope is the same as §5: `{src,tests}` under `packages/*` and `apps/*`, generated files skipped.

> [!NOTE]
> **`pnpm check:comments` is the companion report, and it never fails.** `tooling/scripts/comment-density.mjs` prints per-package comment percentage, block count and the twenty-five files carrying the most comment lines. A package drifting toward the ceiling is visible there long before any single file trips §14 — and after the phase-1 sweep the tree sits at 13 % overall with zero blocks.

### 15 — Every path the docs name exists

```js
// fail if a backticked repo-relative path, or a Markdown link target, in docs/**,
// README.md, AGENTS.md or a package's docs/** names nothing on disk — and, in a `//`
// comment under packages/*/src or apps/*/src, a docs/reference/<page>.md the package
// does not have
```

The cheapest kind of documentation rot and the one a reader trusts most: a path in backticks reads
as a fact about the tree. [15](15-infrastructure-package.md) sent people to `src/cache/` and `src/queue/` for months —
folders this repository has never had, because `infrastructure` is organised by vendor
([Layering](../ai/rules/layering.md)). Twenty-one paths were wrong when this was first run, and six
of them had been correct until a refactor moved the file and left the sentence behind.

**Three things keep it from crying wolf**, because a check with false positives teaches people to
add exemptions rather than fix paths:

- **Fenced blocks are skipped.** An ASCII tree is full of names that are not paths, and a snippet's
  imports resolve against the file it would live in, not against the repository root.
- **A page may say a path is not real, and the check believes it.** `illustrative`, `not written
  yet`, `does not exist`, `removed`, `deleted` or `☐` on the line — or on the heading above a list,
  which is what `## What this removed` in [05](05-lint-and-format.md) is. A collapsed `<details>`
  block is skipped whole: it is the one place a page deliberately shows a tree that is gone.
- **A `docs/reference/<page>.md` span resolves against the package that wrote it.** The opinions pages say "the
  package's `docs/reference/`" generically, so the span passes if any package has one.

`apps/desktop` and `apps/api` are exempt by name. Both appear only in sentences about what *would*
move there, and doc [30](30-desktop-app.md) is a plan for one of them.

**It resolves Markdown link targets as well, and that is the half a reader actually clicks.** A
backticked path is prose about the tree; a `](…)` is a door. Nothing in CI could see one until
2026-09-21, and resolving all 1 503 of them found nine broken — eight pages under
`apps/*/docs/reference/` one `../` short of `packages/`, which from there is four levels up and not
three, and one naming `15-infrastructure-clickhouse.md`, renamed to
[15](15-infrastructure-package.md) by `T-013`.

**A target resolves against the page's own directory and nowhere else**, because that is what a
renderer does. §12 also treats a `docs/…` target
as root-anchored, which is right for the root files it was written for and wrong one directory
down — the fixture tree had a link of exactly that shape, passing §12 and broken in a browser, and
this half is what found it. A URL, a `mailto:`, an anchor-only `#jump` and a braced or globbed
shape are all left alone.

**It reads source comments too, and that is the half nothing else covers.**
[Comments](../ai/rules/comments.md) tells an author to say the constraint in the code and leave
`// see docs/reference/x.md`, letting the page carry the why — so a page that was never written
passes every check that walks `docs/` alone. Five did when this half was first run: one named a page
whose real name was singular, two named a page that lives in another package, and two named pages
nobody has written.

**A source comment resolves against its own package, unlike a doc span.** A doc page writing
`docs/reference/` is usually speaking generically; a source comment is a pointer a reader follows
from that file, and one that means another package's page has to name the path. So the check offers
that as the fix — and then resolves the path it offered, or "name the path" would be an unchecked
escape from the rule.

### 16 — Both pnpm version declarations agree

```js
// fail unless package.json has `packageManager` and `devEngines.packageManager`
// and the two name the same version
```

The assertion written after the discovery that **CI had never passed on any branch**. `pnpm/action-setup` reads the root `packageManager` field and nothing else; pnpm 11 reads `devEngines.packageManager`. This repository declared only the second, so both jobs died in about twenty seconds with `No pnpm version is specified`, every step after the setup was reported as `skipped`, and a run that ran nothing looked, at a glance, like a run that found nothing.

Two declarations that must agree is exactly the shape a grep is for. Verified by deleting each in turn and watching the check name the missing one.

### 17 — Every unique index on a tenant table leads with `organization_id`

```js
// fail if a pgTable declaring an organization_id column carries a uniqueIndex
// whose first column is something else
```

Stated as non-negotiable in [Rules · Vocabulary](../ai/rules/vocabulary.md) and checked by nothing until now. `roles_key_uq` on `(key)` alone means two tenants cannot both have an `owner` role — and the failure does not arrive as a design review, it arrives as a duplicate-key error during someone else's signup, months later, in production.

**The tenant column is matched as a whole quoted name, never a substring.** `users` carries `last_active_organization_id`; a `String.includes` test makes a table that holds no tenant look like one, and the assertion then demands an index that would be meaningless.

**Two names are exempt, and the exemption is the point rather than a concession.** `invitations_token_uq` and `api_keys_hash_uq` are the two lookups that arrive holding no tenant: the request presents a token, or a hash, and the tenant is precisely what the index is being used to find. Any other exemption is a query that has not been scoped yet.

### 18 — Every foreign key column has an index leading with it

```js
// fail if a column declaring .references() is not the first column of some index
```

Postgres indexes a primary key and a unique constraint. It does **not** index a foreign key, and nothing in Drizzle's schema types says so. An `ON DELETE CASCADE` with no index behind it scans the whole child table on every parent delete — which is fine at seed scale and is a lock held over a table scan at any other.

**Leading, not merely present.** This is the distinction that gives the assertion its teeth: four tables here already had the column inside a composite index and were still unindexed for the cascade. `goal_members_user_idx` on `(organization_id, user_id)` answers "this tenant's members" and cannot answer "every row naming this user", because deleting a user is not a tenant-scoped operation. The fix is a second index, not a reordering of the first — the tenant-leading index is on the capability-resolution path, and reordering it to serve the cascade would trade a hot read for a rare write.

Those four arrive as `<table>_<subject>_fk_idx`, a suffix that says the index exists for the foreign key rather than for a query, so nobody later reads it as a duplicate of the composite beside it and deletes it.

**Both 17 and 18 read the Drizzle schema, not `migrations/*.sql`.** The schema is the file a person edits and the file `db:generate` diffs against, so an index that is missing there is missing from the next migration too. The gap this leaves is a hand-edited migration — the partitioned tables in [13](13-infrastructure-postgres.md) are the precedent — and it is a gap Drizzle already has: DDL the schema does not declare is DDL the next `db:generate` proposes to drop.

---

---

### 19 — Every package with tests typechecks them

```bash
# every packages/*, apps/* and tooling/* with a tests/ dir: does the tsconfig its
# `typecheck` script names include a tests/ pattern?
```

**Why.** A `tsconfig.json` that includes `src/**` only leaves the tests to vitest, whose transform
erases types and checks none of them. A test double that falls behind its port then compiles, and
keeps passing for as long as nobody calls the method it never implemented.

That is not hypothetical. Turning this on across the repository surfaced **ninety-seven** errors in
seven packages, all of them test code that had drifted: stubs missing four methods of the port they
claimed to implement, a `SessionOrganization` fake without the `roleName` every real one carries, a
type-only import of `ApiKeyRecord` from a module that has never exported it, and ids held as
`string` where the column is branded.

The assertion reads the config the package's own `typecheck` script names — `-p <file>` if it gives
one, `tsconfig.json` otherwise. `apps/worker` is why: it builds with `tsc` and a `rootDir` of
`src`, so its tests cannot live in the build config and sit in `tsconfig.test.json` instead.

---

### 20 — Every migration is safe on a table that already holds rows

```bash
# packages/infrastructure/migrations/*.sql: a CREATE UNIQUE INDEX on a table the same file
# does not create, with no DELETE FROM that table before it — and an ADD COLUMN that is
# NOT NULL with no DEFAULT.
```

**Why.** `pnpm db:generate` emits both unsafe forms by default, and both are correct on an empty
table. On a populated one the unique index aborts over the first duplicate and the `NOT NULL`
column aborts over the first existing row, halfway through a deploy, leaving the schema in neither
state. The big kit's `upstream:packages/infrastructure/migrations/0005_giant_famine.sql` is the
shape that works and is worth reading before writing a new one: drop, de-dup with a named winner,
create.

**No migration is exempt.** The big kit exempted three old files by name, each safe only on an
empty database. Lite replaced that history with one baseline,
`packages/infrastructure/migrations/0000_lite_baseline.sql`, which creates every table it indexes —
so `REPLAY_EXEMPT` is empty, and every file is held to the rule.

### 21 — Every partitioned table is on the allowlist, with the same keys

```bash
# packages/infrastructure/migrations/*.sql: a CREATE TABLE ... PARTITION BY LIST|RANGE whose table
# is absent from PartitionedTable.ALL, or whose level or key disagrees with it, or whose PRIMARY
# KEY omits either partition key — plus any DEFAULT partition. Then the inverse: an allowlist
# entry that no migration partitions.
```

**Why.** `PartitionedTable.ALL` is what `TenantPartitionSeed` walks, what the monthly schedule
loops, and what `MaintenanceGateway`'s closed union derives from. The two halves fail in opposite
directions and neither is loud. A table partitioned in a migration but missing from the list gets no
partition when a tenant is founded, so the notice arrives as an insert failing on that tenant's first
write. An entry on the list that no migration partitions is the reverse: the seed issues
`ALTER TABLE … ATTACH PARTITION` against an ordinary table and Postgres refuses every one.

**A migration declares only the outermost level.** A tenant-partitioned table shows
`PARTITION BY LIST ("organization_id")` and nothing else, because the month level under it is
declared per tenant by the seed at runtime — so the assertion checks the level it can see and the
primary key, which has to carry both.

**The primary-key half only ever fires on a migration nobody applied**, because Postgres itself
rejects a partitioned table whose key omits a partition key. It is worth checking anyway because
this is the one kind of DDL the repository writes by hand: the failure it catches is a file in
review, not a database in production.

### 22 — Every repository reads tables of one placement

A repository whose tables span the catalog and a routed shard is one that cannot be split: on one
node it works, and on two it reads half its rows from the wrong database. `BaseRepository` catches
the transaction-level case at runtime; this catches the file-level case before anything runs.

The placements come from `TablePlacement` in `application/src/primitive/shard.ts` — the same
constant §9 derives its exemption set from, so a table cannot be catalog for one assertion and
something else for another. `local` mixes with either, which is what `local` means.

`CROSS_PLACEMENT_KNOWN` holds the audited exceptions, and it holds exactly one:
`pg-notification-recipient.reader.ts` resolves an audience out of RBAC on the catalog and reads
`notification_preferences`, which is routed. `24.1` empties the set.

### 23 — Only `DatabaseCluster` opens a pool inside `src/`

`DatabaseCluster` is what `close()` walks and what the health report counts. A second
`new Database(` in `src/` is a pool nothing closes, nothing counts and no shard map knows about.

Comments are stripped before the search, because `database.ts` documents the call it defines and
a grep that counted prose would make the assertion unfixable. Scripts above `src/` open their own
pools on purpose: they are one-shot and they exit.

**This assertion and `partition-ddl.ts` are the two directions of one check.** The generator writes
the clause from the allowlist onto a freshly generated migration; this reads the migrations back and
asserts the allowlist against them. The generator cannot cover a hand-written migration — the big kit's
`upstream:packages/infrastructure/migrations/0023_tenant_partitions.sql` is one, and has to be —
so the assertion is what closes the gap the generator leaves.

**No `DEFAULT` partition, on purpose.** A catch-all absorbs the rows of a month whose partition is
missing, which turns a loud insert failure into a silent one, and attaching the real partition
afterwards means moving those rows back out of it.

---

### 24 — Every event code in the catalog is emitted

A code declared in `EVENT_CATALOG` that nothing emits is a dashboard panel which stays empty
forever — and an empty panel reads exactly like a healthy system. That is the failure this closes:
not a build that breaks, but an operator who watches the wrong thing and concludes nothing is
wrong.

**It has happened.** Eight of twenty-four declared codes had no production call site at the point
`5.14` went looking, and every one of them had been added in good faith beside a mechanism that
was later renamed, moved or never finished.

The assertion resolves the fragments `EVENT_CATALOG` spreads through the barrel's own import
lines, so a `...billingEvents` added tomorrow is covered without editing the script. It then
collects every `.emit("<code>"` under a first-party `src/` — **`src/` only**, because a spec
emitting a code to assert its wire shape is not the thing that ships it.

The other direction needs no assertion: `Logger.emit` is typed on `EventCode`, so a code emitted
without being declared does not compile.

**The counterpart, not built.** The same shape would serve `permissions` — every key in `CATALOG`
named by at least one `PROCEDURE_PERMISSIONS` entry, which is Phase 5's own exit criterion.

---

### 25 — `.env.example` documents every key an app requires

`.env` is gitignored, so nothing can check it. What **can** be checked is the file somebody copies
it from, and the failure this closes is the slow one: a key added to a schema, never documented,
and therefore absent from every `.env` that was copied before it. Nothing fails at that point —
the schema has a default, or the process is not started — and the day it is missed is the day
something starts and parses its environment.

**It found one on its first run.** `WORKER_NOTIFICATION_CONCURRENCY` shipped with the digest
consumer and was never added to `.env.example`. It has a default, so nothing broke; it is also a
knob nobody knew they had.

Both directions, in one assertion:

- **Schema → example.** Every key an `apps/*/src/env.ts` names appears in `.env.example`.
- **Example → schema.** Every key in `.env.example` is read by one of those schemas, because a
  documented key nothing reads sends somebody to set a variable that does nothing.

A commented line counts as documentation: that is how the example carries an optional key, as
`# EMBEDDING_API_KEY=` and `# DATABASE_REPLICA_URL=` do.

**Two exemptions, each named in the script with why.** `APP` is deliberately absent — each process
defaults it to its own name, and pinning it in a shared file makes every worker line claim to have
come from the web app, which is the label an operator filters on. And `DATABASE_SHARD_<n>_*` is a
numbered family read by `shard-env.ts` rather than by a schema, so no literal key for it can appear
in one.

**What this still cannot see** is the gap that actually costs an afternoon: a developer's own `.env`
falling behind the example. Nothing in the repository can read that file. The thing that catches it
is §26.4d's boot smoke — start the process and the schema says which key is missing, by name.

---

### 26 — Every script above `src/` is typechecked

A runnable script at a package root is code nothing imports, so nothing but `tsc` can notice when a
signature under it moves. If it is outside its own package's `tsconfig.json` `include`, not even
that does.

**It found the bug it was written for.** `packages/infrastructure/platform-grant.ts` was not in the
include, and it called `TransactionScope.within(tx, work)` — two arguments, when the method had
taken three since the placement landed in Phase 22. `pnpm platform:grant <email>` crashed with
`Function.prototype.apply was called on undefined`, which is a `TypeError` inside `AsyncLocalStorage`
and says nothing about the call site. It is the documented way to make the **first platform admin**,
and there is no other, so the failure waits until the one moment somebody needs it. Adding the file
to the include and running `tsc` also turned up a `TS7022` in `partitions.ts`, in a loop nobody had
compiled.

The assertion is a string match on the config rather than a resolution of its globs. That is
deliberate: a `"src/**/*.ts"` glob cannot reach a root file, so a root file is either named or it is
not checked, and naming it is what the assertion asks for.

**One exemption, and it is a category rather than a list:** `*.config.ts`. A tool config is consumed
by its own tool, which supplies types the package's `tsconfig` does not name — including it would
fail on the tool's own globals rather than on anything a reader wrote. `*.d.ts` is skipped for the
matching reason: it is types rather than code.

---

### 27 — Every host port is stated once

A published port is named twice by construction. `POSTGRES_PORT` is what Compose publishes and
`DATABASE_DIRECT_URL` is what dials it, and until this assertion nothing held the two together.

**It is written from a real afternoon.** Five of this stack's well-known ports were held by two
unrelated projects on one machine, so nothing would start. Worse, the two halves of the fix lived in
different files that did not know about each other: Compose read `infra/.env`, because with
`-f infra/docker-compose.yml` the project directory is `infra/` rather than the repository root,
while the applications read the root `.env`. A third file, `packages/infrastructure/.env`, layered
under five scripts through `dotenv`'s cwd lookup and pointed `DATABASE_URL` at a different port
again. Each was invisible from the others, and the symptom was a connection refused — or, once,
another project's database answering.

The assertion checks three things, all against `.env.example`, which is the committed template:

1. **Each `*_PORT` and the URL beside it agree.** `POSTGRES_PORT` with both `DATABASE_URL` and
   `DATABASE_DIRECT_URL` — lite has no pooler, so both dial Postgres — `REDIS_PORT` with all three
   Redis URLs, and so on down the list. `WEB_PORT` is checked against
   all three of `APP_BASE_URL`, `AUTH_URL` and `AUTH_TRUSTED_ORIGINS`, because a sign-in that
   fails because they disagree reports an origin error naming none of them.
2. **Each Compose default equals the template's value.** A checkout with no `.env` falls back to
   the default, and CI is exactly that checkout — so a default that has drifted is a second answer
   to the same question, and it is the answer CI gets.
3. **No `.env` exists outside the repository root.** This is what stops the other two files
   coming back.

> [!NOTE]
> **It parses the example with `split(/
?
/)`, and that is not cosmetic.** `.env.example` is CRLF
> on a Windows checkout, JavaScript's `.` matches no carriage return, and a `$`-anchored value
> therefore captures nothing at all. The first draft of this assertion passed on every tree because
> of it — including the trees it was supposed to fail. A fixture pins the CRLF case for that reason.

`.env.example` is also where these keys are documented, which §25 would otherwise reject: nothing in
either `env.ts` reads `POSTGRES_PORT`, because Compose and `apps/web/vite.config.ts` do. §25 skips
anything matching `/_PORT$/` for that reason, beside the shard-family skip it already had.

### 28 — Every permission in the catalog gates a procedure

```js
// fail if a key in packages/permissions/src/catalog is not a value of any
// PROCEDURE_PERMISSIONS entry — excluding the `core` module, which every resolved
// principal holds without a role, and an allowlist naming the item that removes each
```

§24 from the other vocabulary, and Phase 5's own exit criterion, checked for the first time. A key
nothing asserts is a checkbox in the role editor that grants nothing: an administrator ticks it, a
member is told they have the right, and every call still fails with the same `FORBIDDEN` as before.

**The module is read off the entry, never off the key's first segment.** `core.realtime.subscribe`
*is* gated — `realtime.stream` asserts it — and `core.activity.write` is not, because
`CapabilitySet.can()` grants every `core` key to every resolved principal rather than through a
role. Splitting on the name would have exempted both and caught neither.

**The allowlist lives here rather than in a spec, because the property does.** It used to be the
last case in `packages/contracts/tests/registry/procedure-permissions.spec.ts` with its own
`AWAITING_A_PROCEDURE` set; two lists for one property is how the spec's went stale for two phases
while four keys sat gated behind it. The spec keeps the two directions it uniquely covers — every
procedure is gated, and no entry names a procedure that is gone — which need the real router.

Both catalogs are resolved through their barrel's spreads, the same way §24 resolves the event
catalog, so a `...billingPermissions` added tomorrow is covered without anyone editing this.

### 29 — The four shard readers run one algorithm

```js
// fail if `shardsFromEnv` in apps/web/src/env.ts, apps/worker/src/env.ts,
// apps/realtime/src/env.ts and packages/infrastructure/shard-env.ts do not have the
// same body, comments and signature aside
```

`DATABASE_SHARD_<n>_URL` is parsed in four places and cannot be parsed in one — the stream
process, `apps/realtime`, is the fourth. Each deployable
declares the environment it needs, which is why step 25.2 forbids extracting a shared schema; and
the scripts above `packages/infrastructure/src` cannot import an app at all. A fourth package
holding the parser would have to sit left of the server-only boundary to be reachable from
`apps/web/src/env.ts`, which is a package invented for twenty lines.

**So the copies stay and the rule does not.** They had already drifted: the two apps collected every
`DATABASE_SHARD_<n>_URL`, sorted them and checked the indexes were contiguous, while the scripts
walked upward from 1 and then scanned separately for an orphan. Two mechanisms, one property, and
they disagreed — a name set to an empty value, which is what a commented-out line in `.env` leaves
behind, was one node to the apps and to the scripts an error reading *"DATABASE_SHARD_1_URL has no
shard 1 before it"*, an index named as its own missing predecessor.

**The comparison is of the body, not the file.** `withoutComments` runs first, so each copy explains
itself where it sits; the signature is dropped, because the infrastructure copy names its return
type where the two apps inline it. What is left is the algorithm, and four copies of one algorithm
is a duplication somebody can read. Two algorithms is a bug nobody can see.

### 30 — removed in lite

The big kit's §30 checked that every inline widget is placed by a literal key. Lite has no widgets,
so the assertion went with them. §31 keeps its number, and with §32 the harness counts thirty-one. The rule comes
back with the widgets: [Widgets and zones](../scale/widgets.md).

### 31 — Every flag is live

```js
// fail if a flag in packages/permissions/src/flag is past its `expiresOn` (UTC), or if its
// key, quoted, appears in no src/ file outside that folder
```

A flag is a rollout, and a rollout ends: the code keeps one branch and the flag is deleted. One
past its date has become a permanent fork that nobody is reviewing, and one no code reads switches
nothing at all. Both compile, lint and pass every test, which is why this is a grep.

**Zero flags passes; it does not skip.** No rollout in flight is the state the rule exists to reach,
and reporting it as unverified would make the goal look like a gap.

Lite ships with zero flags — `FLAGS` is empty — so today this assertion passes on an empty set. In
the big kit it landed with the first flag's first reader, `widget.dismissal`, which went with the
widgets.

### 32 — No colour outside the twelve

```js
// fail on an arbitrary colour value (`text-[#fff]`, `bg-[rgb(`), a palette utility
// (`bg-red-500`, `text-white`) or a literal `style` colour in packages/{ui,feature}/src and
// apps/web/src, and on any colour literal in a stylesheet there outside style/color/
```

Tailwind's palette is reset to the twelve, so `bg-red-500` generates no CSS and would at worst do
nothing. An arbitrary value is different: `text-[#fff]` compiles to a real colour that no theme
knows and that `check:contrast` never sees. It reviews clean and is wrong in five of six themes.
A `color-mix` of two of the twelve passes, because that is how a state is derived.
`style/token.css` keeps its one exception for shadows, `oklch(0 0 0 / <alpha>)`.

## Step 26.4b — `check:contrast`, the gate that is not a grep

```bash
pnpm check:contrast   # node tooling/scripts/check-contrast.mjs
OK 154 pairings meet WCAG AA and 132 colours are inside sRGB, all 12 names present in 11 blocks, across every theme and mode.
```

**The assertions above read source; this one computes.** It resolves the twelve colour names
([Opinions · Colour](../ai/rules/color.md)) for every theme in every mode, walks the pairings
`packages/ui/src/style/markdown/` actually produces, and fails on a contrast ratio under WCAG AA, a
name a theme forgot to declare, or an `oklch()` value outside the sRGB gamut.

**The gamut half is the one nobody expects.** `oklch()` describes colours a monitor cannot show, and
a value outside sRGB does not error — the browser clips it, silently, differently per engine. A
palette that looks right in one theme and muddy in another is usually this rather than a bad hue
choice.

With one theme this is judgement. With five, each in two modes, it is the only thing standing between
a contributor adding a palette and a theme nobody can read — which is why it runs in CI beside
`check:architecture` rather than living in a design review.

It cannot see a literal written where it does not look, which is why "every colour is `var(--name)`"
is also a rule and not only a check.

---

## Step 26.4c — The scripts are checked like source, because they are

Everything above is enforced by five files in `tooling/scripts/`, and for most of this repository's
life they were the only code in it that nothing checked and nothing tested. An assertion that
silently stops matching is worse than an absent one: the build goes green and reports a rule as
held.

Two things close that.

**`// @ts-check` on every script, run by `pnpm typecheck`.** `tooling/scripts` is a workspace
package, so `tsconfig.json` there — `allowJs`, `checkJs`, `noEmit` over `@loadbearing/tsconfig` —
is picked up by the root `pnpm -r run typecheck` with nothing else to wire. It found twenty-eight
places where a value that can be `undefined` was used as though it could not: `process.argv[2]`
with no argument, `.find()` on a column list, `match[1]` from a regex, `packages[0]` when there are
no packages. None had bitten yet. Each one crashes the script with a `TypeError` rather than
reporting anything, which is the failure mode these checks exist to prevent.

**`noImplicitAny` is off, and that is a decision.** Turning it on wants a JSDoc type annotation on
about seventy parameters, and JSDoc is a block comment — banned everywhere in this repository by
`docs/opinions/comments.md`, and by assertion 5 in every directory it walks. The half worth having
is `strictNullChecks` and `noUncheckedIndexedAccess`, which need no annotations to work; the half
given up is parameter types on functions whose callers are all in the same file. Writing the
scripts in TypeScript instead would buy the other half, at the cost of a build step between
`package.json` and every `node tooling/scripts/*.mjs` line — the wrong trade for five files.

**Specs, in `tooling/scripts/tests/`, run by `pnpm test`.** They come in two shapes.

`source-text.spec.mjs` covers the parsers the assertions are built out of, which is why they now
live in `source-text.mjs` rather than inside `check-architecture.mjs`. Every case in it is one an
earlier version got wrong or could: a `//` inside a string, an indented top-level `await`, a column
name that merely ends in `organization_id`, an index callback whose brackets nest. Writing them
found one more — `topLevelAwait` counted the word inside a quoted string, so `const s = "await me"`
in a bundled barrel would have failed the build for nothing.

`check-architecture.spec.mjs` runs the real script against fixture trees, one per assertion, each
tree violating exactly one thing. It needs no `ROOT` parameter threaded through thirty
assertions: the script derives `ROOT` from its own location, so a fixture is a temporary directory
with a copy of the script under `tooling/scripts/` and a few files around it. Twenty-eight of the
thirty are covered both ways — the tree that violates it fails, and the tree that does not
passes. Assertion 8 is the exception, because it greps a built `apps/web/.output` and building one
in a fixture is not a unit test.

## Step 26.4d — The boot smoke, and why `/` is the probe

```bash
node tooling/scripts/boot-smoke.mjs worker
node tooling/scripts/boot-smoke.mjs web
node tooling/scripts/boot-smoke.mjs realtime
```

Everything else in the pipeline runs against source. `env.ts` parses at module load, so a variable
the deployment forgot is invisible to `typecheck`, `lint`, `test` and every assertion in
`check:architecture` — and shows up the first time a process starts, which until this script was
in production.

The script spawns the built entrypoint, waits for the line that app prints when its socket is open,
then sends `SIGTERM` and reads what happened. `started` is that literal text rather than a shape
imposed here: the worker emits `"event":"process.started"` through its own logger, and nitro prints
`Listening on:`.

**`web` was opted out, for a bug that has since been fixed.** The comment said the server bundle
throws `jsxDEV is not a function`. That was `T-032`, fixed 2026-09-13 — and the comment also cited a
TODO file under a *tasks/* directory that has never existed (it is [`plans/archive/TODO.md`](https://github.com/prodicle/loadbearing_tanstack_start_kit/blob/3fafa78c2f42d2d718236d7666429b858199118a/plans/archive/TODO.md)),
and `T-034`, which is the dropped analytics-reader item. Three errors in four lines, which is what
a comment nobody can run decays into.

**The probe is `/`, and `/api/health` is the wrong one** — worth writing down, because the health
route is the obvious choice and it is obviously right for about a minute:

- It renders no JSX, so it would have answered 200 straight through `T-032` while every page
  a user could reach answered 500. A gate that passes on the bug it was built for is not a gate.
- It reports its dependencies. A 503 there means Postgres or Redis is not answering, which is a
  statement about the machine rather than the bundle. In the big kit this was measured: `/` 200
  with rendered HTML, `/api/health` 503 because ClickHouse was down, in the same process, in the
  same second. Lite has no ClickHouse, but the point stands for any dependency.

`/` is a server render — the router, the shell, the JSX runtime and a `Response` that completes.
Nothing under `.output/public/` is a prerendered `index.html`, so a 200 there cannot come from a
static file.

**The clean-exit assertion is the worker's alone.** A drain that ends on the signal rather than on
its own is a drain that did not finish, which is why the worker is sent `SIGTERM` rather than
killed, and why it must exit `0` having logged `process.stopped`. The web server has no queue to
drain, and on Windows `SIGTERM` is a terminate rather than a signal a process can catch, so
requiring a clean exit there would assert the platform rather than the app.

**The port is one the kernel just handed out**, not a constant: a developer with `pnpm dev` running
would otherwise get a failure that names a port rather than a bug.

**To run it locally**, give the child the environment CI gives it in the job block:

```bash
node --env-file=.env tooling/scripts/boot-smoke.mjs web
```

Without that, the built web server answers 500 on every request and prints a `ZodError` naming the
missing key — which is the script working, and is exactly how a `.env` that has fallen behind
`.env.example` announces itself.

---

## Step 26.5 — Optional but worth it

**One of these already ships**, in the workflow above: `pnpm audit --audit-level high` as a
separate, non-blocking `audit` job. Blocking a merge on a transitive advisory nobody can fix today
is how people learn to ignore a red build, and once they do the actionable advisories go with it.
Advisories are filtered by **GHSA** id in pnpm 11 (`auditConfig.ignoreGhsas`), not CVE.

The rest are not written, and each is a decision rather than an omission:

- **Branch protection** requiring `verify` to pass before merge — without it every assertion above
  is advisory. This is the one to do first, and it is configured in the repository, not in a file.
- **`actions/cache`** on package `dist/` dirs. The pnpm store half is done — `actions/setup-node`
  with `cache: pnpm`. The `dist/` half is deliberately not: `tsup` has no incremental mode, so a
  restored `dist/` is rebuilt by the very next step. It would only pay off by making the build
  conditional on a cache hit, and a stale `dist/` silently used is a worse failure than a slow job.
- **`pnpm peers`** to surface unmet peers, which pnpm 11 no longer prints as a tree during install.
- **`pnpm sbom --sbom-format cyclonedx`** if anything downstream wants a bill of materials.

Both of those are real commands in the pinned pnpm — checked, because a suggestion naming a command
that does not exist is worse than no suggestion.

## Step 26.3b — The `compose` job

The `docker compose up` smoke that used to be on the list above now ships, as its own job.

**It exists because `verify`'s `services:` block is not the stack anyone runs.** Those are pinned
images configured in the workflow file; `infra/docker-compose.yml` is what a developer boots and
what the setup pages describe. The two drift — an image tag, a healthcheck, an init script — and
nothing else in this workflow can see it.

It is also the only job that reaches **S3 and Mailpit at all.** A `services:` container
takes no command and mounts nothing from the checkout, so none of them has an equivalent in
`verify` — and `verify` needs none: its only S3-touching spec builds a `FakeStorage`, and the smoke
suite that does real round trips is excluded from `pnpm test`. `verify` ran a MinIO container until
the image was withdrawn from Docker Hub, which is when it became clear nothing in that job had ever
used it.

Three things it proves that `verify` cannot:

- **`infra/postgres.init.sql` does its job.** Compose mounts it as an initdb script. `verify` has to
  apply it by hand, in a step that exists only because a service container starts before checkout —
  so the file being correct *as an initdb script* is untested there.
- **The healthchecks are right.** `compose-wait.mjs` reads them, so one that never reports healthy
  fails the job rather than being noticed by a developer waiting at a terminal.
- **`pnpm smoke` runs against the real containers** — Redis, S3 and BullMQ — which no other job
  can reach.

**`docker compose up -d --wait` cannot express this stack**, which is why the wait is a script.
`minio-init` creates buckets and exits 0, and `--wait` has no way to be told that a service
finishing is the success case. `readiness()` in that script encodes the three ways a container can
be ready — healthy, running with no healthcheck, or already exited cleanly — and the two ways it can
be fatal.

---

## ✅ Gate

- A commit with a bad scope (`feat(nope): x`) is rejected.
- A commit with unformatted code is auto-formatted before it lands.
- `pnpm check:architecture` passes on a clean tree.
- Adding `import { sql } from "drizzle-orm"` to a file in `packages/application/src/` fails `check:architecture`.
- Adding `process.env.FOO` to a package file fails `check:architecture`.
- `pnpm check:contrast` passes, and adding a theme that omits one of the twelve names fails it.
- `pnpm test` covers `tooling/scripts` too, and changing an assertion's behaviour without
  changing its spec fails — verified by raising the comment ceiling to five and watching
  `check-architecture.spec.mjs` go red.
- The full CI job passes end to end on a fresh clone — which means checking that `verify` got past
  `pnpm/action-setup` at all, not only that no check reported a failure.

Do not proceed until this passes.

---

[← `apps/worker`](25-worker-app.md) · [Verification and first feature →](27-verification-and-first-feature.md)
