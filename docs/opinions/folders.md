---
title: Folders
description: src/ holds index.ts, import.ts, and folders. Role folders by default, subject folders where contents repeat per feature.
---

# Folders

## `src/` holds `index.ts`, `import.ts`, and folders. Nothing else

Two files at the root, and both are surfaces rather than code: `index.ts` is what the package
gives, `import.ts` is what it takes ([Imports and exports](imports.md)). Every other file lives in
a folder.

```
packages/errors/src/          packages/permissions/src/     packages/content/src/
├── index.ts                  ├── index.ts                  ├── index.ts
├── catalog/                  ├── capability/               ├── import.ts
├── error/                    ├── catalog/                  ├── message/
├── normalizer/               ├── gate/                     ├── primitive/
└── transport/                ├── registry/                 ├── source/
                              └── route/                    └── translator/
```

**Why the root is closed.** A loose file at `src/` root has no stated kind, so nothing tells you
where the next one goes — and "just this one helper" is how `utils.ts` gets born. Keeping the root
to two named surfaces means every question about placement has an answer that is already written
down.

The cost is real and worth paying: `errors/src/normalizer/` holds one file, and
`content/src/translator/translator.ts` stutters. **Accept both.** A folder that holds one thing
today needs no move when it holds three, and a rule with no judgement call in it is a rule nobody
has to litigate in review.

### An app's root is closed too, and the exceptions are the framework's

`apps/*/src` follows the same rule with one addition: **a file the framework resolves by name
stays at the root.** `main.ts` is the worker's entrypoint and `env.ts` is the one place
`process.env` is read — an assertion in `check-architecture` §3 names that path. In `apps/web` the
same applies to `router.tsx`, `endpoint.ts` and the generated `route-tree.gen.ts`.

Everything else is a folder, and the test is the same one: `worker-bootstrap.ts` and
`system-principal.ts` sat loose for as long as nobody asked what kind of thing they were. They are
`bootstrap/` — what the process assembles before it starts working — and the question of where the
next such file goes now has an answer.

## Every folder has an `index.ts`

That is what lets you move a file within a folder without touching a single import elsewhere. The
barrel names every symbol it publishes — never `export *` ([Imports and exports](imports.md)).

**One exemption: `packages/content/src/message/en/` and `bn/`.** Nothing merges those files; they
are reached only by string-literal `import()` from `message/catalog.ts`, and that is what splits
them into one chunk per locale × namespace. A barrel there would be dead weight that anyone could
accidentally import and collapse the split. See [20](../setup/20-content-package.md).

**A second exemption: directories that hold no modules.** In `packages/asset`, `icon/svg/`,
`image/file/` and `font/` hold `.svg`, `.webp` and `.woff2`; in `packages/ui`, `style/` and the
folders under it hold stylesheets only. None of them hold modules. There is nothing for a barrel to
name, and the surfaces that reach them are `ImageManifest` (which imports the files by path) and the
`exports` map (which publishes `./font.css`, `./sprite.svg` and `./style.css` directly). The rule is
about folders of code.

**`ui` splits code from appearance.** `component/` holds one folder per exported component.
`theme/` holds the TypeScript that chooses and scopes a theme: the registries and `ThemeScope`.
`style/` holds every stylesheet and nothing else, because a folder that mixes `.ts` and `.css`
answers two questions and gets both wrong. Inside `style/`, each file is a kind of thing appearance
is made of:

- **`token.css`** — the sizes. Type scale, spacing, radii, elevation, motion. Theme-invariant: a
  dark theme is not a different spacing system.
- **`color/`** — one file per theme, each declaring the same twelve names. The set is the contract.
- **`base.css` and `markdown/`** — rules for elements no component renders: the page, and the HTML
  the Markdown renderer writes into stored docs.

The line between them is what each may reference. `token.css` names no colour. A colour file names
no component. `base.css` and `markdown/` declare no value of their own — every number and every
colour in them is a `var()` reaching back into the other two. A rule that breaks that direction is
in the wrong file. Components style themselves with Tailwind utilities, so none of this is per
component.

## Every folder under `docs/` has an `index.md`

The same rule one level up, for the same reason. A folder with no index can only be navigated by
listing it, and a reader who lands in one has to guess which file is the entry point. The index is
also what lets a page move within a folder without every link *to* the folder breaking.

```
docs/index.md                 the four trees and what each is for
docs/ai/index.md              the task router
docs/ai/rules/index.md        the rulebook's contents
docs/ai/skills/index.md       the run books
docs/opinions/index.md        these pages
docs/setup/index.md           the build order, 00-30
```

**The `reference/` folders are deliberately exempt**, and it is worth saying why rather than leaving
it to look like an oversight. `packages/<name>/docs/reference/` and `docs/infra/reference/` are
reached from their parent `index.md`, which names every page in them, and `meta.json` carries the
ordering. An index inside would restate the parent and rot the first time a page was added to one
and not the other.

