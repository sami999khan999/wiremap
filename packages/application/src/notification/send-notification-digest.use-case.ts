import type { NotificationCategory, OrganizationId, UserId } from "../import.js";
import type { MailPublisher, OrganizationReader } from "../port/index.js";
import type { Principal } from "../primitive/index.js";
import { NotificationPolicy } from "./notification.policy.js";
import type { NotificationRecord, NotificationRepository } from "./notification.repository.js";
import type { NotificationPreferenceRepository } from "./notification-preference.repository.js";
import type { NotificationRecipientReader } from "./notification-recipient.reader.js";

export interface SendNotificationDigestInput {
  readonly organizationId: OrganizationId;
  // The ISO day the digest covers, which is also half its dedupe key. From the job
  // rather than the clock, so a retried job sends the same day's digest.
  readonly day: string;
}

// A page of recipients per round. Keyset rather than offset for the reason every list
// here uses it: the page after the ten-thousandth costs the same as the first.
const PAGE = 200;

// Enough to say "and 47 more". Rendering every row would be a second layout to keep
// translated, and the digest links to the inbox.
const SAMPLE = 100;

const DAY_MS = 24 * 60 * 60 * 1000;

// The categories a preference can be stored against. Read per page rather than per
// person, so the page costs one query each instead of one per recipient.
const CATEGORIES: readonly NotificationCategory[] = Object.freeze(["membership", "messaging"]);

const storedKey = (userId: UserId, category: NotificationCategory) => `${userId}:${category}`;

export class SendNotificationDigestUseCase {
  public constructor(
    private readonly notifications: NotificationRepository,
    private readonly preferences: NotificationPreferenceRepository,
    private readonly recipients: NotificationRecipientReader,
    private readonly mail: MailPublisher,
    private readonly organizations: OrganizationReader,
  ) {}

  public async execute(actor: Principal, input: SendNotificationDigestInput): Promise<void> {
    // The day before `day`, half-open: a row created at midnight is in exactly one digest.
    const until = new Date(`${input.day}T00:00:00.000Z`);
    const since = new Date(until.getTime() - DAY_MS);
    // Once per run, not per recipient. The footer reads "you belong to {organization}",
    // and the id is what a person saw there before this.
    const organization = (await this.organizations.nameOf(input.organizationId)) ?? "";
    let after: UserId | null = null;

    // Paged, because a digest over a large tenant is the one job here whose recipient
    // list does not fit in memory and whose failure mode is silent truncation.
    for (;;) {
      const page = await this.notifications.recipientsWithUnreadBetween(
        input.organizationId,
        since,
        until,
        PAGE,
        after,
      );
      if (page.length === 0) break;

      await this.sendTo(input, page, { since, until }, organization);

      after = page.at(-1) ?? null;
      if (page.length < PAGE) break;
    }

    void actor;
  }

  // Four queries and one enqueue for the page, whatever its size: the addresses, the
  // stored modes, and every person's unread rows at once.
  private async sendTo(
    input: SendNotificationDigestInput,
    userIds: readonly UserId[],
    window: { readonly since: Date; readonly until: Date },
    organization: string,
  ): Promise<void> {
    const people = await this.recipients.users(input.organizationId, userIds);
    const stored = await this.storedModes(input.organizationId, userIds);
    const unread = await this.notifications.listUnreadBetween(
      input.organizationId,
      userIds,
      window.since,
      window.until,
      SAMPLE,
    );

    const mails = people.flatMap((person) => {
      // The candidate list is everyone with unread rows, so this is where the reader's
      // own answer is applied — stored if they set one, the policy's default if not.
      const digestable = SendNotificationDigestUseCase.forDigest(
        stored,
        person.userId,
        unread.get(person.userId) ?? [],
      );

      // Nothing to say. A daily message reading "you have 0 notifications" is how a
      // digest gets filtered, and a row already emailed immediately is not news.
      if (digestable.length === 0) return [];

      return [
        {
          template: "notification.digest" as const,
          to: person.email,
          locale: person.locale,
          params: {
            count: digestable.length,
            name: person.name,
            organization,
            url: "/notifications",
          },
          organizationId: input.organizationId,
          userId: person.userId,
          // Organization, person and day. A redelivered job produces the same key, so a
          // retry sends one message rather than a second copy of the same morning.
          dedupeKey: `digest_${input.organizationId}_${person.userId}_${input.day}`,
        },
      ];
    });

    if (mails.length > 0) await this.mail.publishMany(mails);
  }

  // One query per category for the whole page. `findFor` takes many users and one
  // category, which is what keeps this two round trips rather than two per person.
  private async storedModes(
    organizationId: OrganizationId,
    userIds: readonly UserId[],
  ): Promise<ReadonlyMap<string, string>> {
    const modes = new Map<string, string>();

    for (const category of CATEGORIES) {
      const rows = await this.preferences.findFor(organizationId, userIds, category);
      for (const row of rows) {
        if (row.channel !== "email") continue;
        modes.set(storedKey(row.userId, row.category), row.mode);
      }
    }

    return modes;
  }

  // The rows that earned the digest, not every unread row. A reader with one category on
  // `immediate` was counted its items too, which they had already been emailed.
  private static forDigest(
    stored: ReadonlyMap<string, string>,
    userId: UserId,
    unread: readonly NotificationRecord[],
  ): readonly NotificationRecord[] {
    return unread.filter((row) => {
      const mode =
        stored.get(storedKey(userId, row.category)) ??
        NotificationPolicy.defaultModeForKind(row.kind, "email");

      return mode === "digest";
    });
  }
}
