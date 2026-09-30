---
title: Adding a package's docs
description: The run book for writing docs/ inside a package — what index.md must answer, when a reference page earns its place, and the meta.json that orders them.
---

# Adding a package's docs

Every package carries its own `docs/`, next to the code it describes, answering **why each export is
shaped the way it is**. Not what it does — the types say that — but what it costs, what breaks if
you use it the obvious way, and which decision it encodes.

That is a different job from the other three trees, and keeping them apart is what stops all four
rotting:

| Tree | Answers |
|---|---|
| `packages/<name>/docs/` | Why *this package's* exports are shaped this way |
| [`docs/opinions/`](../../opinions/index.md) | Why a *repository-wide* rule exists |
| [`docs/setup/`](../../setup/index.md) | How the package was *built*, in order |
| [`docs/ai/rules/`](../rules/index.md) | What an agent must *do*, stated flatly |

**If what you are writing belongs in one of the lower three, put it there and link to it.** A
repository-wide rule restated in a package's docs is a second copy that will drift.

---

## The shape

```
packages/<name>/
└── docs/
    ├── meta.json          title, description, page order
    ├── index.md           what the package is for — the page a reader lands on
    └── reference/
        ├── meta.json      group label and page order
        └── <subject>.md   one page per export that needs an argument
```

**Only `index.md` and `meta.json` sit at the `docs/` root; everything else goes in `reference/`.**
Plain Markdown with YAML frontmatter, never MDX, so it renders on GitHub today and can be picked up
by a docs site later without touching the content. Callouts use GitHub alert syntax — `> [!NOTE]`,
`> [!IMPORTANT]`, `> [!WARNING]`, `> [!CAUTION]`.

`docs/` is not in `package.json`'s `files` array and never ships. See
[06 · Package anatomy](../../setup/06-package-anatomy.md).

> `reference/` has no `index.md` and should not have one — the parent names every page and
> `meta.json` orders them. That exemption is stated in [Folders](../../opinions/folders.md).

---

## Step 1 — `docs/meta.json`

```json
{
  "title": "core",
  "description": "Clock, Result, Uuid, ServerOnly — the four primitives everything else may depend on",
  "pages": ["index", "reference"]
}
```

`title` is the bare package name, no scope. `description` is one sentence naming the exports and the
job — it is what a sidebar shows, so it has to survive being read alone.

## Step 2 — `docs/index.md`

Frontmatter first, then the page. It answers six things, in this order, and the order is what makes
two packages' docs comparable:

1. **Where it sits in the graph** — what it imports, what imports it, and why that is the boundary.
2. **The fact table** — package name, entrypoint, depends on, used by, environment, build.
3. **The tree** — `src/` and `tests/`, with `→ Name` marking what each file exports.
4. **What belongs here** — the admission test for a new export. This is the most valuable section
   and the one most often skipped; without it the package grows by accretion.
5. **The exports themselves** — one subsection each, with the signature, a usage line, and a link
   to its reference page.
6. **See also** — the reference pages, the `docs/setup/` document that built it, and any package
   whose decision this one inherits.

`packages/core/docs/index.md` is the worked example. Read it before writing a new one.

> [!IMPORTANT]
> **Write the section that says what does *not* belong.** `core`'s is two conditions, both
> required, and it is the reason that package has four exports rather than forty. A docs page that
> only describes what exists cannot stop the next addition.

## Step 3 — a `reference/` page, if the export earns one

**An export earns a page when the argument for its shape is longer than two lines** — which is the
same ceiling comments have, and for the same reason ([Comments](../../opinions/comments.md)). If the
constraint fits in a `//` comment, leave it in the code.

A reference page carries what a comment cannot: the signature in full, the rule it enforces, why the
obvious alternative is wrong, and the failure that produced it.

```
---
title: clock
description: <one sentence — what it is and the rule it enforces>
---

# `Clock`

<the full signature, in a ts block>

## The rule
<the constraint, as an alert callout>

## Why this is not over-engineering
<the volume argument, or the failure it prevents>

## <the trade you accepted>
<stated plainly, not hidden>
```

Then register it in `reference/meta.json` — **the page will not appear in a sidebar otherwise**:

```json
{ "title": "Reference", "description": "One page per primitive", "pages": ["clock", "result", "uuid", "server-only"] }
```

`pages` is an explicit ordered list, not a glob. A page missing from it is invisible; a page named in
it that does not exist is a dead link. Both are silent.

## Step 4 — link outward, never restate

- To a repository rule → [`docs/opinions/`](../../opinions/index.md).
- To how it was built → the numbered [`docs/setup/`](../../setup/index.md) document.
- To another package's decision → that package's `docs/`, by relative path.

`core`'s docs link `tooling/tsconfig`'s reference page for where `lib: ["ES2024"]` comes from rather
than explaining it again. That is the pattern: name the owner, link it, move on.

---

## Verify

```bash
pnpm check:architecture      # §13 — every folder under docs/ has an index.md
```

Then by hand, because nothing checks these:

- **Every page in `meta.json` exists, and every page has an entry.** A mismatch is invisible until a
  docs site is pointed at it.
- **Every relative link resolves.** Package docs sit three levels deep, so `../../../docs/opinions/`
  is the path to a repository page — the easiest thing in the repo to get wrong.
- **No repository-wide rule is restated.** If a sentence would be equally true in another package's
  docs, it belongs in `docs/opinions/` and this page should link it.
- **The frontmatter `description` reads correctly alone.** It is the sidebar text and the search
  result.

## Commit

```
docs(<scope>): <package> reference — <what it now explains>
```

`<scope>` is the package's own scope from the closed `scope-enum` in `commitlint.config.js` — the
docs live in the package, so they commit with it, not under `docs`.
