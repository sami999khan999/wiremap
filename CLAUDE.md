## The rulebook, loaded in full

Every file in `docs/ai/rules/` is imported below, so an agent working in Claude Code holds the
whole rulebook before it reads a line of code and never has to know to go looking. The router in
[`docs/ai/index.md`](docs/ai/index.md) and the contents page in
[`docs/ai/rules/index.md`](docs/ai/rules/index.md) are deliberately **not** imported — once every
rule is present, both are tables pointing at things already in context. They stay for agents that
do not read this file.

`AGENTS.md` is imported rather than restated. It is the brief every other tool loads unprompted,
and a second copy here would be the one that drifts.

This list is checked: `check-architecture.mjs` §12 fails if a file lands in `docs/ai/rules/` and no
`@` line here imports it.

@AGENTS.md

@docs/ai/rules/layering.md
@docs/ai/rules/files.md
@docs/ai/rules/folders.md
@docs/ai/rules/imports.md
@docs/ai/rules/classes.md
@docs/ai/rules/comments.md
@docs/ai/rules/color.md
@docs/ai/rules/dependencies.md
@docs/ai/rules/vocabulary.md
@docs/ai/rules/data.md
@docs/ai/rules/visibility.md
@docs/ai/rules/simplicity.md
@docs/ai/rules/workflow.md
@docs/ai/rules/explaining.md

The skill run books in [`docs/ai/skills/`](docs/ai/skills/index.md) are **not** imported. They are
procedures you execute on request, not rules you must hold — reach them by name (`/add-slice`,
`/add-docs`) or open the file.
