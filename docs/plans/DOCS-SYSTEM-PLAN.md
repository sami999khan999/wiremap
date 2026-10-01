---
title: Docs system plan — feature-linked access, whole-docs search, and the Fumadocs-style reader finished
updated: 2026-10-01
owner: sami
schema: plan/v1
source: owner request 2026-10-01 with a Fumadocs reference screenshot; two read-only surveys (the doc slice, the access system); three rounds of questions answered by the owner
---

# Docs system plan

> **How to use this file**
> 1. The ID prefix is `DS`, which no other plan uses. Items are `DS<phase>.<n>`.
> 2. Checkboxes: `[ ]` todo, `[~]` in progress, `[!]` blocked, `[x]` done, `[-]` dropped. Add
>    `done: YYYY-MM-DD` when closing an item.
> 3. Phases run in order. Each item names the doc it updates.
> 4. Commit once per layer, in the order `docs/ai/skills/add-slice.md` gives. Use conventional
>    commits with a scope. **No AI or co-author trailers.**

---

## Context

The owner wants lite's documentation system to look like the Fumadocs reference, in every theme,
with access that is **dynamic**: what a reader sees follows the access system's features.

**Most of the reader already exists.** Lite's doc slice has:
- spaces and pages with drafts, revisions and publishing;
- the sidebar, with icons, nested pages, the Ctrl/Cmd+K palette and a space switcher;
- the page header with Copy Markdown and an Open menu, and the "On this page" TOC;
- six themes with a default per space, and a light/dark toggle;
- a public reader, raw Markdown, `/llms.txt`, and full-text search.

**What is missing:**
- **Access:** it is per space only, by `audience` (members, public, granted, owner) and grants to
  a user, an organization or a plan. **No doc can be tied to a module, a permission or a flag**,
  and no single page can be restricted.
- **Search:** confirm that it reaches every space the reader may read, not just the open one.
- **Reader features:** the GitHub link, "Open in ChatGPT / Claude", previous and next, breadcrumbs,
  collapsible sections, and the space icon field.
- **Markdown:** tabs, steps, accordions, and card icons.
- **Look:** a visual pass to match the screenshot.

### Decisions recorded up front (do not re-litigate)

1. **Extend, don't rebuild.** The doc slice, routes, editor and themes stay.
2. **A doc links to four kinds of feature:** a **module** (`ModuleKey`), a **permission**
   (`PermissionKey`), a **flag** (`FlagKey`) and a **plan** (plan key).
3. **Links apply to a space and to a page.** A page's links add to its space's links.
4. **All links must pass.** It is an AND, so every link narrows further, as the access
   mechanisms each narrow the one above.
5. **Hidden means not found.** A hidden doc is absent from the sidebar, search, `/llms.txt` and raw
   Markdown, and a direct link answers `NOT_FOUND`. It matches "not yours is not found".
6. **Signed out sees no linked doc.** A signed-out reader has no organization, plan or permission
   to satisfy a link. Unlinked public pages are unchanged.
7. **No Ask AI button.** Search covers the whole docs instead, as full text across every
   readable space. It needs no AI key.
8. **The GitHub URL is per space**, set in the space settings. No URL means no link.
9. **Who sets links:** space links need `doc.space.manage`, and page links need `doc.page.write`.
   A link can only narrow, so a writer cannot widen access by setting one.
10. **The kept extras:** the GitHub link and Open in AI, the richer Markdown, the reading aids, and
    the visual pass.
11. **Performance is a requirement, not a phase at the end.** Large docs must cost no more per
    request than small ones. Budgets are fixed in `DS0.2`, a benchmark proves them, and every later
    phase re-runs it.

### What exists and is reused

| Piece | Where |
|---|---|
| Space access rules | `packages/application/src/doc/doc-access.ts`, `doc.rules.ts` |
| Published sidebar tree, one row per space | `doc_spaces.nav`, `DocTree`, `doc-nav.ts` (`DocNavNodeDto`) |
| Module visibility | `ModuleRegistry.visibleModules(caps)`, `packages/permissions/src/gate/*.gate.ts` |
| Permission check, plan mask applied | `CapabilitySet.can`, `CapabilityResolution.fold`, `EntitlementMask` |
| Flags per organization | `FlagCache.isOn` / `onFor` (`application/src/flag/flag.cache.ts`), `FlagRegistry` |
| Plans | `plans`, `organizations.plan_key`, the plan grant in `doc_space_grants` |
| Search | `DocSearch` (`doc-search.ts`), `doc_sections` with full text and trigram |
| Reader UI | `feature/src/doc/*`, and `NavTree`, `Toc`, `CommandDialog`, `Select`, `Menu`, `Popover` in `ui` |
| Renderer | `infrastructure/src/unified/unified-markdown.renderer.ts`, `renderer_version` |
| Reading order and trails | `feature/src/doc/doc-nav-tree.ts` (`pages`) |

