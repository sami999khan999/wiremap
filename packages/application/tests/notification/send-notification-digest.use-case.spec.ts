import { Identifiers } from "@loadbearing/contracts";
import { CapabilitySet } from "@loadbearing/permissions";
import { describe, expect, it } from "vitest";
import type {
  NotificationRecord,
  NotificationRepository,
} from "../../src/notification/notification.repository.js";
import type {
  NotificationPreferenceRepository,
  PreferenceRecord,
} from "../../src/notification/notification-preference.repository.js";
import type {
  NotificationRecipientReader,
  Recipient,
} from "../../src/notification/notification-recipient.reader.js";
import { SendNotificationDigestUseCase } from "../../src/notification/send-notification-digest.use-case.js";
import type { MailPublisher, MailRequest, OrganizationReader } from "../../src/port/index.js";
import { Principal } from "../../src/primitive/index.js";

const ORG = Identifiers.organizationId.parse("018f8c00-0000-7000-8000-000000000010");
const USER = Identifiers.userId.parse("018f8c00-0000-7000-8000-000000000011");
const DAY = "2026-09-20";

const ACTOR = new Principal(
  ORG,
  USER,
  CapabilitySet.from({ wildcard: false, org: { grants: [], denies: [] }, goals: {} }),
);

// `message.received` defaults to `email: "digest"`, which is the case this file is
// about: nobody has to store a row for the daily mail to be the right behaviour.
const unread = (kind: NotificationRecord["kind"], category: NotificationRecord["category"]) =>
  ({
    id: Identifiers.notificationId.parse("018f8c00-0000-7000-8000-0000000000f1"),
    kind,
    category,
    params: {},
    link: null,
    readAt: null,
    createdAt: new Date("2026-09-20T09:00:00.000Z"),
  }) satisfies NotificationRecord;

class Notifications implements NotificationRepository {
  public constructor(private readonly rows: readonly NotificationRecord[]) {}

  public list(): Promise<never> {
    throw new Error("not used");
  }

  public countUnread(): Promise<number> {
    return Promise.resolve(0);
  }

  public saveMany(): Promise<readonly (typeof USER)[]> {
    return Promise.resolve([]);
  }

  public unreadSubjectHolders(): Promise<ReadonlySet<never>> {
    return Promise.resolve(new Set());
  }

  public markRead(): Promise<void> {
    return Promise.resolve();
  }

  public markAllRead(): Promise<void> {
    return Promise.resolve();
  }

  public windows: { since: Date; until: Date }[] = [];

  public listUnreadBetween(
    _organizationId: typeof ORG,
    _userIds: readonly (typeof USER)[],
    since: Date,
    until: Date,
  ): Promise<ReadonlyMap<typeof USER, readonly NotificationRecord[]>> {
    this.windows.push({ since, until });
    return Promise.resolve(new Map(this.rows.length > 0 ? [[USER, this.rows]] : []));
  }

  // The candidate list, which used to come from the preference table and so was empty
  // for everyone on the shipped defaults.
  public recipientsWithUnreadBetween(
    _organizationId: typeof ORG,
    _since: Date,
    _until: Date,
    _limit: number,
    afterUserId: typeof USER | null,
  ): Promise<readonly (typeof USER)[]> {
    return Promise.resolve(afterUserId === null && this.rows.length > 0 ? [USER] : []);
  }
}

class Preferences implements NotificationPreferenceRepository {
  public constructor(private readonly stored: readonly PreferenceRecord[] = []) {}

  public findFor(
    _organizationId: typeof ORG,
    _userIds: readonly (typeof USER)[],
    category: PreferenceRecord["category"],
  ): Promise<readonly PreferenceRecord[]> {
    return Promise.resolve(this.stored.filter((row) => row.category === category));
  }

  public listFor(): Promise<readonly PreferenceRecord[]> {
    return Promise.resolve(this.stored);
  }

  public save(): Promise<void> {
    return Promise.resolve();
  }
}

const ADA: Recipient = { userId: USER, email: "ada@example.test", name: "Ada", locale: "en" };

class Recipients implements NotificationRecipientReader {
  public users(): Promise<readonly Recipient[]> {
    return Promise.resolve([ADA]);
  }

  public user(): Promise<Recipient | null> {
    return Promise.resolve(ADA);
  }

  public organizationMembers(): Promise<readonly Recipient[]> {
    return Promise.resolve([]);
  }

  public conversationMembers(): Promise<readonly Recipient[]> {
    return Promise.resolve([]);
  }
}

// The footer reads "you belong to {organization}", and the id was what went there.
class Organizations implements Partial<OrganizationReader> {
  public nameOf(): Promise<string | null> {
    return Promise.resolve("Acme");
  }
}

class Mail implements MailPublisher {
  public readonly published: MailRequest[] = [];

  public batches = 0;

