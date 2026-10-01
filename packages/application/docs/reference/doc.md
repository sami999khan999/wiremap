---
title: Docs
description: One slice for public, private and organization docs — why platform docs are the platform organization's rows, how a page is rendered once and read from one row, and who may read what.
---

# Docs

A space is a sidebar of pages. An organization writes its own spaces for its own members. The
platform organization writes the product's documentation. Some of it is public, and some of it is
opened to chosen organizations, people and plans.

**That is one slice, not three.** There is one schema, one set of use-cases, one renderer and one
reader. This page explains why that holds, and what the storage does to make a read cheap.

## Platform docs are the platform organization's rows

The obvious design keeps the platform's docs in catalog tables beside `plans` and
`feature_flags`, and a tenant's in routed tables. That is two schemas, two repositories, and a
second copy of every rule.

**The premise behind it does not hold.** "An anonymous reader has no shard" is true. But the shard
key is an organization, not a person, and the platform's spaces belong to one organization that is
always known: `PlatformReader.organizationId()`. So a public read is placed at that organization's
node with `Container.placedAt`, which builds an empty system principal whose only job is to place
the request.

| | Where it lives | Who writes it |
|---|---|---|
| An organization's spaces | `doc_spaces`, `doc_pages`, `doc_revision`, `doc_sections` — routed, `LIST (organization_id)` | its members holding `doc.page.write` |
| The platform's spaces | the same four tables, under the platform organization | the platform organization's members, with the same keys |
| Who may read a granted platform space | `doc_space_grants` — catalog | platform admins, `platform.doc.grant` |

The grants are the one catalog table. A grant names an organization, a person or a plan anywhere
in the deployment, and it is read before a request is placed, just like `entitlement_adjustments`.
Its columns are `grantee_organization_id`, `grantee_user_id` and `grantee_plan_key`, never
`organization_id`. With that column, §17 would read the table as a tenant's and require every
unique index to lead with it.

## Who may read a space

A space has an **audience**:

| Audience | Who reads it | Allowed on |
|---|---|---|
| `members` | holders of `doc.page.read` in the owning organization | any organization |
| `public` | anyone, signed in or not | the platform organization only |
| `granted` | platform admins, and anyone a grant reaches | the platform organization only |
| `owner` | its author, and nobody else | any organization |

`DocRules.assertAudience` refuses `public` and `granted` anywhere else, so a tenant can never
publish to the world.

Inside an organization, the permission is the answer for every audience but one. A member with
`doc.page.read` reads every `members` space, and the other audiences only widen who *else* may
read.

**`owner` is the one audience that narrows.** An `owner` space is its author's alone, and
`created_by` names the author. Everyone else is told it does not exist. That includes another
member, an org admin, a platform admin and a signed-out visitor, and the answer is `NOT_FOUND`,
never `FORBIDDEN`, so its slug cannot be probed. Every use-case that touches a space or one of its
pages asks `DocRules.assertVisible` first. `list`, search and the tree filter with
`DocRules.isVisible` before they rank or build anything, and `DocAccess.canRead` checks it before
any grant. So an owner space never reaches `/llms.txt` or the public reader. A grant on one is
refused (`error.field.private`), and only the author may switch a space to `owner`
(`DocRules.assertAudienceChange`). `doc_spaces_owner_idx` covers the author's lookup.

| Viewer | `members` | `public` | `granted` | `owner` |
|---|---|---|---|---|
| the author, a member | reads | reads | reads | reads |
| another member | reads | reads | reads | `NOT_FOUND` |
| an org or platform admin | reads | reads | reads | `NOT_FOUND` |
| a signed-out visitor | `NOT_FOUND` | reads | `NOT_FOUND` | `NOT_FOUND` |

The platform organization's `public` and `granted` spaces are read from outside through
`DocAccess.canRead`. The table's middle two columns apply to them there.

Outside it, `DocAccess.canRead` decides. A grant reaches a viewer three ways: to them by name, to
their active organization, or to that organization's plan. **The plan is how a private space rides
an entitlement.** Moving an organization to a plan opens every space granted to the plan, and
moving it off closes them, with no per-organization rows to keep in step.

The viewer's readable set is one catalog query, cached for sixty seconds under
`doc:access:<organization>:<user>`. A grant write clears the whole prefix after it commits. A
plan's grant reaches people nobody could list without reading every tenant, so there is no
narrower key to delete.

**Not yours is not found.** A private space asked for by someone who may not read it is
`NOT_FOUND`, never `FORBIDDEN`. Answering differently would let anyone probe for private slugs.

## A page is rendered once

`PublishDocPageUseCase` renders the Markdown when a page is published, and never when it is
read. The renderer is behind `MarkdownRenderer`, because the parser is a node-only dependency the
domain must not name. See
[`doc-renderer.md`](../../../infrastructure/docs/reference/doc-renderer.md) for the pipeline and
the sanitiser.

The preview in the editor calls the same renderer through `docPage.preview`. A client-side parser
would be a second renderer, and the day the two disagreed the preview would lie about the page.

## A read is one row

`doc_pages` holds both halves of a page:

| Columns | Read by |
|---|---|
| `title`, `markdown`, `draft_version`, … | the editor |
| `published_title`, `published_html`, `published_toc`, `published_markdown`, `revision_no`, … | the reader |

Both bodies are TOASTed, so **no query here selects `*`**. The tree's query names the tree's
columns, and each side names its own.

The published snapshot on the row is what lets `doc_revision` be pure history. Archiving or
dropping a month of revisions cannot break a live page, because no live page reads them.

