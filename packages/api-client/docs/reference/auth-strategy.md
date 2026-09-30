---
title: Auth strategy
description: Why the credential seam is an abstract class rather than a config flag, why bearer omits the cookie, and the two-method TokenProvider contract the desktop app depends on.
---

# `AuthStrategy`, `TokenProvider`

```ts
export abstract class AuthStrategy {
  public abstract headers(): Promise<Record<string, string>>;
  public abstract get credentials(): RequestCredentials;
}
```

Two members. This is the entire difference between the web client and the desktop client.

## Why a class and not a flag

`new ApiClient(url, { useBearer: true })` would work today and would be wrong tomorrow. A flag says
*which of the two we already thought of*; a class says *how this host proves identity*, and the third
host — a CLI with a service token, an integration test with a fixed session, a mobile shell — arrives
without touching `ApiClient` at all.

It also puts the two facts that must agree in one place. `credentials` and `headers()` are not
independent: a strategy that sends a bearer token **and** asks for the cookie is a real mistake, and
it is unrepresentable when one object owns both.

## `credentials: "omit"` is a security decision

| | `CookieAuthStrategy` | `BearerAuthStrategy` |
| --- | --- | --- |
| `credentials` | `include` | **`omit`** |

A Tauri webview serves from `tauri://localhost` (`http://tauri.localhost` on Windows), so a cookie
your API set is never sent with its requests — that is *why* the bearer path exists. `omit` then goes
one step further: it stops the browser attaching **any** cookie to **any** origin this client calls.

The failure it prevents is not the API mis-reading a credential; it is a desktop shell calling a
third-party origin and handing it a session cookie the API would not have read anyway.

## No token means no header, not an empty one

```ts
return token ? { authorization: `Bearer ${token}` } : {};
```

Not `Bearer null`, not `Bearer ` with nothing after it. An absent credential has to *look* absent, or
the server answers `401` on a header it should never have received — and the log line says "invalid
token" when the truth is "signed out". The spec pins this.

`headers()` re-reads the provider on **every** request rather than caching the token at construction.
That is what makes `set(null)` take effect immediately: sign-out is one write to the keychain, not a
client that has to be rebuilt.

## `TokenProvider` is two methods, and that is load-bearing

```ts
export abstract class TokenProvider {
  public abstract get(): Promise<string | null>;
  public abstract set(token: string | null): Promise<void>;
}
```

**Both async, deliberately.** Every real implementation is: an OS keychain reached through a Tauri
`invoke`, a mobile keychain, a remote secret store. Only the in-memory test double is synchronous,
and shaping an interface around the one case that does not need it is how you discover later that the
signature was wrong.

**`set(null)` is the clear path, so there are two methods rather than three.**
[30](../../../../docs/setup/30-desktop-app.md) implements exactly this shape against three Rust
commands — `get_session_token`, `set_session_token`, `clear_session_token` — and `set` branches
between the last two. `noImplicitOverride` turns a stale `token()`/`store()`/`clear()` triple into a
compile error rather than a class that silently fails to implement its abstract members.

> [!NOTE]
> **The token never touches `localStorage`.** A webview is still a browser: anything reachable from
> JavaScript is reachable by injected JavaScript. Keeping it behind an `invoke` boundary means an XSS
> in a rendered field can ask for the token once — a smaller blast radius, and a loggable event —
> rather than enumerating it at leisure.

## `RequestCredentials` is restated, not imported

```ts
export type RequestCredentials = "omit" | "same-origin" | "include";
```

It lives in `lib.dom`, which this package deliberately does not load — it has to typecheck in a plain
Node script too. The union is three strings and has not changed since fetch shipped.

This is the same call `SessionResolver` makes in [`application`](../../../application/docs/index.md)
with `RequestHeaders`, and the same one `Uuid` makes in `core` with `crypto`: **name the shape locally
rather than pull a whole lib in to borrow one type.** Structurally identical, so `apps/web` — which
*does* load the DOM lib — passes the real thing with no cast.