  public publish(request: MailRequest): Promise<void> {
    this.published.push(request);
    return Promise.resolve();
  }

  public publishMany(requests: readonly MailRequest[]): Promise<void> {
    this.batches += 1;
    this.published.push(...requests);
    return Promise.resolve();
  }
}

const run = async (
  rows: readonly NotificationRecord[],
  stored: readonly PreferenceRecord[] = [],
) => {
  const mail = new Mail();
  const useCase = new SendNotificationDigestUseCase(
    new Notifications(rows),
    new Preferences(stored),
    new Recipients(),
    mail,
    new Organizations() as unknown as OrganizationReader,
  );

  await useCase.execute(ACTOR, { organizationId: ORG, day: DAY });
  return mail.published;
};

describe("SendNotificationDigestUseCase", () => {
  // The defect this file exists for: the recipient list came from stored `digest` rows,
  // and the shipped default is `digest` with no row — so nobody was ever selected.
  it("sends to a reader who has stored nothing at all", async () => {
    const published = await run([unread("message.received", "messaging")]);

    expect(published).toHaveLength(1);
    expect(published[0]?.template).toBe("notification.digest");
    expect(published[0]?.to).toBe("ada@example.test");
  });

  it("does not send when the reader turned that category off", async () => {
    const published = await run(
      [unread("message.received", "messaging")],
      [{ userId: USER, category: "messaging", channel: "email", mode: "off" }],
    );

    expect(published).toHaveLength(0);
  });

  // `immediate` is delivered by `DeliverNotificationUseCase` at the time, so including
  // it here would mail the same thing twice.
  it("does not send when the reader chose immediate", async () => {
    const published = await run(
      [unread("message.received", "messaging")],
      [{ userId: USER, category: "messaging", channel: "email", mode: "immediate" }],
    );

    expect(published).toHaveLength(0);
  });

  // `member.role.changed` defaults to `immediate`, so on defaults alone it is not a
  // digest line. Keyed by kind: the other `membership` kind defaults to digest.
  it("does not send for a kind whose default is immediate", async () => {
    const published = await run([unread("member.role.changed", "membership")]);

    expect(published).toHaveLength(0);
  });

  it("sends for a kind whose default is digest in the same category", async () => {
    const published = await run([unread("member.joined", "membership")]);

    expect(published).toHaveLength(1);
  });

  // A stored `digest` on one category is enough, and the rows that earned it are the
  // ones that resolve to digest — not every unread row the reader holds.
  it("sends when one of several categories resolves to digest", async () => {
    const published = await run(
      [unread("member.role.changed", "membership"), unread("message.received", "messaging")],
      [{ userId: USER, category: "membership", channel: "email", mode: "off" }],
    );

    expect(published).toHaveLength(1);
  });

  it("says nothing when there is nothing unread", async () => {
    expect(await run([])).toHaveLength(0);
  });

  // The dedupe key is organization, person and day, so a redelivered job sends one
  // message rather than a second copy of the same morning.
  it("keys the send on the day, so a retry is one message", async () => {
    const published = await run([unread("message.received", "messaging")]);

    expect(published[0]?.dedupeKey).toBe(`digest_${ORG}_${USER}_${DAY}`);
  });
  // The id went into the copy before this: every digest ended "…because you belong to
  // 018f8c00-0000-7000-…", which is the tenant nobody recognises.
  it("names the organization rather than printing its id", async () => {
    const published = await run([unread("message.received", "messaging")]);

    expect(published[0]?.params).toMatchObject({ organization: "Acme" });
  });

  // A reader on `membership: immediate` and `messaging: digest` had the membership rows
  // counted too — items they had already been emailed about one at a time.
  it("counts only the rows that earned the digest", async () => {
    const published = await run(
      [unread("member.role.changed", "membership"), unread("message.received", "messaging")],
      [{ userId: USER, category: "membership", channel: "email", mode: "immediate" }],
    );

    expect(published).toHaveLength(1);
    expect(published[0]?.params).toMatchObject({ count: 1 });
  });

  // `CP4.4`: the day before, half-open, so a row is in exactly one morning's digest — and
  // the page's mail leaves as one batch rather than one enqueue per person.
  it("reads a half-open day and sends the page as one batch", async () => {
    const notifications = new Notifications([unread("message.received", "messaging")]);
    const mail = new Mail();

    await new SendNotificationDigestUseCase(
      notifications,
      new Preferences(),
      new Recipients(),
      mail,
      new Organizations() as unknown as OrganizationReader,
    ).execute(ACTOR, { organizationId: ORG, day: DAY });

    const until = new Date(`${DAY}T00:00:00.000Z`);
    expect(notifications.windows).toEqual([
      { since: new Date(until.getTime() - 86_400_000), until },
    ]);
    expect(mail.batches).toBe(1);
  });
});
