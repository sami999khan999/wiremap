# 30 · `apps/desktop` — Tauri

> Read last, because it depends on every package above it. A Rust shell around a webview that mounts the same `feature` and `ui` packages the web app does, and reaches the server as a plain HTTP client.

**Delivers:** A desktop application that adds one app directory and zero packages.

**Prerequisite:** [29 · Naming and boundaries](29-naming-and-boundaries.md)

> [!IMPORTANT]
> **This document is a plan. `apps/desktop` does not exist in this repository.** Every other page in
> `docs/setup/` describes something you can open; this one describes something you would build, and
> it is kept because the decisions in it are already load-bearing on the pages before it. Read it as
> the specification for a directory, not as a description of one.
>
> **What is real today** is everything the shell would need and nothing it would contain: the
> abstract `TokenProvider` and `BearerAuthStrategy` in
> [`api-client`](../../packages/api-client/docs/index.md), the `surface` column on `sessions`
> ([16](16-auth-package.md)), the shared route table in [08](08-permissions-package.md), and every
> `feature` and `ui` component being framework-shaped rather than router-shaped. None of it is
> speculative structure: each earns its place on the web app's own terms, and the desktop shell is
> what would make the seams visible.
>
> **What is not real:** there is no `apps/desktop` glob in the Biome or ESLint server-only overrides
> ([05](05-lint-and-format.md)), no `AUTH_DESKTOP_SESSION_MAX_AGE_SECONDS` in either `env.ts`, and no
> desktop workflow in CI. Each is one line, added the day the directory appears. A glob matching
> nothing and an env key nothing reads are not preparation — they are a rule a reader cannot verify
> and a required value nobody can explain.

> [!NOTE]
> **Tauri is the shell this plan assumes — decided, not surveyed.** Earlier documents are written on that basis rather than hedging against it: the bearer plugin and both Tauri origins are configured on day one in [16](16-auth-package.md) and [24](24-web-app.md), and the shared route table in [08](08-permissions-package.md) exists partly so two shells cannot disagree about a path. Nothing in this document modifies work from an earlier one.

---

## What Tauri changes, and what it doesn't

Every "the desktop app will…" note scattered through the earlier documents assumed exactly one thing: **the desktop client is a remote HTTP client, not a second server.** That holds under Tauri, and Tauri makes it hold *harder* than Electron would have.

| | Electron | Tauri |
|---|---|---|
| Native half | Node main process | Rust crate (`src-tauri/`) |
| JS runtimes | two (main + renderer) | **one** (the webview) |
| Web engine | bundled Chromium | the OS webview |
| Bundle size | ~120 MB | ~5–10 MB |
| Secret storage | whatever you build | OS keychain via a plugin |
| `process.env` at runtime | available | **does not exist** |

**The single-runtime difference is the one with architectural consequences.** Under Electron there was a Node process where `@loadbearing/api-client` could run headless — an offline sync queue, a background poller. Under Tauri there is no such place: JavaScript runs in the webview and nowhere else. Anything genuinely background-and-native is Rust, not TypeScript.

That is why the "must load in Electron's main process" justification for keeping `api-client` React-free has been rewritten throughout. The rule survives — scripts, tests, and CLIs still need it — but the desktop app is no longer the reason for it.

**Three rules that do not change:**

- The desktop app imports `feature`, `ui`, `query`, `api-client`, `content`, `permissions`, `contracts`, `asset`. It imports **none** of `infrastructure`, `auth`, `composition`, `application`.
- `CapabilitySet.can()` is the same class, resolved from the same server, giving the same answers.
- The contract is the contract. A desktop build talking to a newer server fails at the type level, not at runtime.

---

## Step 30.1 — Prerequisites

Only needed by whoever builds the desktop app; the web and worker developers need none of this.

```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
rustup default stable
```

Platform toolchains on top:

| Platform | Needs |
|---|---|
| Windows | Microsoft C++ Build Tools; WebView2 (preinstalled on Windows 11) |
| macOS | Xcode Command Line Tools |
| Linux | `webkit2gtk-4.1`, `libayatana-appindicator3`, `librsvg2`, `build-essential` |

