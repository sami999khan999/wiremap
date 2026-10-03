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
  // A model call paid with the organization's own key; the use-case caps the organization
  // per day as well.
  "ask.question": { limit: 20, windowSeconds: 3_600 },
  "ask.testKey": { limit: 10, windowSeconds: 3_600 },
  // Each upload is a signed URL into storage, and each scan is GitHub Actions minutes.
  "scan.createUpload": { limit: 60, windowSeconds: 3_600 },
  "scan.run": { limit: 30, windowSeconds: 3_600 },
  // A request from our network to an address someone typed, and its status read back.
  "webhook.test": { limit: 20, windowSeconds: 3_600 },
  // A mention is a mail; a burst of comments naming everyone is a burst of mail.
  "comment.create": { limit: 120, windowSeconds: 3_600 },
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