A folder holding no Markdown at all needs no index — there is nothing for it to name.

Enforced by `check-architecture.mjs` §13 ([26](../setup/26-hygiene-and-ci.md)).

## A folder is named after its role, and the vocabulary is shared

**The default is a role folder: the folder name says what kind of thing is inside.** The same kind
gets the same name in every package, so `catalog/` means the same thing in `errors` and in
`permissions`, and knowing one package teaches you the next.

| Folder | Holds | Used by |
|---|---|---|
| `primitive/` | standalone value types and small classes with no layer role | `core`, `content`, `contracts` |
| `catalog/` | team-owned fragments plus a platform-owned `index.ts` that merges them | `errors`, `permissions`, `contracts` |
| `registry/` | singleton lookup classes over a catalog | `permissions`, `contracts` |
| `capability/` | the resolution algorithm over a registry | `permissions` |
| `error/` | `AppError` subclasses, one per code that carries context | `errors` |
| `normalizer/` | boundary converters — unknown in, known shape out | `errors` |
| `transport/` | protocol mappings; the only place a wire format is named | `errors` |
| `source/` | an abstract seam plus its implementations | `content` |
| `translator/` | interpolation and fallback over a message bundle | `content` |
| `message/` | keyed copy, split by locale and namespace | `content` |
| `media/` | the media-reference seam and its resolvers | `content` |
| `collection/` | repeating editorial records, one subject folder each | `content` |
| `document/` | long-form editorial — a contract and the entity over it | `content` |
| `gate/` | module gates, fragment-per-slice | `permissions` |
| `route/` | declared destinations, fragment-per-slice | `permissions` |
| `flag/` | feature flags, fragment-per-slice, merged by a platform-owned barrel | `permissions` |
| `widget/` | widget declarations, fragment-per-slice, merged by a platform-owned barrel | `permissions` |
| `procedure/` | the merged oRPC contract every slice's `.procedures.ts` feeds | `contracts` |
| `event/` | type-only declarations of what an event carries | `observability` |
| `logger/` | the diagnostic seam and its sinks | `observability` |
| `port/` | abstract classes for cross-cutting infrastructure, zero implementations | `application` |
| `subscriber/` | the durable-reaction seam and the registry over it | `application` |
| `schema/` | every table declaration, plus the barrel drizzle-kit is pointed at | `infrastructure` |
| `transaction/` | the `UnitOfWork` seam and the scope it reads | `infrastructure` |
| `seed/` | the seed classes a runnable script above `src/` calls | `infrastructure` |
| `container/` | the DI root and the config shape it takes | `composition` |
| `fake/` | test doubles for ports, one per port, never on the barrel | `composition` |
| `client/` | the outbound transport and the typed client over it | `api-client` |
| `router/` | the inbound transport's router half — the middleware chain and the routers two apps share | `api-server` |
| `key/` | the cache-key vocabulary every slice's queries name | `query` |
| `runtime/` | what an app constructs and every slice consumes | `query` |
| `i18n/` | the React binding for the message catalog | `feature` |
| `rbac/` | screens over the permission catalog, no query of their own | `feature` |
| `icon/` | source SVGs, the generated sprite, and the name union over it | `asset` |
| `image/` | the shipped image files and the closed key union over them | `asset` |
| `font/` | self-hosted font files and the one `@font-face` sheet | `asset` |
| `auth/` | the credential seam — strategies, token storage, the auth SDK wrapper | `api-client` |
| `consumer/` | queue consumers | `apps/worker` |
| `schedule/` | repeatable jobs | `apps/worker` |
| `bootstrap/` | what a process assembles before it starts working | `apps/worker` |
| `component/` | one folder per exported React component | `ui` |
| `style/` | stylesheets only, and every one the package ships | `ui`, `apps/web` |

**Non-plural, always.** `tasks/` and `task/` coexisting in different packages is exactly the
ambiguity this removes.

**`flag/` and `widget/` are role folders in `permissions` and subject folders everywhere
else.** In `permissions` each holds one declaration fragment per slice, the way `gate/` does.
Elsewhere each is a slice. `application/src/flag/` holds the flag repository port and
`FlagCache`, and the widget slice is preferences, `<Widget>` and the inspector. The two meanings
never share a package, so a path always says which one it is.

**Adding a name to this table is a decision, not a side effect.** If a new folder wants a name that
already means something else here, it is the wrong name.

## Where the contents repeat per feature, the folder is the subject instead

A role folder is right when the package has one of each thing. It is wrong when the package has one
of each thing *per feature* — twenty schemas in one directory next to twenty repositories in another
means a team owns files in two places and neither place belongs to anyone.

**So: if a folder's contents would repeat once per feature slice, name the folder after the
subject.**

