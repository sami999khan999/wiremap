---
title: token
description: Token — an opaque random string and the digest of one, in core because both application and infrastructure need it and neither can reach auth.
---

# `Token`

```ts
export class Token {
  public static random(bytes = 32): string;
  public static hash(value: string): Promise<string>;
}
```

Two static methods and no instances. `random()` returns hex over `bytes` of CSPRNG output;
`hash()` returns the SHA-256 of a string, also hex.

## Why it is in `core` and not beside `ApiKeyHasher`

`ApiKeyHasher` in [`auth`](../../../auth/docs/index.md) does the same digest for API keys, and for
a while it was the only place that could. Then invitations needed it on both sides of the boundary:
`InviteMemberUseCase` in `application` hashes before saving, and `PgInvitationClaimer` in
`infrastructure` hashes before looking up. Neither package can import `auth` — it sits to their
right in [Layering](../../../../docs/ai/rules/layering.md) — so the primitive moved down to the one
place both can reach.

That is the test for anything in this package: not "is it small" but "does more than one layer need
it, with no seam between them where a fake could go".

## The pairing is the point

**`random()` goes to the recipient; `hash()` goes to the table.** An invitation token is a bearer
string — combined with a verified mailbox it joins someone to a tenant — so `invitations.token_hash`
stores the digest and the plaintext exists only in the mail that was sent and the URL its recipient
holds. A dump of that table carries nothing anyone can accept with.

`api_keys.token_hash` had been doing exactly this two files over, which is what made `invitations`
the odd one out rather than a judgement call.

## Both globals are read off `globalThis`

```ts
type WebCrypto = {
  getRandomValues<T extends ArrayBufferView>(array: T): T;
  subtle: { digest(algorithm: string, data: Uint8Array): Promise<ArrayBuffer> };
};
```

`lib: ["ES2024"]` declares neither `crypto` nor `TextEncoder`, and adding a DOM or Node lib to
borrow one method would bind this package to a runtime it has to load in all of. Same reasoning,
and same shape, as [uuid](uuid.md#why-crypto-is-not-a-global-here).

`subtle.digest` is the reason `hash()` is `async` while `random()` is not. It is Web Crypto's only
digest API, it returns a promise everywhere, and the alternative is a synchronous SHA-256 written
by hand — which is a dependency or a bug, and this package takes neither.
