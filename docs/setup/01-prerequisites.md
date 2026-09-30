# 01 · Prerequisites

> Everything that must exist on the machine before the repo does. Fifteen minutes, once per machine.

**Delivers:** Node 24, pnpm 11, Docker, and a Git configuration that survives a mixed Windows/macOS/Linux team.

**Prerequisite:** none — this is the first document.

---

## Why these exact versions

| Tool | Version | Why this one |
|---|---|---|
| Node | 24.x | Active LTS until April 2028, so it outlives the first two years of the project. oRPC is ESM-only, and 24 gives native `require()` of ESM, which matters if you add NestJS later. |
| pnpm | 11.21+ | Catalogs, `allowBuilds`, and supply-chain defaults that are on rather than opt-in. Requires Node 22+, which you already have. |
| Docker | any current | Postgres + pgvector, two Redis instances, MinIO, and the Loki/Alloy observability stack all run as containers. Nothing is installed natively. |
| Git | 2.34+ | `core.longpaths`, and hooks via `core.hooksPath`. |

Install pnpm once by any means you like; the repo pins the version itself from there on. Do **not** build the setup on Corepack — it is bundled with Node 24 but was removed from Node 25 and every release after, so anything depending on it breaks the moment you move to 26 in October.

---

## Step 1.1 — Node 24

