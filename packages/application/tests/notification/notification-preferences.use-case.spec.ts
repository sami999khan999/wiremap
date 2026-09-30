import { Identifiers } from "@loadbearing/contracts";
import { ForbiddenError } from "@loadbearing/errors";
import { CapabilitySet, type PermissionKey } from "@loadbearing/permissions";
import { describe, expect, it } from "vitest";
import { GetNotificationPreferencesUseCase } from "../../src/notification/get-notification-preferences.use-case.js";
import type {
  NotificationPreferenceRepository,
  PreferenceRecord,
} from "../../src/notification/notification-preference.repository.js";
import { UpdateNotificationPreferenceUseCase } from "../../src/notification/update-notification-preference.use-case.js";
import { Authorizer, Principal } from "../../src/primitive/index.js";

const ORG = Identifiers.organizationId.parse("018f8c00-0000-7000-8000-000000000010");
const USER = Identifiers.userId.parse("018f8c00-0000-7000-8000-000000000011");

const actorHolding = (...grants: readonly PermissionKey[]) =>
  new Principal(
    ORG,
    USER,
    CapabilitySet.from({ wildcard: false, org: { grants, denies: [] }, goals: {} }),
  );

class Preferences implements NotificationPreferenceRepository {
  public readonly saved: Omit<PreferenceRecord, "userId">[] = [];

  public constructor(private readonly stored: readonly PreferenceRecord[] = []) {}

  public findFor(): Promise<readonly PreferenceRecord[]> {
    return Promise.resolve(this.stored);
  }

  public listFor(): Promise<readonly PreferenceRecord[]> {
    return Promise.resolve(this.stored);
  }

  public save(
    _organizationId: typeof ORG,
    _userId: typeof USER,
    preference: Omit<PreferenceRecord, "userId">,
  ): Promise<void> {
    this.saved.push(preference);
    return Promise.resolve();
  }

  public organizationsWithDigest(): Promise<readonly (typeof ORG)[]> {
    return Promise.resolve([]);
  }

  public digestRecipients(): Promise<readonly (typeof USER)[]> {
    return Promise.resolve([]);
  }
}

describe("GetNotificationPreferencesUseCase", () => {
  // The complete grid, not the stored rows. A form rendering only what was saved shows
  // an empty screen on day one, which is how a preferences page reads as broken.
  it("returns every category and channel, defaulted from the policy", async () => {
    const useCase = new GetNotificationPreferencesUseCase(new Authorizer(), new Preferences());

    const resolved = await useCase.execute(actorHolding("notification.inbox.read"));

    // Every category the policy names, times both channels — the complete grid, not the
    // stored rows. A form rendering only what was saved shows an empty screen on day one.
    expect(resolved.map((entry) => entry.category)).toEqual([
      "membership",
      "membership",
      "messaging",
      "messaging",
    ]);
    expect(resolved.map((entry) => entry.channel)).toEqual(["in_app", "email", "in_app", "email"]);
    expect(resolved.every((entry) => entry.mode !== undefined)).toBe(true);
  });

  it("prefers a stored row over the policy default", async () => {
    const stored: PreferenceRecord[] = [
      { userId: USER, category: "membership", channel: "email", mode: "off" },
    ];
    const useCase = new GetNotificationPreferencesUseCase(
      new Authorizer(),
      new Preferences(stored),
    );

    const resolved = await useCase.execute(actorHolding("notification.inbox.read"));

    expect(
      resolved.find((entry) => entry.category === "membership" && entry.channel === "email")?.mode,
    ).toBe("off");
  });

  it("refuses a principal without the read permission", async () => {
    const useCase = new GetNotificationPreferencesUseCase(new Authorizer(), new Preferences());

    await expect(useCase.execute(actorHolding())).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("UpdateNotificationPreferenceUseCase", () => {
  it("saves against the actor's own id and nobody else's", async () => {
    const preferences = new Preferences();
    const useCase = new UpdateNotificationPreferenceUseCase(new Authorizer(), preferences, {
      run: (work: () => Promise<unknown>) => work(),
    } as never);

    await useCase.execute(actorHolding("notification.preference.update"), {
      category: "membership",
      channel: "email",
      mode: "digest",
    });

    expect(preferences.saved).toEqual([
      { category: "membership", channel: "email", mode: "digest" },
    ]);
  });

  // `CR.11`. The move freeze lives in `UnitOfWork.run` and nowhere else, so a routed write
  // that skipped it landed on the source mid-move and was lost at the flip.
  it("writes inside the unit of work, so a frozen tenant refuses it", async () => {
    const preferences = new Preferences();
    const frozen = { run: () => Promise.reject(new Error("shard.move.inFlight")) } as never;
    const useCase = new UpdateNotificationPreferenceUseCase(new Authorizer(), preferences, frozen);

    await expect(
      useCase.execute(actorHolding("notification.preference.update"), {
        category: "membership",
        channel: "email",
        mode: "digest",
      }),
    ).rejects.toThrow("shard.move.inFlight");
    expect(preferences.saved).toEqual([]);
  });

  // Reading the inbox and changing how you are contacted are separate powers, so the
  // read permission alone must not carry the write.
  it("refuses a principal holding only the read permission", async () => {
    const useCase = new UpdateNotificationPreferenceUseCase(new Authorizer(), new Preferences(), {
      run: (work: () => Promise<unknown>) => work(),
    } as never);

    await expect(
      useCase.execute(actorHolding("notification.inbox.read"), {
        category: "membership",
        channel: "email",
        mode: "off",
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  // `member.invited` comes first and has no recipients, so the grid read the whole
  // category `off` while delivery was using the two rows after it.
  it("shows a membership default a reader would actually get", () => {
    const useCase = new GetNotificationPreferencesUseCase(new Authorizer(), new Preferences());

    return useCase.execute(actorHolding("notification.inbox.read")).then((resolved) => {
      const membership = resolved.filter((row) => row.category === "membership");

      expect(membership).not.toHaveLength(0);
      for (const row of membership) expect(row.mode).not.toBe("off");
    });
  });
});
