import type {
  DomainEvent,
  DomainEventName,
  NotificationCategory,
  NotificationChannel,
  NotificationKind,
  NotificationMode,
  PermissionKey,
} from "../import.js";

// Who a notification goes to, as a rule rather than a query. `none` is a real answer:
// `member.invited` has no recipient with an account yet.
export type RecipientRule =
  | { readonly kind: "none" }
  | { readonly kind: "subject" }
  | { readonly kind: "organizationMembers"; readonly holding: PermissionKey }
  // The people in the conversation, minus the author. No permission: membership of the
  // room is the authorization, and everyone in one can already read it.
  | { readonly kind: "conversationMembers" };

export interface PolicyRow {
  readonly kind: NotificationKind;
  readonly category: NotificationCategory;
  readonly recipients: RecipientRule;
  readonly defaultMode: Readonly<Record<NotificationChannel, NotificationMode>>;
  readonly link: (event: DomainEvent) => string | null;
  // What the notification is *about*, when that is narrower than the event. Set, it also
  // means "one unread of this kind about this subject at a time" — see `subjectOf`.
  readonly subject?: (event: DomainEvent) => string | null;
  // Not every event of a name produces one. A message in a channel is the §6 write
  // amplification case, and it produces nothing until a mention feature exists.
  readonly when?: (event: DomainEvent) => boolean;
}

// A frozen table, one row per event that produces a notification. An event absent from
// it produces none, which is how most events behave and is not a gap.
const ROWS = Object.freeze({
  // Nobody: the invitee has no account, so there is no inbox to write to. The invitation
  // mail is the notification, and it is already sent.
  "member.invited": {
    kind: "member.joined",
    category: "membership",
    recipients: { kind: "none" },
    defaultMode: { in_app: "off", email: "off" },
    link: () => null,
  },
  "member.joined": {
    kind: "member.joined",
    category: "membership",
    // The people who can act on it. Not the whole organization: that is the write
    // amplification `data-and-scale.md` §6 warns about, per joiner.
    recipients: { kind: "organizationMembers", holding: "member.invite" },
    defaultMode: { in_app: "immediate", email: "digest" },
    link: () => "/settings/members",
  },
  "member.role.changed": {
    kind: "member.role.changed",
    category: "membership",
    // The person it happened to. What they may do just changed, which is the one thing
    // they cannot discover by looking.
    recipients: { kind: "subject" },
    defaultMode: { in_app: "immediate", email: "immediate" },
    link: () => "/settings/members",
  },
  "message.sent": {
    kind: "message.received",
    category: "messaging",
    recipients: { kind: "conversationMembers" },
    // In-app at once, email once a day. A DM is worth interrupting a screen for and is
    // almost never worth interrupting an inbox for.
    defaultMode: { in_app: "immediate", email: "digest" },
    link: (event) =>
      "conversationId" in event.payload ? `/messages/${event.payload.conversationId}` : null,
    // One unread bell item per conversation. Without this a burst of ten messages is ten
    // rows, ten frames and ten digest lines for one thing the reader already knows about.
    subject: (event) => ("conversationId" in event.payload ? event.payload.conversationId : null),
    // Direct only. A busy channel notifying every member per message is the write
    // amplification `data-and-scale.md` §6 exists to warn about.
    when: (event) =>
      "conversationKind" in event.payload && event.payload.conversationKind === "direct",
  },
} as const satisfies Partial<Record<DomainEventName, PolicyRow>>);

const NAMES: readonly DomainEventName[] = Object.freeze(Object.keys(ROWS) as DomainEventName[]);

// How intrusive a mode is, most first. Where two kinds of one category disagree, the
// screen shows the strongest: under-promising is the half a reader cannot discover.
const LOUDNESS: readonly NotificationMode[] = Object.freeze(["immediate", "digest", "off"]);

// Keyed by category for the preferences screen, whose toggle is per category. Same rows
// as delivery reads, so the screen and delivery cannot disagree about which ones count.
const DEFAULT_BY_CATEGORY: Readonly<
  Record<string, Readonly<Record<NotificationChannel, NotificationMode>>>
> = Object.freeze(
  Object.values(ROWS as Record<string, PolicyRow>)
    .filter((row) => row.recipients.kind !== "none")
    .reduce<Record<string, Record<NotificationChannel, NotificationMode>>>((found, row) => {
      const current = found[row.category];
      if (!current) {
        found[row.category] = { ...row.defaultMode };
        return found;
      }

      for (const channel of ["in_app", "email"] as const) {
        const mine = LOUDNESS.indexOf(row.defaultMode[channel]);
        if (mine < LOUDNESS.indexOf(current[channel])) current[channel] = row.defaultMode[channel];
      }

      return found;
    }, {}),
);

// Keyed by kind, and built only from the rows that actually write one: a row with no
// recipients describes no notification in the table, so its modes are not a default.
const DEFAULT_BY_KIND: Readonly<
  Record<string, Readonly<Record<NotificationChannel, NotificationMode>>>
> = Object.freeze(
  Object.fromEntries(
    Object.values(ROWS as Record<string, PolicyRow>)
      .filter((row) => row.recipients.kind !== "none")
      .map((row) => [row.kind, row.defaultMode]),
  ),
);

// The one place that decides what an event means to a person. A `Policy` rather than a
// use-case because it is a domain rule too broad for one entity.
export class NotificationPolicy {
  private constructor() {}

  // Every event this policy has an opinion about, which is exactly what the subscriber
  // subscribes to — so a row added here is delivered with no second edit.
  public static events(): readonly DomainEventName[] {
    return NAMES;
  }

  public static rowFor(name: DomainEventName): PolicyRow | null {
    return Object.hasOwn(ROWS, name) ? ((ROWS as Record<string, PolicyRow>)[name] ?? null) : null;
  }

  public static defaultMode(name: DomainEventName, channel: NotificationChannel): NotificationMode {
    return NotificationPolicy.rowFor(name)?.defaultMode[channel] ?? "off";
  }

  // What the preferences screen shows for a category nobody has saved. `member.invited`
  // is `off/off` and comes first, so the first-row reading said membership was off.
  public static defaultModeForCategory(
    category: NotificationCategory,
    channel: NotificationChannel,
  ): NotificationMode {
    return DEFAULT_BY_CATEGORY[category]?.[channel] ?? "off";
  }

  // What a stored preference falls back to, for a row already written. Keyed by kind
  // rather than category: `membership` holds one kind on digest and one on immediate.
  public static defaultModeForKind(
    kind: NotificationKind,
    channel: NotificationChannel,
  ): NotificationMode {
    return DEFAULT_BY_KIND[kind]?.[channel] ?? "off";
  }

  // Absent `when` means every event of the name produces one, which is the common case
  // and reads better than a `when: () => true` on three rows out of four.
  public static applies(event: DomainEvent): boolean {
    return NotificationPolicy.rowFor(event.name)?.when?.(event) ?? true;
  }

  // Null means "no narrower subject", and the delivery is then deduped on the event
  // alone — the behaviour every row but the messaging one wants.
  public static subjectOf(event: DomainEvent): string | null {
    return NotificationPolicy.rowFor(event.name)?.subject?.(event) ?? null;
  }
}
