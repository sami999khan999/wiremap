export interface RateLimit {
  readonly limit: number;
  readonly windowSeconds: number;
}

// The procedures that cost someone else something: a mail from the product's domain to
// any address, a paid embedding call, a render of someone's Markdown (`CR.6`).
// ──
// Named, never a default for every path: a limit on everything is a Redis round trip on
// every request, to protect procedures that cost nothing.
const LIMITS: Readonly<Record<string, RateLimit>> = Object.freeze({
  "member.invite": { limit: 30, windowSeconds: 3_600 },
  "member.resendInvitation": { limit: 30, windowSeconds: 3_600 },
  "document.search": { limit: 60, windowSeconds: 60 },
  "document.index": { limit: 30, windowSeconds: 60 },
  // Both run the Markdown renderer on up to 200,000 characters. The editor debounces its
  // preview, so a client past this is not a person typing.
  "docPage.preview": { limit: 120, windowSeconds: 60 },
  // A query per debounced keystroke, each one a full-text and a trigram scan.
  "docPage.search": { limit: 120, windowSeconds: 60 },
  "docPage.publish": { limit: 30, windowSeconds: 60 },
  // Each one is a signed URL for five megabytes of somebody's storage bill.
  "docPage.upload": { limit: 60, windowSeconds: 3_600 },
});

export class RateLimitPolicy {
  private constructor() {}

  // Null for a procedure nobody limits, which is almost all of them.
  public static for(procedure: string): RateLimit | null {
    return LIMITS[procedure] ?? null;
  }

  public static procedures(): readonly string[] {
    return Object.keys(LIMITS);
  }
}