```
packages/contracts/src/                not:  packages/contracts/src/
├── index.ts                                 ├── contract/
├── import.ts                                │   ├── task.contract.ts
├── task/                                    │   └── goal.contract.ts
│   ├── index.ts                             ├── entity/
│   ├── task.contract.ts                     │   ├── task.entity.ts
│   ├── task.entity.ts                       │   └── goal.entity.ts
│   └── task.procedures.ts                   └── procedure/
├── goal/                                        ├── task.procedures.ts
└── primitive/                                   └── goal.procedures.ts
```

> [!NOTE]
> **`packages/infrastructure` deliberately does not follow this**, and it is the clearest place to
> see the trade. Its tables live in one `pg/schema/` folder — because `drizzle.config.ts` must be
> pointed at a single barrel that names every table, and `drizzle(pool, { schema })` needs the same
> namespace at runtime for Better Auth's adapter to find its tables at all. One folder is what those
> two tools require, so `pg/schema/rbac.schema.ts` and `pg/repository/pg-capability.repository.ts` do
> sit in two directories. The rule above still describes the default; this is the exception, and it
> is an exception because a tool demanded it rather than because it read better.

A subject folder is singular, and **every file inside is prefixed with the folder's name**. The
folder is the subject; the suffix is the role. A path tells you both without opening anything.

```
packages/contracts/src/task/
├── index.ts
├── task.contract.ts
├── task.entity.ts
└── task.procedures.ts
```

Subject folders repeat across packages by design: `contracts/task/`, `application/task/`,
`query/task/`, `feature/task/`, `web/route/(app)/_authenticated/task/`. One glob per team —
`packages/*/src/<slice>/**`. In `infrastructure` a slice is split across
`pg/schema/task.schema.ts` and `pg/repository/pg-task.repository.ts`, for the tooling reason above.

**Which packages are which.** `core`, `errors`, `permissions`, `observability`, `content`,
`composition`, `api-client`, `api-server` are role-organised — they hold one of each thing. `application`, `query`,
`feature` are subject-organised — they hold one of each thing per slice. `ui` is the third kind: one
folder per exported component, under `component/`.

**`infrastructure` is a fourth kind, and the axis is the vendor.** One folder per external system —
`pg/`, `redis/`, `s3/`, `bullmq/`, `openai/`, `clickhouse/`, `loki/` — with the file named after the
technology too, so `rm -r src/clickhouse/` is the complete answer to a swap.

It used to name the *capability* (`cache/`, `storage/`, `queue/`, `embedding/`, `analytics/`), and
that broke the first time a port got a second implementation: `analytics/` beside a Postgres
`analytics/` reads as two different things, when what it is is two implementations of one port. Naming
the subject twice is what the vendor axis avoids.

It holds only vendors application code **imports**. A log platform that only *receives* stdout has no
folder here — but the moment something reads back from it over an API, that read adapter is an import
like any other, which is why `loki/` exists and holds a reader and no writer.

**`contracts` is both, and that is the clearest illustration of the rule.** Its shared vocabulary
and its two merge points are role folders — `primitive/`, `procedure/`, `catalog/`, `registry/` —
because there is exactly one of each. Its subjects are subject folders, because there is one per
slice. Nothing about the package had to choose; each folder answered the question on its own.

**Two things that look like slices and are not.** `PgVectorStore` and `PgActivityReplayReader` are
infrastructure, which is why they sit in `pg/repository/` beside `PgCapabilityRepository` rather than
inside a slice. And repository *ports* live in the slice, not in `application/src/port/` — `port/` is
for capabilities the whole system shares, and putting `TaskRepository` there would make that folder
grow by one file per feature forever.

**The test for `port/` is what a new feature adds, not what the port is called.**
`ActivityReplayReader` lives there and looks slice-shaped — `since`, `dailyCounts` — but a second
feature adds a *method* to it, not a second file beside it. `TaskRepository` is the opposite: every feature
brings its own. One cross-cutting seam that many subjects ask questions of belongs in `port/`; one
seam per subject belongs with the subject.

## Build-time artefacts and runnable scripts sit above `src/`

`drizzle.config.ts`, `migrations/`, `build-sprite.mjs`. They are not shipped code, and `src/` is
the shipped surface.

**A runnable script belongs there too, and the reason is sharper than tidiness.** A script inside a
folder makes that folder's barrel *execute it* the moment somebody imports a sibling — which is
exactly what happened when `PgPersonalOrganizationEnroller` needed `SystemRoleSeed` and the seed
was `src/pg/seed/index.ts`: importing the class connected to Postgres and called `process.exit`
in the middle of a sign-in.

So `packages/infrastructure/{migrate,seed,smoke}.ts` and `packages/auth/tables.ts` are files at the
package root, named after what they do. The classes they use stay in `src/` where they can be
imported safely. It is also what keeps `dotenv`, `process.env` and `console.log` out of `src/`
entirely: the three lint exemptions those need are now four filenames rather than four globs over
directories that also hold library code.