---

## The phases

### Vocabulary fixed up front

- **Access link:** one of `module`, `permission`, `flag` or `plan`, set on a space or a page.
- **Access rule:** the set of links on one doc, stored as
  `{ module?, permission?, flag?, plan? }`.
- **Effective rule:** the space's rule plus the page's rule. All of its links must pass.
- **Readable:** passes the audience rules (today's `DocAccess`) **and** the effective rule.

### Phase 0 — Performance budgets and a large-docs benchmark

Measured on 2026-10-01, on the development machine (4-core i5-4440, one web process): server-rendered
pages top out near **200–280 requests a second**, with one CPU core saturated by React rendering.
`/api/health` reaches 1,500. Three things in the doc slice scale with size today:
- **The whole space tree ships with every page read** (`DocSpace.view.nav`), with no limit on page
  count.
- **Autosave sends the full Markdown** (up to 200,000 characters) after every 2-second pause, and
  the preview renders the whole page on the server.
- **Publishing renders inside the request**, however long the page is.

- [ ] `DS0.1` **Benchmark.** A `pnpm doc:bench` script seeds a throwaway organization with a large
  space: 2,000 pages, 6 levels deep, the largest pages at the 200,000-character cap with 300 code
  blocks. It then load-tests the reader page, the nav, search and publish, and prints p50, p95 and
  queries per request. Results are recorded in `doc.md`.
- [ ] `DS0.2` **Budgets**, on one web process:

  | Path | Budget |
  |---|---|
  | Page read, warm / cold | 0 / 2 queries; p95 ≤ 150 ms at 100 req/s |
  | Nav for a 2,000-page space | ≤ 60 KB gzipped, fetched once per space version |
  | Search | p95 ≤ 120 ms, bounded by `limit` |
  | Publish of a 200,000-character page | ≤ 1 s, or rendered in the worker |
  | Access filtering (`DS1.4`) | 0 extra queries, linear in nav nodes |
  | Largest page in the browser | no long task over 200 ms on first paint |
- [ ] `DS0.3` **Nav out of the page read.**
  - The tree moves to its own procedure and server function, keyed by space id, space version and
    the viewer's **access fingerprint**: the set of links the viewer passes.
  - It is cached in Redis under that key and served with an `ETag`, so viewers with the same
    outcome share one copy and a page read stops carrying the tree.
  - The node shape is compacted, with short keys and no `revisionNo` in the sidebar.
- [ ] `DS0.4` **Large pages in the browser.**
  - `Prose` sets `content-visibility: auto` on top-level sections, so offscreen sections cost no
    layout.
  - Code-block copy buttons are created as their block scrolls into view.
  - The TOC observes headings once, not per render.
- [ ] `DS0.5` **Editor and publish.**
  - Autosave sends only when something changed, and is skipped while a save is in flight.
  - The preview renders on demand, in the Preview tab only, with a debounce.
  - Publishing a page over the render budget queues it on the maintenance queue and shows
    "publishing", rather than holding the request.
- [ ] `DS0.6` **Query plans pinned.** Specs assert, with `EXPLAIN`, that a page read, a nav read
  and a search use their indexes. A query-count spec covers each reader path.

**Exit.** `pnpm doc:bench` meets every budget in `DS0.2`. The numbers are written in `doc.md`.

### Phase 1 — Access links

- [ ] `DS1.1` **Contract.**
  - `DocAccessRuleDto` in `contracts/src/doc/`: four optional fields, each a key string, with `null`
    meaning no rule.
  - `access` on the space and page entities, and on `DocNavNodeDto`, so the sidebar can be filtered
    without a query.
  - Space update and page save accept `access`.
  - Docs: `packages/contracts/docs`.
- [ ] `DS1.2` **Schema.** Migration `0003_doc_access.sql` adds `access jsonb` (nullable) to
  `doc_spaces` and `doc_pages`. It also adds `repository_url text` to `doc_spaces`, for `DS5.1`.
  The columns are nullable, so the change is safe on a table that already holds rows (§20).
- [ ] `DS1.3` **The rule** (`application/src/doc/doc-feature.gate.ts`, class `DocFeatureGate`).
  `allows(viewer, rule)` passes only when every link passes:
  - **module:** the module is in `ModuleRegistry.visibleModules(viewer.capabilities)`;
  - **permission:** `viewer.can(key)`;
  - **flag:** `FlagCache.isOn(viewer.organizationId, key)`;
  - **plan:** the viewer's organization is on that plan, read through a cached `plan_key` lookup.

  A null viewer fails any link. A key the registries no longer know **fails closed**: the doc
  hides, it does not open up. Permission and module checks already include the plan mask,
  overrides and platform denies, because `CapabilitySet` is narrowed first.
- [ ] `DS1.4` **Apply it everywhere a doc is reached.**
  - `DocAccess.canRead` adds the space rule.
  - `ReadDocPage` and `ReadPlatformDoc` add the page rule, and fail with `NOT_FOUND`.
  - The nav is filtered per viewer before it is returned. A hidden page takes its subtree with it,
    and a section left empty disappears.
  - `DocSearch` drops hits whose effective rule fails.
  - `/llms.txt`, `api/doc/$` and the public reader exclude any doc with a rule.
  - Platform docs read by a tenant user are judged against that user's active organization.
- [ ] `DS1.5` **Editing.**
  - Space update and page save validate each key against its registry (`ValidationError`
    otherwise) and enforce decision 9.
  - Access is structure, not content: it is live on save, like a slug, and the nav is rebuilt in
    the same transaction.
  - A new procedure, `docPage.accessOptions`, needs `doc.page.write`. It returns the modules,
    org-scope permissions, flags and plans, each with its label, for the pickers.
- [ ] `DS1.6` **UI.**
  - An "Access" fieldset in `doc-space.form.tsx` and in `doc-editor.form.tsx`: four `Select`s with
    "None" first. The flag `Select` is hidden while `FLAGS` is empty.
  - A badge in the page tree marks a linked page.
  - A warning appears when a stored key is unknown.
  - Copy goes in both `doc` catalogs, en and bn.
- [ ] `DS1.7` **Specs.**
  - A matrix for `DocFeatureGate`: each link alone, the AND of several, a null viewer, and an
    unknown key.
  - The read, nav, search and `llms.txt` filters each get a spec where the hidden doc gives
    `NOT_FOUND` and is absent.
  - Query-count assertions show the nav filter adds no queries.
- [ ] `DS1.8` **Docs.**
  - `packages/application/docs/reference/doc.md`: a section on access links, with the
    viewer-by-link matrix.
  - `docs/ai/rules/visibility.md` and `docs/opinions/visibility.md`: one line saying a doc link is
    resolved through the same three mechanisms and adds none.

**Exit.** These four checks pass by hand:
1. A page linked to the `apikey` module is readable by an organization whose plan includes it, and
   not found for one whose plan doesn't, or once the module is switched off.
2. A page linked to `rbac.role.manage` shows to an admin and not to a member.
3. A page linked to a plan shows only on that plan.
4. Signed out, none of these pages appear.

### Phase 2 — Search the whole docs

- [ ] `DS2.1` **Scope.** The palette searches every space the viewer may read in the reader it is
  in: the organization's spaces in `/doc`, and the readable platform spaces in `/docs`. It is no
  longer only the open space. Confirm what `DocSearch` does today, then widen it if needed.
  Results are filtered by `DS1.4`.
- [ ] `DS2.2` **Grouping.** Hits are grouped by space, with the current space first. Each hit names
  its space, and following it opens that space.
- [ ] `DS2.3` **Specs and docs.** A hit in another readable space is found, and a hit in an
  unreadable or linked-away space is not. Docs: `doc.md` (search).

### Phase 3 — Reading aids

- [ ] `DS3.1` **Previous and next** at the foot of a page, from the filtered reading order
  (`doc-nav-tree.ts` `pages`).
- [ ] `DS3.2` **Breadcrumbs** above the title, from the page's trail.
- [ ] `DS3.3` **Collapsible sidebar sections.** `NavTree` section headings become toggles, open
  when they hold the active page, and the choice is remembered per session.
- [ ] `DS3.4` **Space icon field** in `doc-space.form.tsx`. The contract and the database already
  support it.
- [ ] `DS3.5` **Specs, plus `packages/ui/docs/reference/docs-primitives.md`.**

### Phase 4 — Richer Markdown

- [ ] `DS4.1` **Renderer version 2.** New directives:
  - `:::tabs` containing `:::tab{title}`;
  - `:::steps`, numbered;
  - `:::accordion{title}`, rendered as `<details>` and `<summary>`;
  - `icon=` on `:::card`, written as `data-icon`.

  The sanitizer allows exactly these `ui-*` classes and attributes.
- [ ] `DS4.2` **Behaviour in `Prose`.**
  - Tabs get an ARIA tablist with arrow keys. That is enhanced after mount, because the HTML is
    server-written. With no script, every panel shows stacked.
  - Card icons fill from the sprite.
  - Styles go in `ui/src/style/markdown/`.
- [ ] `DS4.3` **Re-render.** A `pnpm doc:rerender` script, plus a maintenance job, re-render pages
  whose `renderer_version` is below the current version. They rewrite the published snapshot
  without a new revision.
- [ ] `DS4.4` **Specs, plus `packages/infrastructure/docs/reference/doc-renderer.md` and an
  authoring guide for each directive.**

### Phase 5 — GitHub link and Open in AI

- [ ] `DS5.1` **Repository link.**
  - `repository_url` (from `DS1.2`), accepting `https` only.
  - A field in the space form.
  - An icon link in the sidebar footer, beside the theme controls.
  - A `github` icon added to `packages/asset`.
- [ ] `DS5.2` **Open in AI.** The Open menu gains "Open in ChatGPT" and "Open in Claude", each
  prefilled to read the page's raw Markdown URL. They show only when the page has one, which means
  public and unlinked pages. A private page's Markdown cannot be fetched by those tools.
- [ ] `DS5.3` **Specs and copy.**

### Phase 6 — Visual pass

- [ ] `DS6.1` **Match the reference.**
  - The sidebar search box with its key caps, and the space switcher with an icon tile.
  - The active item as a tinted pill.
  - The title scale, the muted description, and the action row with its divider.
  - The callout card, the TOC rail with an active marker, and the sidebar footer bar.

  All through utilities and the twelve colours.
- [ ] `DS6.2` **Check every theme.**
  - Each of the six themes in light and dark.
  - `check:contrast` takes any new pairing.
  - The kitchen sink shows the new directives.

**Exit.** The reader next to the screenshot, in `graphite` dark, is the same layout. `slate`,
`ocean`, `forest`, `plum` and `midnight` read cleanly.

### Phase 7 — Wrap-up

- [ ] `DS7.1` `docs/plans/TESTS.md` gets this plan's owed runs and hand checks.
- [ ] `DS7.2` `docs/scale/back-ports.md` gets a row: doc access links and the reader additions,
  owed to the big kit.
- [ ] `DS7.0` **Re-run `pnpm doc:bench`** after every phase: no budget may regress.
- [ ] `DS7.3` The full gate: typecheck, lint, every test, `check-architecture`, `check:contrast`,
  then a push with CI green.

---

## Verification — the whole plan

```bash
pnpm build:packages && pnpm --filter @loadbearing/web build
pnpm -r --no-bail run typecheck && pnpm lint
pnpm -r --no-bail run test        # with the stack up, after `pnpm infra:reset` once
CI= node tooling/scripts/check-architecture.mjs && pnpm check:contrast
```

By hand:
- **Users:** alice is an admin on a plan with `apikey`. bob is a member on a plan without it. Also
  check signed out.
- **Links:** each link kind alone, then the AND of two; switch a module off; turn a flag on for one
  organization; deny a permission by override.
- **Search:** from every space; a hidden page never appears.
- **Reader:** the reading aids, the Markdown directives, the GitHub link and Open in AI, and all six
  themes against the screenshot.

## Not in this plan

- An Ask AI button, or semantic search over docs. Decision 7 replaces them with whole-docs full
  text.
- Access by role, beyond what a permission link gives.
- A locked teaser for hidden docs. Decision 5 makes them not found instead.

## Changelog

| Date | Who | Change |
|---|---|---|
| 2026-10-01 | @sami | Plan written from three rounds of questions. |
| 2026-10-01 | @sami | Phase 0 added: performance budgets and a large-docs benchmark, from measured numbers. |