> Check the current [Tauri prerequisites page](https://tauri.app/start/prerequisites/) against the version you pin. The Linux package list in particular changes between major versions, and a wrong `webkit2gtk` major produces a link error that reads like a missing crate.

---

## Step 30.2 — Scaffold

```bash
cd apps
pnpm create tauri-app@latest desktop --template react-ts --manager pnpm
cd desktop
node -e "require('fs').rmSync('.git', { recursive: true, force: true })"
cd ../..
```

Set `"name": "@loadbearing/desktop"`, then:

```bash
pnpm add --filter @loadbearing/desktop \
  @loadbearing/contracts@workspace:* @loadbearing/permissions@workspace:* \
  @loadbearing/api-client@workspace:* @loadbearing/query@workspace:* \
  @loadbearing/content@workspace:* @loadbearing/ui@workspace:* \
  @loadbearing/feature@workspace:* @loadbearing/asset@workspace:* \
  @tauri-apps/api@catalog: @tanstack/react-router@catalog: @tanstack/react-query@catalog:
pnpm add --filter @loadbearing/desktop -D @tauri-apps/cli@catalog: vite @vitejs/plugin-react
```

`catalog:` for all three, same as everywhere else — `apps/desktop` is not an exception to the rule that one file owns every version ([03](03-workspace-and-catalogs.md)). `@tanstack/react-router` matters most: `apps/web` gets it transitively through TanStack Start, so without a catalog entry the two shells can resolve different router versions while sharing the same `feature` components.

**Note what is absent.** No `composition`, no `application`, no `infrastructure`, no `auth`, no `@orpc/server`. The desktop app has no container and constructs no adapters — it is a client. The **Biome** server-only boundary from [05](05-lint-and-format.md) Step 5.2 lists `apps/desktop/src/**` in the same override as `apps/web/src/**`, and here it has **no escape hatch at all** — unlike `apps/web` there is no `src/server/**` inside a Tauri bundle to exempt.

```
apps/desktop/
├── package.json
├── vite.config.ts
├── src-tauri/                  ← the Rust half
│   ├── Cargo.toml
│   ├── tauri.conf.json
│   └── src/
│       ├── main.rs
│       └── token.rs            ← keychain commands
└── src/
    ├── config.ts               → Config  (import.meta.env, NOT process.env)
    ├── token-provider.ts       → TauriTokenProvider
    ├── messages.ts             → the MessageStore  (every locale, synchronous)
    ├── api.ts                  → the ApiClient + QueryClient singletons
    ├── router.tsx              ← memory or hash history
    └── route/
```

---

## Step 30.3 — Configuration without `process.env`

There is no Node runtime in the webview, so `process.env` does not exist. This is a feature: the "exactly two `process.env` readers" assertion in [26](26-hygiene-and-ci.md) needs no new exemption, and the desktop app cannot accidentally read a server secret because it has no mechanism to.

```ts
// apps/desktop/src/config.ts
export class Config {
  private constructor() {}

  public static get apiUrl(): string {
    const url = import.meta.env.VITE_API_URL;
    if (!url) throw new Error("VITE_API_URL is not set");
    return url;
  }
}
```

**Anything in `import.meta.env` is baked into the shipped bundle and readable by anyone who unzips the app.** API base URLs and feature flags are fine. Never a secret. If the desktop app needs a value that must stay hidden, it belongs on the Rust side or, better, behind an API call.

---

## Step 30.4 — The token provider

This is the whole integration, and `TokenProvider` from [18](18-api-client-package.md) was made abstract for exactly this.

```ts
// apps/desktop/src/token-provider.ts
import { invoke } from "@tauri-apps/api/core";
import { TokenProvider } from "@loadbearing/api-client";

export class TauriTokenProvider extends TokenProvider {
  public override async get(): Promise<string | null> {
    return invoke<string | null>("get_session_token");
  }

  public override async set(token: string | null): Promise<void> {
    if (token === null) {
      await invoke("clear_session_token");
      return;
    }
    await invoke("set_session_token", { token });
  }
}
```

The Rust side implements those three commands against the OS keychain (`keyring` crate, or `tauri-plugin-stronghold` if you want an encrypted vault rather than the system store).

> [!NOTE]
> The method names must match the abstract class in [18](18-api-client-package.md) exactly — `get()` and `set(token: string | null)`, two methods, not three. `set(null)` is the clear path, which is why the Rust side still needs all three commands. `noImplicitOverride` turns any mismatch into a compile error, so a stale `token()` / `store()` / `clear()` triple fails the build rather than silently leaving the abstract methods unimplemented.

**The token never touches `localStorage` and never sits in a JS variable longer than one request.** A webview is still a browser: anything reachable from JavaScript is reachable by injected JavaScript. Keeping the token behind an `invoke` boundary means an XSS in a rendered field cannot enumerate it — it can only ask for it once, which is a smaller blast radius and a loggable event.

Then, at startup:

```ts
const client = ApiClient.overHttp(
  Config.apiUrl,
  new BearerAuthStrategy(new TauriTokenProvider()),
);
```

That is the entire difference between the desktop client and the browser client. `query`, `feature`, and `ui` are byte-identical.

---

## Step 30.5 — Server-side: verify, do not change

Nothing to build here. Because Tauri is settled rather than speculative, `apps/web` already ships what the desktop client needs — confirm all three and move on:

| Check | Where it was built |
| --- | --- |
| `AUTH_TRUSTED_ORIGINS` contains `tauri://localhost` **and** `http://tauri.localhost` | [24](24-web-app.md) Step 24.2, and `.env.example` |
| CORS allows those origins on `/api/rpc` and `/api/auth`, with `authorization` in `Allow-Headers` | [24](24-web-app.md) Step 24.7 |
| The bearer plugin is enabled | [16](16-auth-package.md) Step 16.2 |

```bash
curl -i -X OPTIONS http://localhost:43000/api/rpc \
  -H "Origin: tauri://localhost" \
  -H "Access-Control-Request-Method: POST" \
  -H "Access-Control-Request-Headers: content-type,authorization"
```

A `204` carrying `Access-Control-Allow-Origin: tauri://localhost` means the desktop client will connect. A `204` with no such header means the origin is missing from the allowlist — the request is not rejected outright, which is exactly why this fails as a silent browser-level block rather than a server error worth reading.

**That this step builds nothing is the point.** Had the API been cookie-only and same-origin, arriving here would mean revisiting every endpoint, guard, and test.

---

## Step 30.6 — Routing and the CSP

**Use memory or hash history, not browser history.** The webview serves from a custom protocol with no server behind it, so a path-based route on a cold start has nothing to resolve. This is the "routing is the one thing the desktop shell replaces" note from [21](21-query-package.md) becoming concrete: `apps/desktop` owns its own `@tanstack/react-router` instance and its own route tree, and mounts the same `feature` components underneath.

**Its own route tree, but not its own paths.** Destinations come from `ROUTES` in `@loadbearing/permissions` ([08](08-permissions-package.md)), the same table `apps/web` links against and `GATES` points into:

```tsx
import { ROUTES } from "@loadbearing/permissions";

<Link to={ROUTES.rbac.members}>Members</Link>
```

**Keeping the path strings identical to web's is an invariant, not a coincidence.** History mode changes how a path is *serialised* — `#/settings/members` under hash history — never what it is *called*. Holding that invariant is what lets a `<Link>` inside a `feature` component be correct in both shells with no branching and no prop threading, which is most of what makes this document one directory long.

The table is hand-written, so it can lie: rename a route file and the table still names the old path. One line, typed against this app's generated tree, closes that:

```ts
// apps/desktop/src/route/-nav-routes.ts — nobody reads this, it only has to compile
const _routesExist: Readonly<Record<AppRoute, true>> = /* built from routeTree */;
```

If a screen genuinely has to live somewhere else here, override only the keys that differ rather than forking the table — and know the cost: an overridden screen can no longer name `ROUTES.x` inside `feature`, so its path has to arrive as a prop. That is the "navigation arrives as a prop" rule earning its keep, and a good reason to avoid diverging unless a screen truly must move. Full detail in [`routes.md`](../../packages/permissions/docs/reference/routes.md).

**Tauri ships a restrictive CSP by default and you should keep it.** Add your API origin to `connect-src` in `tauri.conf.json` and nothing else. Widening it to `*` to make a fetch work discards the main security advantage of the platform.

---

## Step 30.7 — Copy, offline, in the OS locale

`apps/web` takes one locale per request because it has a server that knows the locale before the
first byte. Desktop has no server, does not learn the locale until the process starts, and has
to work with no network at all. So it takes the opposite answer.

**`apps/desktop/src/messages.ts`**

```ts
import { BundledContentSource, Locales, MessageStore } from "@loadbearing/content";

const content = new BundledContentSource();
const locale = Locales.negotiate(navigator.language, localStorage.getItem("locale"));

// Synchronous: no await before first render, no chunk fetch, no network.
export const messages = new MessageStore(content, content.snapshotSync(locale));
```

**Taking the whole catalog is the correct answer here, not a concession.** Every trade that made
narrowing right for the web points the other way on desktop: the bundle is downloaded once at
install rather than per visit, the app must render correctly with the network off, and switching
language should be instant rather than a loading state. Set against the 5–10 MB figure earlier in
this doc, a few kilobytes of copy per locale is not a number anyone will measure.

**This is why the narrowing lives in the app and not in the package.** `packages/content` ships
every locale to everyone and lets each shell decide ([20](20-content-package.md)). Had the split
been built into the package — trimming locales at its own boundary — this app could not exist in
its current form, and `content` would not be on its dependency list at all.

**`navigator.language` is the webview reporting the OS locale**, and it is available
synchronously, which is what keeps `snapshotSync` synchronous. `@tauri-apps/plugin-os`'s
`locale()` is more faithful on Linux and is async; if you switch, you await once at bootstrap
and `MessageStore` takes the snapshot in its constructor either way.

**`content` never touches `navigator`.** The string is passed in. That is what keeps the package
DOM-free and testable in Node — the same rule that keeps it React-free for the worker.

**No `email`.** `BundledContentSource` carries the client namespaces only, and `ClientNamespace`
excludes `email` at the type level. The `SERVER_CATALOG` ban in [05](05-lint-and-format.md)
Step 5.3 covers `apps/desktop/src/**` as the second lock.

### If a mobile shell follows

Two paths, and they differ only in the bundler.

**Tauri 2 targets iOS and Android from this same webview bundle**, so `src/messages.ts` is
already the mobile answer with nothing changed.

**React Native or Expo** has no Vite, and Metro's `import()` handling is configuration-dependent
— but it does not matter here, because mobile wants exactly what desktop wants: every locale,
static, offline, locale from the OS (`expo-localization`, or
`Intl.DateTimeFormat().resolvedOptions().locale`, into the same `Locales.negotiate`).
`BundledContentSource` covers both.

**A mobile shell needs no change to `packages/content`.** That is the test of whether the split
was put at the right layer, and it is worth re-running against any future runtime: if adding a
shell means editing the content package, the narrowing has drifted downward into it.

---

## Step 30.8 — CI

Desktop builds do **not** belong in the `verify` job — they need three runners and several minutes each. Give them a separate workflow, triggered on tags:

```yaml
strategy:
  matrix:
    platform: [macos-latest, ubuntu-22.04, windows-latest]
```

Use `tauri-apps/tauri-action` for the build and release, `Swatinem/rust-cache` for the Cargo cache, and pin `ubuntu-22.04` rather than `ubuntu-latest` — glibc in the build image sets the floor for which Linux distributions can run your binary, and `latest` silently raising it is a support ticket you will not enjoy.

The `verify` job still covers everything that matters here: the desktop app's TypeScript is typechecked and linted by the same `pnpm typecheck` and `pnpm lint` as everything else ([26](26-hygiene-and-ci.md)). What it does **not** do is compile the Rust half or produce a bundle — a broken `main.rs` reaches you at tag time, not at merge time. That is the trade for keeping `verify` fast, and it is worth knowing rather than discovering.

---

## What this cost

One app directory. No new packages, no changed packages, no changed contracts, no changed permissions, and one line added to a server-side allowlist.

That is the return on every "no `@tanstack/react-router` here" and "navigation arrives as a prop" rule you followed in Phase D. Those rules looked like ceremony while writing them. This is the step where they pay.

---

## ✅ Gate

- `pnpm --filter @loadbearing/desktop tauri dev` opens a window rendering the same sign-in screen as the web app.
- Signing in stores a token in the OS keychain and **not** in `localStorage` (check devtools).
- A gated feature is hidden in the desktop UI and returns `FORBIDDEN` from the API, from the same role change — no desktop-specific permission code.
- The built bundle contains no Drizzle, no ioredis, no AWS SDK.
- Removing the Tauri origins from `AUTH_TRUSTED_ORIGINS` breaks sign-in, proving the allowlist is actually enforced.

---

[← Naming & Boundaries](29-naming-and-boundaries.md) · [Back to the index](00-README.md)
