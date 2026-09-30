const EMBEDDING = "embedding";
const NOTIFICATION = "notification";
const MAINTENANCE = "maintenance";
const MAIL = "mail";
const EVENT = "event";

// Frozen at module load rather than left as a `static readonly`: the keyword freezes the
// binding and not the array, which is the shape `docs/ai/rules/classes.md` bans.
const ALL = Object.freeze([EMBEDDING, NOTIFICATION, MAINTENANCE, MAIL, EVENT] as const);

// A handful of queues by concern, not one per job type. A queue is a concurrency
// and priority boundary: embedding is slow and rate-limited, notifications bursty.
export class QueueName {
  private constructor() {}

  public static readonly EMBEDDING = EMBEDDING;
  public static readonly NOTIFICATION = NOTIFICATION;
  // Its own concern because it is allowed to fall behind: nobody waits on a runway
  // partition or a sweep, so it must never queue ahead of mail.
  public static readonly MAINTENANCE = MAINTENANCE;
  // Its own concern because a provider's rate limit is a property of this queue and of
  // nothing else: one limiter here beats a sleep in every caller.
  public static readonly MAIL = MAIL;
  // The outbox drain and the deliveries it fans out to. Its own concern because the
  // drain must not queue behind the deliveries it just created.
  public static readonly EVENT = EVENT;

  public static readonly ALL = ALL;
}
