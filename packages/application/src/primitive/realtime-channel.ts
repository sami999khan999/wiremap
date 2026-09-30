declare const brand: unique symbol;

// Branded so a channel cannot be assembled by string concatenation at a call site, which
// is how one ends up without its tenant prefix.
export type RealtimeChannel = string & { readonly [brand]: "RealtimeChannel" };

// Tenant-leading, always. Sharded pub/sub, Redis Streams and a broker partitioner can all
// key on a prefix, and none of them can key on something buried in the middle.
export class RealtimeChannels {
  private constructor() {}

  // One per signed-in user, and authorised by construction: you only ever receive your
  // own, so the stream needs no per-frame permission check.
  public static user(organizationId: string, userId: string): RealtimeChannel {
    return `org:${organizationId}:user:${userId}` as RealtimeChannel;
  }

  // The per-user stream cap counts only these. A shared channel, once one exists, has
  // many readers, and counting it the same way would cap the room rather than the person.
  public static isUser(channel: RealtimeChannel): boolean {
    return /^org:[^:]+:user:[^:]+$/.test(channel);
  }
}