Install a Node version manager rather than Node itself. [fnm](https://github.com/Schniz/fnm) works on all three platforms; [nvm](https://github.com/nvm-sh/nvm) is the Linux/macOS alternative.

```bash
fnm install 24
fnm use 24
```
> Once the repo has a `.nvmrc` (created in [02](02-repo-skeleton.md)), `fnm use` reads it and no argument is needed.

### Why 24 and not 26

Node 26 is the Current line and does not become LTS until October 2026. Current lines exist so library authors can add support for them, not so products can ship on them — native addons, prebuilt binaries, and CI base images all lag by a release. Node 24 is Active LTS through October 2026 and supported to April 2028.

Take 26 in October, when it becomes LTS. The move is a one-line `.nvmrc` change if you keep the rules below.

**Two things stay pinned to a major line and must move together**: `.nvmrc` (and therefore CI, which reads it) and the `@types/node` catalog entry. Types from a different major than the runtime produce APIs that typecheck and then throw at runtime.

---

## Step 1.2 — pnpm

```bash
npm install -g pnpm
```
> Or the standalone installer from [pnpm.io/installation](https://pnpm.io/installation) if you would rather not have npm involved at all. Either is fine — this is a bootstrap step, run once per machine.

```bash
pnpm setup
```
> Configures your shell so pnpm's global `bin` directory is on `PATH`. Required on a fresh install; restart the shell afterwards.

### How the version gets pinned

pnpm 11 manages its own version. Once the root `package.json` declares `devEngines.packageManager` (added in [03](03-workspace-and-catalogs.md)), any pnpm invocation in the repo downloads and runs the pinned version, whatever is on your `PATH`. The resolved version is recorded in `pnpm-lock.yaml`, so every developer and every CI runner uses the same one.

This is what Corepack used to do, and it is the reason its removal from Node 25+ costs you nothing.

---

## Step 1.3 — Verify

```bash
node -v
pnpm -v
docker -v
git --version
```

Expect `v24.x` and pnpm `11.x`. If Node is 20, 22, or an odd-numbered line, stop and fix it — `engineStrict` in the next document will refuse to install otherwise, which is the correct behaviour but produces a confusing first experience.

```bash
docker compose version
```
> Must be Compose **v2** (`docker compose`, two words). The v1 `docker-compose` binary is end-of-life and its healthcheck semantics differ.

---

## Step 1.4 — Git configuration

Run these on **every** machine, regardless of OS. Two of them only matter on Windows, but setting them everywhere costs nothing and means one instruction rather than two.

```bash
git config --global core.autocrlf input
```
> Stops Git rewriting line endings to CRLF on checkout. Without it, a Windows commit shows every line of every file as modified and code review becomes impossible. Paired with `.gitattributes` in [02](02-repo-skeleton.md) and `endOfLine: "lf"` in Prettier in [05](05-lint-and-format.md) — all three are needed.

### Windows only

```powershell
git config --global core.longpaths true
```
> Windows caps paths at 260 characters. pnpm's content-addressable store plus nested workspace packages exceeds that. Skipping this produces `EPERM` and `ENOENT` errors during install that look like disk corruption.

Also:

- **Clone shallow in the filesystem.** `C:\dev\ratchet`, never under `Documents` or OneDrive. You are spending path budget before the first `node_modules`.
- **Run Docker Desktop with the WSL2 backend** (Settings → General). The Hyper-V backend has slow bind mounts and Postgres healthchecks that flake.
- **Building the Tauri desktop app additionally needs a Rust toolchain and platform WebView libraries** — see [30](30-desktop-app.md) Step 30.1. Deliberately not listed above: only whoever builds `apps/desktop` needs it, and requiring Rust of every web developer would be a tax for nothing.
- **Run commands from PowerShell or Git Bash**, never `cmd.exe`. Husky hooks need the shell Git for Windows ships.

---

## Step 1.5 — Editor

Whatever editor you use, two things need wiring: **Biome as the formatter** and **ESLint for
the architecture rules**. Nothing formats on save until you do this, and nothing formats on
commit until the hooks in [26](26-hygiene-and-ci.md) — until then `pnpm check` is a manual step.

**Do not install a Prettier plugin.** Prettier is not in this stack. Having it installed means
whichever plugin wins the "default formatter" slot decides your formatting, which is exactly the
conflict Biome removed.

### Zed

Commit **`.zed/settings.json`** so the whole team gets the same behaviour:

```json
{
  "format_on_save": "on",
  "formatter": { "language_server": { "name": "biome" } },
  "code_actions_on_format": {
    "source.fixAll.biome": true,
    "source.organizeImports.biome": true
  },
  "languages": {
    "Markdown": { "format_on_save": "off" },
    "YAML": { "format_on_save": "off" }
  }
}
```

Install Zed's **Biome** extension first — that is what provides the `biome` language server. It
runs `biome lsp-proxy` against the repo's pinned binary, so the editor and `pnpm check` cannot
disagree.

> [!TIP]
> If you would rather not depend on the extension, Zed can shell out to the CLI instead:
>
> ```json
> "formatter": { "external": {
>   "command": "./node_modules/.bin/biome",
>   "arguments": ["format", "--stdin-file-path", "{buffer_path}"]
> } }
> ```
>
> Verified: stdin formatting honours the project config — it rewrites quotes and wraps at
> `lineWidth: 100`. You lose inline lint diagnostics, which is the main reason to prefer the
> language-server route.

**Markdown and YAML are `format_on_save: "off"` deliberately.** Biome does not support either —
`biome format` on a `.md` file reports `Checked 0 files`. Leaving format-on-save enabled for them
would silently do nothing, or hand them to another plugin that reflows your hand-wrapped prose.

### VS Code

The equivalent, in `.vscode/settings.json`:

```json
{
  "editor.formatOnSave": true,
  "editor.defaultFormatter": "biomejs.biome",
  "editor.codeActionsOnSave": { "source.fixAll.biome": "explicit" },
  "typescript.tsdk": "node_modules/typescript/lib",
  "eslint.useFlatConfig": true
}
```

Set a per-language `editor.defaultFormatter` for `json`, `jsonc`, and `css` as well, or another
extension can claim them. List `esbenp.prettier-vscode` under `unwantedRecommendations` in
`.vscode/extensions.json`.

Set the workspace TypeScript version to the repo's rather than the editor's bundled copy. VS Code: `TypeScript: Select TypeScript Version` → *Use Workspace Version*. Otherwise `verbatimModuleSyntax` and `noUncheckedIndexedAccess` behave differently in the editor than in `pnpm typecheck`.

---

## ✅ Gate

```bash
node -v && pnpm -v && docker compose version && git --version
```

Prints Node 24.x, pnpm 11.x, Compose v2, and Git 2.34+. `docker ps` runs without a permission error.

Do not proceed until this passes.

---

[← Index](00-README.md) · [Repository Skeleton →](02-repo-skeleton.md)