**The reader's sidebar is one column too.** `doc_spaces.nav` is the published tree as JSON. It is
rebuilt by `DocTree` inside the same transaction as the publish, move or delete that changed it,
and the row's `version` goes up by one each time.

A tree node carries its page's `revision_no`. So a reader resolves the page's cache key from the
tree alone:

| Key | Holds | Lifetime |
|---|---|---|
| `doc:space:<org>:<slug>` | the space and its tree | 60 s, deleted after each commit that changes it |
| `doc:page:<org>:<page>:<revision>` | a published page | one day; never stale, since a new revision is a new key |
| `doc:spaces:<org>` | every space in the organization, without trees | 60 s, deleted with any space |

**A warm page is zero queries, and a cold one is two.** Cache delete after commit, never inside
the transaction: a reader between the delete and the commit would put the old row straight back.
The platform organization is remembered for the life of the process, so the public reader asks
for it once, not four times a page.

## A large space costs a page read nothing extra

**A page read carries the tree trimmed.** `DocRules.trimNav` keeps every section's pages and the
children of the pages above the one being read. Every other branch is `folded: true` with no
children. The reader fetches the whole tree once the page is up:
- from `docSpace.nav` in an organization's docs;
- from `/api/doc-nav/<space>?v=<version>` for the platform's.

The version is in the request, so the answer never changes. The public URL is served
`immutable` to anyone not signed in, and the browser and a CDN keep it. The sidebar renders only
open branches, and an article lays out only the sections near the viewport.

`pnpm doc:bench` measures it: a public 2,000-page space whose 20 largest pages sit at the
200,000-character cap. It reports queries per request from `pg_stat_statements`. On 2026-10-01,
on the development machine under heavy outside load (load average 11–15 on 4 cores), one web
process:

| Path | Before | After |
|---|---|---|
| Page read, warm | 28 req/s, 5 queries | 59 req/s, **0 queries** |
| Page read, cold | 28 req/s, 6.2 queries | 54 req/s, 0.9 queries |
| Page HTML, 2,000-page space | 347 KB | 97 KB |
| Full tree, fetched once per version | in every page | 328 KB, 48 KB gzipped, `immutable` |
| Search, p95 | 46 ms | 60 ms |
| Render of the largest page | 792 ms | 563–1,201 ms, p95 7 ms |

**Still open:** the article's HTML is sent twice, rendered and again in the hydration data, so the
largest page's response is 674 KB for 292 KB of HTML. See `DS0.10` in the docs plan.

## Two authors, one page

Every save and publish names the `draft_version` it read. The write is
`UPDATE … WHERE draft_version = $expected`. The row lock is what makes two saves racing for one
version produce exactly one winner, and the loser gets `CONFLICT`.

The revision number is a counter on the page row, moved under the same lock. It is not a count of
`doc_revision` rows, because a unique index there cannot lead with the page once the table has a
month level.

A restore writes the revision's text into the **draft**. Making it live again is a publish, which
is a second, deliberate step.

## Structure is live, content is published

A page's text reaches readers only when it is published. Its **slug, icon and position are
structure**, and they change the reader's tree as soon as they are saved, because a URL that only
changed on publish would leave the tree and the pages disagreeing.

Sections and links have no content at all, so they are in the tree from the moment they exist.

Paths run through pages and never through sections: a page under the "Guides" section is
`/writing`, not `/guides/writing`. That is why `DocRules.assertTree` checks paths across the whole
tree rather than slugs among siblings. Two pages under two sections can collide.

## Search

`doc_sections` holds one row per heading of every published page, plus one for the page's own
title. The rows are replaced in the publish's transaction, so a page is searchable the moment a
reader can open it. Postgres writes a `tsvector` from each row, with the `simple` configuration,
because the same index has to serve every language an author writes in.

The palette searches while a word is still being typed, so every word becomes a prefix:
"instal" is `instal:*` and finds "Installation". The query is rebuilt from its letters and
digits alone, so no operator an author types reaches `to_tsquery`. Page titles are also
matched by trigram, which is what finds "quik start".

Excerpts come back as plain text, and nothing downstream renders them as HTML. The author
wrote that text, and a `<script>` in a code sample is still just text in a search result.

## Images

An image is uploaded straight from the browser to storage. `docPage.upload` checks the key,
the type and the size, then signs one `PUT`, which is good for five minutes. The app never
holds the bytes.

**The key is the index.** An image lives at `doc/<organization>/<space>/<id>.<type>`, so there
is no table of images to keep in step:

| When | What goes |
|---|---|
| A space is deleted | its prefix, after the commit |
| A tenant is purged | its prefix, beside the partition drop |

A page deleted on its own leaves its images in place, because another page may link them.

A page links `/api/doc-image/<organization>/<space>/<type>/<id>`, never the bucket.

- **Why the route and not the bucket:** it applies the same reading rules as the page itself,
  then redirects to a signed URL that lasts an hour.
- **Why there is no file extension:** a dev server treats any path ending in `.png` as a static
  file and never asks the app, which is also why the raw Markdown route has no `.md`.
- **Why other organizations get a 404 before any lookup:** only the viewer's own organization or
  the platform's can have an image to show. A guessed organization id is answered with 404 before
  it is placed. Otherwise each guess would cost a shard lookup and an error log.

**Only raster images are accepted.** An SVG is a document that can carry script, and it would be
served to every reader of the page.

> [!IMPORTANT]
> A browser upload is a cross-origin `PUT`. MinIO allows every origin by default. An S3 bucket
> needs a CORS rule allowing `PUT` from the app's origin, or every upload fails in the browser
> with a CORS error and nothing in the app's logs.
